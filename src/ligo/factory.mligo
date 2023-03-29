#include "./common/types.mligo"
#include "./common/defaults.mligo"
#include "./common/errors.mligo"
#include "./common/create_contract.mligo"

(* Factory storage and parameters *)

type pool_key = token * token * nat

(* Mapping fee bps -> tick spacing *)
(* Initial values: 
    0.01% -> 1
    0.05% -> 10
    0.30% -> 60
    1% -> 200
*)
type fee_tiers = (nat, nat) map

type factory_storage = {
    admin: address;
    proposed_admin: address option;
    pools: (pool_key, address) big_map;
    fee_tiers: fee_tiers;
}

type deploy_pool_params = [@layout:comb] {
    token_x: token;
    token_y: token;
    fee_bps: nat;
}

type parameter =
    | Deploy_pool of deploy_pool_params
    | Update_fee_tiers of fee_tiers
    | Propose_new_admin of address
    | Accept_new_admin

type return = operation list * factory_storage 


(* Entrypoints *)

let deploy_pool (params: deploy_pool_params) (store: factory_storage) : return  =
    let { token_x; token_y; fee_bps; } = params in
    
    let tick_spacing = match Map.find_opt fee_bps store.fee_tiers with
    | None -> failwith "invalid_fee_tier" 
    | Some ts -> ts in

    let c: constants = {
        factory = Tezos.get_self_address ();
        fee_bps = fee_bps;
        token_x = token_x;
        token_y = token_y;
        tick_spacing = tick_spacing;
    } in

    (* TODO: replace the dummy link *)
    let metadata_url = 0x68747470733a2f2f6d657461646174615f75726c2e636f6d in

    (* Construct pool storage *)
    (* TODO: Make extra slots dynamic? *)
    let pool_storage = default_storage c 0n (Big_map.literal [("", metadata_url)]) in
    
    let (op, addr) = create_contract { delegate = None; balance = 0mutez; storage = pool_storage } in

    (* Insert pool into storage *)
    let updated_pools = Big_map.update (token_x, token_y, fee_bps) (Some addr) store.pools in
    ([op], { store with pools = updated_pools; })


(* Allows the admin to update the fee tiers *)
let update_fee_tiers (params: fee_tiers) (store: factory_storage) : return =
    if Tezos.get_sender () <> store.admin then failwith not_authorised 
    else
        ([], { store with fee_tiers = params })


(* Admin change logic *)

let propose_new_admin (address: address) (store: factory_storage) : return =
    if Tezos.get_sender () <> store.admin then failwith not_authorised 
    else
        ([], { store with proposed_admin = Some address })

let accept_new_admin (store: factory_storage) : return =
    match store.proposed_admin with 
    | None -> failwith not_authorised
    | Some addr -> 
        if Tezos.get_sender () = addr then ([], { store with admin = addr; proposed_admin = None })
        else failwith not_authorised


let main (action, store: parameter * factory_storage) : return =
    match action with
    | Deploy_pool params -> deploy_pool params store
    | Update_fee_tiers params -> update_fee_tiers params store
    | Propose_new_admin params -> propose_new_admin params store
    | Accept_new_admin -> accept_new_admin store