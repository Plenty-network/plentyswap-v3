(* Inspired from https://www.paradigm.xyz/2021/05/liquidity-mining-on-uniswap-v3. 

   Known limitations (quoted from the article above):
   - Fuzzy cutoffs: There is no way to automatically snapshot all of the accumulators at the exact moment that an incentive ends. After that cutoff, the contract cannot always distinguish between liquidity that was staked before the cutoff and liquidity that was staked after. To accomodate this, the contract can apply a decay to the reward rate for anyone who unstakes after the incentive ends. People who want to lock in the exact reward rate would need to unstake before that.
   - Unstaked liquidity: The algorithm uses the total amount of active liquidity in the core contract, which might be higher than the total staked liquidity. Unstaked liquidity will still be allocated a share of the rewards, as if it was staked but unclaimed. The creator of an incentive could specify a claim deadline after which they would be able to recover all unclaimed rewards.

   Resolution:
   As suggested in the second point, this farm contract allows for a `claim_deadline` for all the incentives. Stakers are not allowed to claim their rewards once the deadline is crossed. 
   A claim deadline close to the end of the incentive can also prove to be effective against the fuzzy cutoff issue. Contrary to the suggestion, we have not implemented a reward decay since it taxes inactive liquidity more compared to active liquidity once the incentive ends. 
*)

#include "./common/math.mligo"
#include "./common/types.mligo"
#include "./common/errors.mligo"
#include "./common/transfers.mligo"

(* Storage types *)

type stake = {
    (* Accumulator value at the time a reward was claimed or the stake was created *)
    seconds_per_liquidity_inside_last: x128;
    liquidity: nat;
}

type incentive = {
    reward_token: token;
    start_time: timestamp;
    end_time: timestamp;
    claim_deadline: timestamp;
    total_reward: nat;
    total_reward_unclaimed : nat;

    (* Total seconds of active liquidity <= (end_time - start_time) that has been claimed already *)
    total_seconds_claimed : x128n;

    (* Number of stakes for this incentive *)
    n_stakes: nat;
    refundee: address;
}

type deposit = {
    owner: address;
    n_stakes: nat;
    tick_range: int * int; // (lower tick, upper tick)
}

type storage = {
    admin: address;
    proposed_admin: address option;
    cfmm_address: address;
    last_incentive_id: nat;
    incentives: (nat, incentive) big_map;

    (* Tracks locked position tokens and number of staked incentives for each *)
    deposits: (nat, deposit) big_map; // token id -> deposit
    stakes: (nat * nat, stake) big_map; // (token id, incentive id) -> stake
    rewards: (token * address, nat) big_map; // (reward token, user address) -> unclaimed reward
}


(* Parameter types *)

type start_incentive_params = [@layout:comb] {
    start_time: timestamp;
    end_time: timestamp;
    claim_deadline: timestamp;
    reward_token: token;
    reward_amount: nat;
    refundee: address;
}

type parameter =
    | Stake of nat * nat // (token id, incentive id) 
    | Unstake of nat * nat // (token id, incentive id)
    | Withdraw of nat // token id
    | Claim_reward of token list
    | Start_incentive of start_incentive_params
    | End_incentive of nat // incentive id
    | Propose_new_admin of address
    | Accept_new_admin


type return = operation list * storage

type get_reward_params = {
    incentive: incentive;
    stake: stake;
    seconds_per_liquidity_inside: x128;
}

(* Entrypoints and lambdas *)

let get_reward (params: get_reward_params): incentive * nat =    
    if Tezos.get_now () > params.incentive.claim_deadline then
        (params.incentive, 0n)
    else
        let max_timestamp(a, b : timestamp * timestamp) : timestamp =
            if a > b then a else b in

        (* Theoretically, we are calculating the number of seconds for which the liquidity of this position was active,
        pro rated for all positions in that tick range. *)
        let seconds_per_liquidity_inside_diff = {
            x128 = assert_nat
                ( params.seconds_per_liquidity_inside.x128 - params.stake.seconds_per_liquidity_inside_last.x128,
                invalid_cumulatives_value)
        } in
        let seconds_inside = { x128 = seconds_per_liquidity_inside_diff.x128 * params.stake.liquidity } in
        let total_seconds_for_reward = 
            assert_nat(max_timestamp(params.incentive.end_time, Tezos.get_now()) - params.incentive.start_time, internal_impossible_err) in
        let total_seconds_unclaimed = {
            x128 = assert_nat 
                ( Bitwise.shift_left total_seconds_for_reward 128n - params.incentive.total_seconds_claimed.x128,
                claimed_too_much_seconds)
        } in
        
        let reward = (params.incentive.total_reward_unclaimed * seconds_inside.x128) / total_seconds_unclaimed.x128 in

        let (reward, remaining_reward) =
            match is_nat(params.incentive.total_reward_unclaimed - reward) with
            | Some remaining -> (reward, remaining)
            | None -> (params.incentive.total_reward_unclaimed, 0n) in
        (
            { 
                params.incentive with 
                total_reward_unclaimed = remaining_reward; 
                total_seconds_claimed = { x128 = params.incentive.total_seconds_claimed.x128 + seconds_inside.x128 };
            },
            reward
        )


let stake ((token_id, incentive_id): nat * nat) (store: storage) : return =
    (* Verify that the incentive exists and is still up for staking *)
    let incentive = 
        match Big_map.find_opt incentive_id store.incentives with
        | None -> failwith invalid_incentive_id 
        | Some i -> if Tezos.get_now () >= i.end_time then failwith incentive_ended else i in

    (* Get position info from cfmm *)
    let position_info: position_info = 
        match Tezos.call_view "get_position_info" token_id store.cfmm_address with 
        | None -> failwith invalid_contract
        | Some info -> info in
    
    let { lower_tick_index; upper_tick_index; owner; liquidity } = position_info in

    (* Verify that the sender is the position owner *)
    let _ = if owner <> Tezos.get_sender () then failwith not_authorised else unit in

    (* Fetch cumulatives snapshot *)
    let view_params = { lower_tick_index; upper_tick_index; } in
    let cumulatives_snapshot: cumulatives_inside_snapshot = 
        match Tezos.call_view "snapshot_cumulatives_inside" view_params store.cfmm_address with
        | None -> failwith invalid_contract 
        | Some cs -> cs in 

    (* If no stake exists for this token on the incentive then create fresh stake,
       otherwise compute already accrued rewards and update the stake
       The latter can be useful when liquidity is added to a position that is already staked. *)
    match Big_map.find_opt (token_id, incentive_id) store.stakes with
    | None -> begin
        (* Create a deposit if not already present *)
        let op, deposit = match Big_map.find_opt token_id store.deposits with 
        | None -> begin
            let deposit = { 
                owner = Tezos.get_sender (); 
                n_stakes = 0n; 
                tick_range = (lower_tick_index.i, upper_tick_index.i) 
            } in
            [cfmm_token_transfer owner (Tezos.get_self_address ()) 1n (Fa2(store.cfmm_address, token_id))], deposit
        end
        | Some d -> [], d in

        let stake: stake = { 
            seconds_per_liquidity_inside_last = cumulatives_snapshot.seconds_per_liquidity_inside;
            liquidity;
        } in

        let updated_stakes = Big_map.add (token_id, incentive_id) stake store.stakes in
        let updated_deposits = 
            Big_map.update token_id (Some { deposit with n_stakes = deposit.n_stakes + 1n }) store.deposits in
        let updated_incentives = 
            Big_map.update incentive_id (Some { incentive with n_stakes = incentive.n_stakes + 1n }) store.incentives in

        op, { store with stakes = updated_stakes; deposits = updated_deposits; incentives = updated_incentives; }
    end
    | Some stake -> begin
        (* Get existing unclaimed reward and updated incentive for the stake *)
        let (incentive, reward) = 
            get_reward { 
                incentive; 
                stake; 
                seconds_per_liquidity_inside = cumulatives_snapshot.seconds_per_liquidity_inside;
            } in
        
        let existing_reward = 
            match Big_map.find_opt (incentive.reward_token, owner) store.rewards with None -> 0n | Some r -> r in

        let stake: stake = { 
            seconds_per_liquidity_inside_last = cumulatives_snapshot.seconds_per_liquidity_inside;
            liquidity;
        } in

        let updated_stakes = Big_map.update (token_id, incentive_id) (Some stake) store.stakes in
        let updated_incentives = Big_map.update incentive_id (Some incentive) store.incentives in
        let updated_rewards = 
            Big_map.update (incentive.reward_token, owner) (Some (existing_reward + reward)) store.rewards in
        [], { store with incentives = updated_incentives; rewards = updated_rewards; stakes = updated_stakes; }
    end


let unstake ((token_id, incentive_id): nat * nat) (store: storage): return =
    let incentive =
        match Big_map.find_opt incentive_id store.incentives with 
        | None -> failwith invalid_incentive_id
        | Some i -> i in 

    let deposit = 
        match Big_map.find_opt token_id store.deposits with 
        | None -> failwith no_deposit_for_token
        | Some d -> d in

    let stake =  
        match Big_map.find_opt (token_id, incentive_id) store.stakes with
        | None -> failwith no_stake_for_token
        | Some s -> s in

    (* Verify that the sender owns the stake *)
    let _ = if Tezos.get_sender () <> deposit.owner then failwith not_authorised else unit in

    let (lower_tick_index, upper_tick_index) = deposit.tick_range in
    
    (* Fetch cumulatives snapshot *)
    let view_params = { lower_tick_index; upper_tick_index; } in
    let cumulatives_snapshot: cumulatives_inside_snapshot = 
        match Tezos.call_view "snapshot_cumulatives_inside" view_params store.cfmm_address with
        | None -> failwith invalid_contract 
        | Some cs -> cs in 
    
    let (incentive, reward) =
        get_reward { 
            incentive; 
            stake; 
            seconds_per_liquidity_inside = cumulatives_snapshot.seconds_per_liquidity_inside;
        } in
    
    let existing_reward = 
        match Big_map.find_opt (incentive.reward_token, deposit.owner) store.rewards with None -> 0n | Some r -> r in
    
    let updated_stakes = Big_map.update (token_id, incentive_id) None store.stakes in 
    let updated_incentives = 
        Big_map.update incentive_id (Some { 
            incentive with n_stakes = assert_nat (incentive.n_stakes - 1n, internal_impossible_err) 
        }) store.incentives in 
    let updated_deposits = 
        Big_map.update token_id (Some {
            deposit with n_stakes = assert_nat (deposit.n_stakes - 1n, internal_impossible_err)
        }) store.deposits in
    let updated_rewards = 
        Big_map.update (incentive.reward_token, deposit.owner) (Some (existing_reward + reward)) store.rewards in

    [], { store with stakes = updated_stakes; incentives = updated_incentives; deposits = updated_deposits; rewards = updated_rewards; }


let withdraw (token_id: nat) (store: storage): return =
    let deposit = 
        match Big_map.find_opt token_id store.deposits with 
        | None -> failwith no_deposit_for_token
        | Some d -> d in
    
    (* Verify that the sender is the deposit's owner *)
    let _ = if deposit.owner <> Tezos.get_sender () then failwith not_authorised else unit in

    (* The token must not be staked *)
    let _ = if deposit.n_stakes <> 0n then failwith active_stakes else unit in

    let updated_deposits = Big_map.update token_id None store.deposits in 

    let op = cfmm_token_transfer (Tezos.get_self_address ()) deposit.owner 1n (Fa2(store.cfmm_address, token_id)) in

    [op], { store with deposits = updated_deposits; }


(* This only claims the reward that is already accounted in the rewards big_map. For claiming maximum possible
   reward for a particular address, call `stake` for all the related incentives *)
let claim_reward (tokens: token list) (store: storage): return =
    let rec aux (tokens: token list) (ops: operation list) (store: storage): return =
        match tokens with 
        | [] -> ops, store
        | h::t -> begin
            match Big_map.find_opt (h, Tezos.get_sender ()) store.rewards with
            | None -> aux t ops store
            | Some r -> begin
                if r <> 0n then
                    let op = cfmm_token_transfer (Tezos.get_self_address ()) (Tezos.get_sender ()) r h in
                    (* Remove the reward *)
                    let updated_rewards = Big_map.update (h, Tezos.get_sender ()) None store.rewards in 
                    aux t (op::ops) { store with rewards = updated_rewards }
                else 
                    aux t ops store
            end
        end in
    aux tokens [] store


let start_incentive (params: start_incentive_params) (store: storage): return =    
    (* Only admin can start an incentive *)
    let _ = if store.admin <> Tezos.get_sender () then failwith not_authorised else unit in

    (* Verify the correctness of reward period *)
    let _ = 
        if (params.end_time <= params.start_time) || (params.start_time < Tezos.get_now ())
            then failwith invalid_start_and_end 
        else unit in

    (* Verify that the claim deadline is beyond end time *)
    let _ = if params.claim_deadline <= params.end_time then failwith invalid_claim_deadline else unit in


    let incentive: incentive = { 
        start_time = params.start_time;
        end_time = params.end_time;
        claim_deadline = params.claim_deadline;
        reward_token = params.reward_token;
        total_reward = params.reward_amount;
        total_reward_unclaimed = params.reward_amount;
        total_seconds_claimed = { x128 = 0n };
        n_stakes = 0n;
        refundee = params.refundee;
    } in

    let updated_incentives = Big_map.add (store.last_incentive_id + 1n) incentive store.incentives in

    (* Retrieve the reward *)
    let op = 
        cfmm_token_transfer (Tezos.get_sender ()) (Tezos.get_self_address ()) params.reward_amount params.reward_token in

    [op], { store with incentives = updated_incentives; last_incentive_id = store.last_incentive_id + 1n; }


let end_incentive (incentive_id: nat) (store: storage): return =
    let incentive = 
        match Big_map.find_opt incentive_id store.incentives with
        | None -> failwith invalid_incentive_id
        | Some i -> i in
    
    (* Only admin can end an incentive *)
    let _ = if store.admin <> Tezos.get_sender () then failwith not_authorised else unit in 

    (* Verify that all pending stakes have been removed *)
    let _ = if Tezos.get_now () <= incentive.claim_deadline then failwith claim_deadline_not_reached else unit in

    let op = 
        cfmm_token_transfer (Tezos.get_self_address ()) (incentive.refundee) incentive.total_reward_unclaimed incentive.reward_token in

    let updated_incentives = 
        Big_map.update incentive_id (Some { incentive with total_reward_unclaimed = 0n }) store.incentives in
    
    [op], { store with incentives = updated_incentives; }


let propose_new_admin (new_admin: address) (store: storage): return = 
    let _ = if store.admin <> Tezos.get_sender () then failwith not_authorised else unit in
    [], { store with proposed_admin = Some new_admin; }


let accept_new_admin (_: unit) (store: storage): return = 
    match store.proposed_admin with
    | None -> failwith not_authorised 
    | Some proposed_admin -> begin
        let _ = if proposed_admin <> Tezos.get_sender () then failwith not_authorised else unit in
        [], { store with admin = proposed_admin; proposed_admin = None; }
    end


let main (action, store: parameter * storage): return =
    let _ = if Tezos.get_amount () <> 0mutez then failwith tez_not_accepted else unit in

    match action with 
    | Stake p -> stake p store
    | Unstake p -> unstake p store
    | Withdraw p -> withdraw p store
    | Claim_reward p -> claim_reward p store
    | Start_incentive p -> start_incentive p store
    | End_incentive p -> end_incentive p store
    | Propose_new_admin p -> propose_new_admin p store
    | Accept_new_admin -> accept_new_admin unit store