(*  
    Taken and modified from the original code at: 
    https://github.com/tezos-checker/segmented-cfmm/blob/master/ligo/main.mligo 
*)

#include "./common/types.mligo"
#include "./common/consts.mligo"
#include "./common/helpers.mligo"
#include "./common/transfers.mligo"
#include "./common/math.mligo"
#include "./common/swaps.mligo"
#include "./common/token/fa2.mligo"


let rec initialize_tick ((ticks, tick_index, tick_witness,
    initial_tick_cumulative_outside,
    initial_fee_growth_outside,
    initial_seconds_outside,
    initial_seconds_per_liquidity_outside,
    ladder) : tick_map * tick_index * tick_index * int * balance_nat_x128 * nat * x128n * ladder) : tick_map =
    if Big_map.mem tick_index ticks then
        ticks
    else if tick_witness.i > tick_index.i then
        (failwith invalid_witness_err : tick_map)
    else
        let tick = get_tick ticks tick_witness tick_not_exist_err in
        let next_tick_index = tick.next in
        (* 
            The tick to be initialised is in between the witness and the next tick greater than witness. 
            ---witness---(tick to initalised)---witness.next---
        *)
        if next_tick_index.i > tick_index.i then
            let tick_next = get_tick ticks next_tick_index internal_tick_not_exist_err in
            let ticks = Big_map.add tick_witness {tick with next = tick_index} ticks in
            let ticks = Big_map.add next_tick_index {tick_next with prev = tick_index} ticks in
            let ticks = Big_map.add tick_index {
                prev = tick_witness;
                next = next_tick_index;
                liquidity_net = 0;
                n_positions = 0n;
                tick_cumulative_outside = initial_tick_cumulative_outside;
                fee_growth_outside = initial_fee_growth_outside;
                seconds_outside = initial_seconds_outside;
                seconds_per_liquidity_outside = initial_seconds_per_liquidity_outside;
                sqrt_price = half_bps_pow (tick_index.i, ladder)} ticks in
            ticks
        else
            initialize_tick
                ( ticks, tick_index, next_tick_index,
                  initial_tick_cumulative_outside,
                  initial_fee_growth_outside,
                  initial_seconds_outside,
                  initial_seconds_per_liquidity_outside,
                  ladder )


(* Account for the fact that this tick is a boundary for one more (or one less) position. *)
let cover_tick_with_position (ticks : tick_map) (tick_index : tick_index) (pos_delta : int) (liquidity_delta : int) =
    let tick = get_tick ticks tick_index internal_tick_not_exist_err in
    let n_pos = assert_nat (tick.n_positions + pos_delta, internal_position_underflow_err) in
    let new_liquidity = tick.liquidity_net + liquidity_delta in
    Big_map.add tick_index
        { tick with
            n_positions = n_pos;
            liquidity_net = new_liquidity
        } ticks


(*  
    Garbage collect the tick.
    The largest and smallest tick are initialized with n_positions = 1 so they cannot
    be accidentally garbage collected.
*)
let garbage_collect_tick (s : storage) (tick_index : tick_index) : storage =
    let tick = get_tick s.ticks tick_index internal_tick_not_exist_err in

    if tick.n_positions = 0n then
        let ticks = s.ticks in
        let prev = get_tick ticks tick.prev internal_tick_not_exist_err in
        let next = get_tick ticks tick.next internal_tick_not_exist_err in
        (* prev links to next and next to prev, skipping the deleted tick *)
        let prev = {prev with next = tick.next} in
        let next = {next with prev = tick.prev} in
        let ticks = Big_map.remove tick_index ticks in
        let ticks = Big_map.update tick.prev (Some prev) ticks in
        let ticks = Big_map.update tick.next (Some next) ticks in

        (* If this tick is the `cur_tick_witness`, then deleting the tick would invalidate `cur_tick_witness`,
           so we need to move it to the previous initialized tick. *)
        let cur_tick_witness = if s.cur_tick_witness = tick_index then tick.prev else s.cur_tick_witness in

        {s with ticks = ticks; cur_tick_witness = cur_tick_witness }
    else
        s


(*  
    Garbage collects:
      - the position if its liquidity becomes 0,
      - and the ticks if they are no longer the boundaries of any existing position.
*)
let garbage_collection (s : storage) (position : position_state) (position_id : position_id) : storage =
    let s = if position.liquidity = 0n
                then
                    { s with
                        positions = Big_map.remove position_id s.positions;
                        ledger = Big_map.remove position_id s.ledger;
                    }
                else s in
    let s = garbage_collect_tick s position.lower_tick_index in
    let s = garbage_collect_tick s position.upper_tick_index in
    s


let calc_fee_growth_inside (s : storage) (lower_tick_index : tick_index) (upper_tick_index : tick_index) : balance_int_x128 =
    let lower_tick = get_tick s.ticks lower_tick_index internal_tick_not_exist_err in
    let upper_tick = get_tick s.ticks upper_tick_index internal_tick_not_exist_err in

    (* Uniswap paper: equation 6.17 *)
    let fee_above =
        if s.cur_tick_index.i >= upper_tick_index.i then
            { x = {x128 = assert_nat (s.fee_growth.x.x128 - upper_tick.fee_growth_outside.x.x128, internal_311) };
              y = {x128 = assert_nat (s.fee_growth.y.x128 - upper_tick.fee_growth_outside.y.x128, internal_311) };
            }
        else
            upper_tick.fee_growth_outside in
    (* Uniswap paper: equation 6.18 *)
    let fee_below =
        if s.cur_tick_index.i >= lower_tick_index.i then
            lower_tick.fee_growth_outside
        else
            { x = {x128 = assert_nat (s.fee_growth.x.x128 - lower_tick.fee_growth_outside.x.x128, internal_312) };
              y = {x128 = assert_nat (s.fee_growth.y.x128 - lower_tick.fee_growth_outside.y.x128, internal_312) };
            } in
    (* Uniswap paper: equation 6.19 *)
    { x = {x128 = s.fee_growth.x.x128 - fee_above.x.x128 - fee_below.x.x128 };
      y = {x128 = s.fee_growth.y.x128 - fee_above.y.x128 - fee_below.y.x128 };
    }


let collect_fees (s : storage) (key : position_id) (position : position_state) : storage * balance_nat * position_state =
    let fee_growth_inside = calc_fee_growth_inside s position.lower_tick_index position.upper_tick_index in
    let fees = {
        x = Bitwise.shift_right ((assert_nat (fee_growth_inside.x.x128 - position.fee_growth_inside_last.x.x128, internal_316)) * position.liquidity) 128n;
        y = Bitwise.shift_right ((assert_nat (fee_growth_inside.y.x128 - position.fee_growth_inside_last.y.x128, internal_317)) * position.liquidity) 128n} in
    let position = {position with fee_growth_inside_last = fee_growth_inside} in
    let positions = Big_map.add key position s.positions in
    ({s with positions = positions}, fees, position)


(* 
    Computes how mant tokens have to be deposited or withdrawn to change the liquidity between the given ticks by `liquidity_delta`.

    ΔX = Δ(1 / sqrt(p)) * L

    ΔY = Δ(sqrt(p)) * L
*)
let update_balances_after_position_change
        (s : storage)
        (lower_tick_index : tick_index) (upper_tick_index : tick_index)
        (tokens_limit : balance_nat)
        (to_x : address) (to_y : address)
        (liquidity_delta : int) (fees : balance_nat) : result =

    (* Grab cached prices for the interval *)
    let ticks = s.ticks in
    let tick_u = get_tick ticks upper_tick_index internal_tick_not_exist_err in
    let tick_l = get_tick ticks lower_tick_index internal_tick_not_exist_err in
    let srp_u = tick_u.sqrt_price in
    let srp_l = tick_l.sqrt_price in

    let (s, delta) =

    (* Above current tick i.e position is entirely in X *)
    if s.cur_tick_index.i < lower_tick_index.i then
        (s, {
            (* If I'm adding liquidity, x will be positive, I want to overestimate it, if x I'm taking away
                liquidity, I want to to underestimate what I'm receiving. *)
            x = ceildiv_int (liquidity_delta * (int (Bitwise.shift_left (assert_nat (srp_u.x80 - srp_l.x80, internal_sqrt_price_grow_err_1)) 80n))) (int (srp_l.x80 * srp_u.x80));
            y = 0
        })
    (* Position in both X and Y *)
    else if lower_tick_index.i <= s.cur_tick_index.i && s.cur_tick_index.i < upper_tick_index.i then
        (* Update current global liquidity *)
        let s = { s with
                    liquidity = assert_nat (s.liquidity + liquidity_delta, position_liquidity_below_zero_err)
                } in
        (s, {
            x = ceildiv_int (liquidity_delta * (int (Bitwise.shift_left (assert_nat (srp_u.x80 - s.sqrt_price.x80, internal_sqrt_price_grow_err_2)) 80n))) (int (s.sqrt_price.x80 * srp_u.x80));
            y = ceildiv_int (liquidity_delta * (s.sqrt_price.x80 - srp_l.x80)) pow_2_80
        })
    (* Below current tick index i.e position is entirely in Y *)
    else
        (s, {x = 0; y = ceildiv_int (liquidity_delta * (srp_u.x80 - srp_l.x80)) pow_2_80 }) in

    (* Collect fees to increase withdrawal or reduce required deposit. *)
    let delta = {x = delta.x - fees.x; y = delta.y - fees.y} in

    let delta_abs = { x = abs(delta.x); y = abs(delta.y) } in

    (* Check delta doesn't exceed the limit for addition of liquidity and falls below the limit for removal. *)
    let _: unit = 
        if ((delta.x > 0) && (delta_abs.x > tokens_limit.x)) || ((delta.x < 0) && (delta_abs.x < tokens_limit.x))
        then ([%Michelson ({| { FAILWITH } |} : nat * (nat * nat) -> unit)]
            (tokens_limit_err, (tokens_limit.x, delta_abs.x)) : unit)
        else unit in
    let _: unit = 
        if ((delta.y > 0) && (delta_abs.y > tokens_limit.y)) || ((delta.y < 0) && (delta_abs.y < tokens_limit.y))
        then ([%Michelson ({| { FAILWITH } |} : nat * (nat * nat) -> unit)]
            (tokens_limit_err, (tokens_limit.y, delta_abs.y)) : unit)
        else unit in

    let ops = if delta.x > 0 then
        [cfmm_token_transfer (Tezos.get_sender ()) (Tezos.get_self_address ()) delta_abs.x s.constants.token_x]
    else if delta.x < 0 then
        [cfmm_token_transfer (Tezos.get_self_address ()) to_x delta_abs.x s.constants.token_x]
    else  
        []
    in

    let ops = if delta.y > 0 then
        (cfmm_token_transfer (Tezos.get_sender ()) (Tezos.get_self_address ()) delta_abs.y s.constants.token_y)::ops
    else if delta.y < 0 then
        (cfmm_token_transfer (Tezos.get_self_address ()) to_y delta_abs.y s.constants.token_y)::ops 
    else
        ops
    in

    (ops, s)


(*  
    Checks if a new tick sits between `cur_tick_witness` and `cur_tick_index`.
    If it does, we need to move `cur_tick_witness` forward to maintain its invariant:
    `cur_tick_witness` is the highest initialized tick lower than or equal to `cur_tick_index`.
*)  
[@inline]
let update_cur_tick_witness (s : storage) (tick_index : tick_index) : storage =
    if tick_index > s.cur_tick_witness && tick_index <= s.cur_tick_index
        then { s with cur_tick_witness = tick_index }
        else s


let set_position (s : storage) (p : set_position_param) : result =
    (* Liquidity addition must not be paused *)
    let _: unit = if s.paused.add_liquidity then failwith liquidity_addition_paused else unit in

    let _: unit = check_deadline p.deadline in
    let allowed_tick_spacing = s.constants.tick_spacing in
    let _: unit = check_multiple_of_tick_spacing (p.lower_tick_index, allowed_tick_spacing) in
    let _: unit = check_multiple_of_tick_spacing (p.upper_tick_index, allowed_tick_spacing) in
    let _: unit = if p.lower_tick_index >= p.upper_tick_index then failwith tick_order_err else unit in

    (* Creating position with 0 liquidity must result in no changes being made *)
    if p.liquidity = 0n then (([] : operation list), s) else

    (* Initialize ticks if need be. *)
    let ticks = s.ticks in
    let (init_tick_cumul_out, init_fee_growth_out, init_secs_out, init_spl_outside) =
            if s.cur_tick_index.i >= p.lower_tick_index.i then
                let sums = get_last_cumulatives s.cumulatives_buffer in ( 
                    sums.tick.sum,
                    s.fee_growth,
                    assert_nat (Tezos.get_now() - epoch_time, internal_epoch_bigger_than_now_err),
                    sums.spl.sum
                )
            else ( 
                0,
                { x = {x128 = 0n}; y = {x128 = 0n} },
                0n,
                { x128 = 0n }
            )
    in
    let ticks = initialize_tick
        ( 
            ticks,
            p.lower_tick_index,
            p.lower_tick_witness,
            init_tick_cumul_out,
            init_fee_growth_out,
            init_secs_out,
            init_spl_outside,
            s.ladder
        )
    in
    let (init_tick_cumul_out, init_fee_growth_out, init_secs_out, init_spl_outside) =
            if s.cur_tick_index.i >= p.upper_tick_index.i then
                let sums = get_last_cumulatives s.cumulatives_buffer in ( 
                    sums.tick.sum,
                    s.fee_growth,
                    assert_nat (Tezos.get_now() - epoch_time, internal_epoch_bigger_than_now_err),
                    sums.spl.sum
                )
            else ( 
                0,
                {x = {x128 = 0n}; y = {x128 = 0n}},
                0n,
                {x128 = 0n}
            )
    in
    let ticks = initialize_tick ( 
        ticks,
        p.upper_tick_index,
        p.upper_tick_witness,
        init_tick_cumul_out,
        init_fee_growth_out,
        init_secs_out,
        init_spl_outside,
        s.ladder
    )
    in
    let s = {s with ticks = ticks} in

    let s = update_cur_tick_witness s p.lower_tick_index in
    let s = update_cur_tick_witness s p.upper_tick_index in

    (* Create a new position *)
    let position =
        {   liquidity = p.liquidity;
            fee_growth_inside_last = calc_fee_growth_inside s p.lower_tick_index p.upper_tick_index;
            lower_tick_index = p.lower_tick_index;
            upper_tick_index = p.upper_tick_index;
        } in
    
    (* Update `liquidity_net` and overlapping position count for associated ticks *)
    let ticks = cover_tick_with_position ticks p.lower_tick_index 1 (int p.liquidity) in
    let ticks = cover_tick_with_position ticks p.upper_tick_index 1 (-p.liquidity) in
    let s = { s with ticks = ticks } in

    let s =
        { s with
            ledger = Big_map.add s.new_position_id (Tezos.get_sender ()) s.ledger;
            positions = Big_map.add s.new_position_id position s.positions;
            new_position_id = s.new_position_id + 1n;
        } in

    (* 
        Update global liquidity and retrieve tokens from the user.
        
        The parameter values for `to_x` and `to_y` are irrelavant here since the liquidity delta is +ve so
        tokens are only received from the sender.
    *)
    update_balances_after_position_change
        s p.lower_tick_index p.upper_tick_index
        p.maximum_tokens_contributed
        (Tezos.get_self_address ()) (Tezos.get_self_address ())
        (int p.liquidity) {x = 0n; y = 0n}


let update_position (s : storage) (p : update_position_param) : result =
    (* Additions/Removals must not pe paused *)
    let _: unit = 
        if (p.liquidity_delta > 0) && (s.paused.add_liquidity) then failwith liquidity_addition_paused
        else if (p.liquidity_delta <= 0) && (s.paused.remove_liquidity) then failwith liquidity_removal_paused
        else unit 
    in 

    let _: unit = check_deadline p.deadline in

    (* Grab the existing position *)
    let position = get_position (p.position_id, s.positions) in
    
    let owner = get_owner p.position_id s.ledger in

    (* Sender must be the owner of the position *)
    let _ = if owner <> Tezos.get_sender () then failwith not_authorised else unit in
      
    (* Update liquidity of position. Abort if more than available liquidity is being removed when 
       `p.liquidity_delta` is negative *)
    let liquidity_new = assert_nat (position.liquidity + p.liquidity_delta, position_liquidity_below_zero_err) in

    (* Get accumulated fees for this position. *)
    let s, fees, position = collect_fees s p.position_id position in
    
    let position = {position with liquidity = liquidity_new} in

    (* If the position is being emptied out, decrease the number of positions for the associated ticks by 1 *)
    let positions_num_delta = if liquidity_new = 0n then -1 else 0 in
    (* Update related ticks. *)
    let ticks = s.ticks in
    let ticks = cover_tick_with_position ticks position.lower_tick_index positions_num_delta p.liquidity_delta in
    let ticks = cover_tick_with_position ticks position.upper_tick_index positions_num_delta (-p.liquidity_delta) in
    let s =
        { s with
            ticks = ticks;
            positions = Big_map.add p.position_id position s.positions;
        } in

    let (ops, s) = update_balances_after_position_change
        s position.lower_tick_index position.upper_tick_index
        p.tokens_limit
        p.to_x p.to_y
        p.liquidity_delta fees in

    (* Garbage collection *)
    let s = garbage_collection s position p.position_id in

    (ops, s)


(* Increase the number of stored accumulators. *)
let increase_observation_count (s, p : storage * increase_observation_count_param) : result =
    let buffer = s.cumulatives_buffer in
    (* We have to get values close to the real ones because different numbers *)
    (* would take different amount of space in the storage. *)
    let dummy_timed_cumulatives = get_last_cumulatives buffer in
    let new_reserved_length = buffer.reserved_length + p.added_observation_count in

    let stop_allocation_index = buffer.first + new_reserved_length in
    let rec allocate_buffer_slots (buffer_map, idx : (nat, timed_cumulatives) big_map * nat) : (nat, timed_cumulatives) big_map =
        if idx >= stop_allocation_index
        then buffer_map
        else
            let new_buffer_map = Big_map.add idx dummy_timed_cumulatives buffer_map
            in allocate_buffer_slots(new_buffer_map, idx + 1n)
        in

    let buffer_map = allocate_buffer_slots(buffer.map, buffer.first + buffer.reserved_length) in
    let buffer = {buffer with reserved_length = new_reserved_length; map = buffer_map}
    in (([] : operation list), {s with cumulatives_buffer = buffer})


(* Calculate seconds_per_liquidity cumulative diff. *)
[@inline]
let eval_seconds_per_liquidity_x128(liquidity, duration : nat * nat) =
    if liquidity = 0n
    (*  It actually doesn't really matter how much we add to this accumulator
        when there is no active liquidity. When calculating a liquidity miner's
        rewards, we only care about the 'seconds per liquidity' accumulator's
        value while the current tick was inside the position's range
        i.e., while the contract's liquidity was not zero). 
    *)
    then 0n
    else Bitwise.shift_left duration 128n / liquidity


(* Recursive helper for `get_cumulatives` *)
let rec find_cumulatives_around (buffer, t, l, r : timed_cumulatives_buffer * timestamp * (nat * timed_cumulatives) * (nat * timed_cumulatives)) : (timed_cumulatives * timed_cumulatives * nat) =
    let (l_i, l_v) = l in
    let (r_i, r_v) = r in
    (* Binary search, invariant: l_v.time <= t && t < r_v.time *)
    if l_i + 1n < r_i
    then
        let m_i = (l_i + r_i) / 2n in
        let m_v = get_registered_cumulatives_unsafe buffer m_i in
        let m = (m_i, m_v) in
        let (new_l, new_r) = if m_v.time > t then (l, m) else (m, r) in
        find_cumulatives_around (buffer, t, new_l, new_r)
    else
        (l_v, r_v, assert_nat (t - l_v.time, internal_observe_bin_search_failed))


let get_cumulatives (s : storage) (t : timestamp) : cumulatives_value =
    let l_i = s.cumulatives_buffer.first in
    let r_i = s.cumulatives_buffer.last in
    let l_v = get_registered_cumulatives_unsafe s.cumulatives_buffer l_i in
    let r_v = get_registered_cumulatives_unsafe s.cumulatives_buffer r_i in

    let _: unit = if t < l_v.time
        then ([%Michelson ({| { FAILWITH } |} : nat * (timestamp * timestamp) -> unit)]
            (observe_outdated_timestamp_err, (l_v.time, t)) : unit)
        else unit in
    let _: unit = if t > Tezos.get_now ()
        then ([%Michelson ({| { FAILWITH } |} : nat * (timestamp * timestamp) -> unit)]
            (observe_future_timestamp_err, (r_v.time, t)) : unit)
        else unit in

    if t < r_v.time then
        let (sums_at_left, sums_at_right, time_delta) = find_cumulatives_around (s.cumulatives_buffer, t, (l_i, l_v), (r_i, r_v))

        (* 
            When no updates to contract are performed, time-weighted accumulators grow
            linearly. Extrapolating to get the value at timestamp in-between.
            
            tick_cumulative(t) and seconds_per_liquidity_cumulative(t) functions produced
            by this extrapolation are continuous.
            
            1. At [left, right) range found by the binary search above, cumulatives are
            continuous by construction - our extrapolation is linear.
            2. At (right - o, right] range they are also continous, because we will
            use the same formula for calculating cumulatives at `right - o` (here)
            and at `right` (see how `sum` fields are updated in `update_timed_cumulatives`). 
        *)
        in { 
            tick_cumulative =
                let at_left_block_end_tick_value = sums_at_right.tick.block_start_value
                in sums_at_left.tick.sum + time_delta * at_left_block_end_tick_value.i;
            seconds_per_liquidity_cumulative =
                let at_left_block_end_spl_value = sums_at_right.spl.block_start_liquidity_value
                in { 
                    x128 = sums_at_left.spl.sum.x128 +
                    eval_seconds_per_liquidity_x128(at_left_block_end_spl_value, time_delta) 
                }
            }
    else
        let time_delta = assert_nat (t - r_v.time, internal_impossible_err) in 
        (*  t >= r_v.time
            In this case we extrapolate the last value *)
        {
            tick_cumulative = r_v.tick.sum + time_delta * s.cur_tick_index.i;
            seconds_per_liquidity_cumulative = {
                x128 = r_v.spl.sum.x128 + eval_seconds_per_liquidity_x128(s.liquidity, time_delta)
            }
        }
    

(* 
    Update the cumulative values stored for the recent timestamps.

    This has to be called on every update to the contract, not necessarily
    for each block. Currently all cumulatives keep time-weighted sum of something,
    so we can extrapolate these cumulatives on periods of the contract's inactivity. 
*)
let update_timed_cumulatives (s : storage) : storage =
    let buffer = s.cumulatives_buffer in

    let last_value = get_last_cumulatives buffer in
    (* Update not more often than once per block *)
    if last_value.time = Tezos.get_now() then s
    else
        let time_passed = abs (Tezos.get_now() - last_value.time) in
        let new_value = { 
            tick = { 
                block_start_value = s.cur_tick_index;
                sum = last_value.tick.sum + time_passed * s.cur_tick_index.i
            };
            spl = { 
                block_start_liquidity_value = s.liquidity;
                sum =
                    let spl_since_last_block_x128 = 
                        eval_seconds_per_liquidity_x128(s.liquidity, time_passed) in
                        { x128 = last_value.spl.sum.x128 + spl_since_last_block_x128 };
            };
            time = Tezos.get_now()
        } in

        let new_last = buffer.last + 1n in
        let (new_first, delete_old) =
            (* preserve the oldest element if reserves allow this *)
            if buffer.last - buffer.first < buffer.reserved_length - 1
            then (buffer.first, false) else (buffer.first + 1n, true) in
        let new_map = Big_map.add new_last new_value buffer.map in
        let new_map = if delete_old
            then Big_map.remove buffer.first new_map
            else new_map in

        let new_buffer = {
            map = new_map;
            last = new_last;
            first = new_first;
            reserved_length = buffer.reserved_length;
        }
        in {s with cumulatives_buffer = new_buffer}


(* Called by voter to transfer the protocol share of swap fees over to the fee distributor *)
let forward_fee (s: storage) (p: forwardFee_params) : result =
    let voter = 
        match Tezos.call_view "get_voter_address" unit s.constants.factory with
        | None -> failwith invalid_contract
        | Some v -> v in
    let _: unit = if Tezos.get_sender () <> voter then failwith not_authorised else unit in

    let fee_distributor: add_fees_params contract = 
        match Tezos.get_entrypoint_opt "%add_fees" p.feeDistributor with
        | None -> failwith invalid_contract
        | Some c -> c in
    
    (* Takes the local `token` type used in the cfmm and builds the interop type *)
    let resolve_token (local: token) = 
        match local with
        | Fa12 addr -> Fa_12(addr)
        | Fa2 (addr, token_id) -> Fa_2(addr, token_id) 
    in

    let fees = Map.literal [
        (resolve_token s.constants.token_x, s.protocol_share.x); 
        (resolve_token s.constants.token_y, s.protocol_share.y);
    ] in 

    (* Send protocol share to fee distributor *)
    let ops = 
        if s.protocol_share.x > 0n then
            [cfmm_token_transfer (Tezos.get_self_address ()) p.feeDistributor s.protocol_share.x s.constants.token_x]
        else []
    in
    let ops =
        if s.protocol_share.y > 0n then
            (cfmm_token_transfer (Tezos.get_self_address ()) p.feeDistributor s.protocol_share.y s.constants.token_y)::ops 
        else ops
    in
    
    (* Set the fee values in fee distributor *)
    let params = { epoch = p.epoch; fees = fees } in
    let op_add_fees = Tezos.transaction params 0mutez fee_distributor in

    op_add_fees::ops, { s with protocol_share = { x = 0n; y = 0n } }


(* Allows for transfer of the dev share of swap fees over to the dev address *)
let retrieve_dev_share (s: storage) : result =
    let dev = 
        match Tezos.call_view "get_dev_address" unit s.constants.factory with
        | None -> failwith invalid_contract
        | Some v -> v in
    let _: unit = if Tezos.get_sender () <> dev then failwith not_authorised else unit in

    (* Send dev share to dev address *)
    let ops =
        if s.dev_share.x > 0n then
            [cfmm_token_transfer (Tezos.get_self_address ()) dev s.dev_share.x s.constants.token_x] 
        else []
    in
    let ops = 
        if s.dev_share.y > 0n then
            (cfmm_token_transfer (Tezos.get_self_address ()) dev s.dev_share.y s.constants.token_y)::ops 
        else ops 
    in

    ops, { s with dev_share = { x = 0n; y = 0n } }


(* Allows specific features/functionalities of the pool to be paused *)
let pause (s: storage) (paused_value: paused_value): result = 
    let _: unit = if Tezos.get_sender () <> s.constants.factory then failwith not_authorised else unit in
    [], { s with paused = paused_value }


(* Allows for toggling the pool to be a part of ve-system *)
let toggle_ve (s: storage) : result =
    let _: unit = if Tezos.get_sender () <> s.constants.factory then failwith not_authorised else unit in
    [], { s with is_ve = not s.is_ve }


(* Views*)

(* 
    View that returns cumulative values at given range at the current moment
    of time. 
    Note: This works only for initialized indexes. 
*)
[@view]
let snapshot_cumulatives_inside (p, s: snapshot_cumulatives_inside_param * storage) : cumulatives_inside_snapshot =
    let _: unit = if p.lower_tick_index > p.upper_tick_index then failwith tick_order_err else unit in

    let last_value = get_last_cumulatives s.cumulatives_buffer in

    let time_passed = abs (Tezos.get_now() - last_value.time) in

    (* Recalculate spl to have the latest value *)
    let spl = 
        let spl_since_last_block_x128 = eval_seconds_per_liquidity_x128(s.liquidity, time_passed) in
        last_value.spl.sum.x128 + spl_since_last_block_x128 
    in

    let cums_total = { 
        tick = last_value.tick.sum + time_passed * s.cur_tick_index.i;
        seconds = Tezos.get_now() - epoch_time;
        seconds_per_liquidity = {x128 = int spl}
    } in

    [@inline]
    let eval_cums (above, index, cums_outside : bool * tick_index * cumulatives_data) =
        (* Formula 6.22 when 'above', 6.23 otherwise *)
        if (s.cur_tick_index >= index) = above
        then { 
            tick = cums_total.tick - cums_outside.tick; 
            seconds = cums_total.seconds - cums_outside.seconds;
            seconds_per_liquidity = {
                x128 = cums_total.seconds_per_liquidity.x128 - cums_outside.seconds_per_liquidity.x128
            }
        }
        else
            cums_outside
        in

    let lower_tick = get_tick s.ticks p.lower_tick_index tick_not_exist_err in
    let upper_tick = get_tick s.ticks p.upper_tick_index tick_not_exist_err in

    let lower_cums_outside = { 
        tick = lower_tick.tick_cumulative_outside;
        seconds = int lower_tick.seconds_outside; 
        seconds_per_liquidity = { x128 = int lower_tick.seconds_per_liquidity_outside.x128 }
    } in
    let upper_cums_outside = { 
        tick = upper_tick.tick_cumulative_outside;
        seconds = int upper_tick.seconds_outside;
        seconds_per_liquidity = { x128 = int upper_tick.seconds_per_liquidity_outside.x128 }
    } in

    let cums_below_lower = eval_cums(false, p.lower_tick_index, lower_cums_outside) in
    let cums_above_upper = eval_cums(true, p.upper_tick_index, upper_cums_outside) in
    { 
        tick_cumulative_inside = cums_total.tick - cums_below_lower.tick - cums_above_upper.tick;
        seconds_inside = cums_total.seconds - cums_below_lower.seconds - cums_above_upper.seconds;
        seconds_per_liquidity_inside = {
            x128 = cums_total.seconds_per_liquidity.x128
                - cums_below_lower.seconds_per_liquidity.x128
                - cums_above_upper.seconds_per_liquidity.x128
        }
    }


[@view]
let observe (times, s: timestamp list * storage) : cumulatives_value list =
    List.map (get_cumulatives s) times


[@view]
let get_position_info (position_id, s : position_id * storage) : position_info  =
    let position = get_position(position_id, s.positions) in
        { 
            liquidity = position.liquidity;
            owner = get_owner position_id s.ledger;
            lower_tick_index = position.lower_tick_index;
            upper_tick_index = position.upper_tick_index
        }


let main ((p, s) : parameter * storage) : result =
    let _: unit = if (Tezos.get_amount ()) = 0tez then unit else failwith non_zero_transfer_err in
    
    (* Start by updating the oracles *)
    let s = update_timed_cumulatives s in
    
    (* Dispatch call to the proper entrypoint *)
    match p with
        | X_to_y p -> x_to_y s p
        | Y_to_x p -> y_to_x s p
        | Set_position p -> set_position s p
        | Update_position p -> update_position s p
        | Call_fa2 p -> call_fa2 s p
        | Increase_observation_count n -> increase_observation_count(s, n)
        | ForwardFee p -> forward_fee s p
        | Retrieve_dev_share -> retrieve_dev_share s
        | Pause p -> pause s p
        | Toggle_ve -> toggle_ve s
