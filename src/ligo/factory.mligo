#include "./common/types.mligo"
#include "./common/consts.mligo"
#include "./common/defaults.mligo"
#include "./common/errors.mligo"
#include "./common/create_contract.mligo"

(* Factory storage and parameters *)

(* X, Y, fee_bps *)
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

    (* Dev team's wallet address *)
    dev: address;
    
    (* Share of pool fee going to the protocol when the pool is ve incentivised *)
    protocol_share_bps: nat;

    (* Share of pool fee going to the development team *)
    dev_share_bps: nat;

    (* Address of ve system's voter contract *)
    voter: address;
}

type deploy_pool_params = [@layout:comb] {
    token_x: token;
    token_y: token;
    initial_tick_index: tick_index;
    fee_bps: nat;
    extra_slots: nat;
}

type pause_pool_params = (pool_key, "pool_key", paused_value, "paused_value") michelson_pair

type parameter =
    | Deploy_pool of deploy_pool_params
    | Update_dev_share of nat
    | Update_protocol_share of nat
    | Update_voter_address of address
    | Update_dev_address of address
    | Update_fee_tiers of fee_tiers
    | Toggle_ve of pool_key
    | Pause_pool of pause_pool_params
    | Propose_new_admin of address
    | Accept_new_admin

type return = operation list * factory_storage 


(* Entrypoints *)

let deploy_pool (params: deploy_pool_params) (store: factory_storage) : return  =
    let { token_x; token_y; initial_tick_index; fee_bps; extra_slots; } = params in
    
    (* Token ordering must be the same everytime for same pairs *)
    let _ = if token_x > token_y then failwith invalid_token_ordering else unit in

    (* The pair with the selected fee tier should not have been deployed already *) 
    let _ = 
        if (Big_map.mem (token_x, token_y, fee_bps) store.pools) || 
        (Big_map.mem (token_y, token_x, fee_bps) store.pools) then
            failwith pool_already_exists
        else unit in

    let tick_spacing = match Map.find_opt fee_bps store.fee_tiers with
    | None -> failwith invalid_fee_tier 
    | Some ts -> ts in

    let c: constants = {
        factory = Tezos.get_self_address ();
        fee_bps = fee_bps;
        token_x = token_x;
        token_y = token_y;
        tick_spacing = tick_spacing;
    } in

    (* TODO: replace the dummy link *)
    let metadata_url = 0x697066733a2f2f516d537776726b71714a5276465a7775707a444763766875786369644c4151717a535766794838434c7033644338 in

    (* Construct pool storage *)
    let pool_storage = default_storage c initial_tick_index extra_slots (Big_map.literal [("", metadata_url)]) in
    
    let (op, addr) = create_contract { delegate = None; balance = 0mutez; storage = pool_storage } in

    (* Insert pool into storage *)
    let updated_pools = Big_map.update (token_x, token_y, fee_bps) (Some addr) store.pools in
    ([op], { store with pools = updated_pools; })


let update_dev_share (share: nat) (store: factory_storage) : return =
    let _ = if Tezos.get_sender () <> store.admin then failwith not_authorised else unit in
    let _ = if share > max_dev_share then failwith invalid_dev_share else unit in
    ([], { store with dev_share_bps = share })


let update_protocol_share (share: nat) (store: factory_storage) : return =
    let _ = if Tezos.get_sender () <> store.admin then failwith not_authorised else unit in
    let _ = if share > max_protocol_share then failwith invalid_protocol_share else unit in
    ([], { store with protocol_share_bps = share })


let update_voter_address (voter: address) (store: factory_storage) : return =
    if Tezos.get_sender () <> store.admin then failwith not_authorised 
    else
        ([], { store with voter = voter })
    

let update_dev_address (dev: address) (store: factory_storage) : return =
    if Tezos.get_sender () <> store.admin then failwith not_authorised 
    else
        ([], { store with dev = dev })


let update_fee_tiers (params: fee_tiers) (store: factory_storage) : return =
    if Tezos.get_sender () <> store.admin then failwith not_authorised 
    else
        ([], { store with fee_tiers = params })


let pause_pool (pool_key, paused_value: pause_pool_params) (store: factory_storage): return =
    let _ = if Tezos.get_sender () <> store.admin then failwith not_authorised else unit in
    match Big_map.find_opt pool_key store.pools with
    | None -> failwith invalid_pool
    | Some pool -> begin
        let pool_contract: paused_value contract option = Tezos.get_entrypoint_opt "%pause" pool in
        match pool_contract with
        | None -> failwith invalid_contract
        | Some c -> [Tezos.transaction paused_value 0mutez c], store
    end


(* Allows the admin to add/remove a pool from the ve system *)
let toggle_ve (pool_key: pool_key) (store: factory_storage) : return =
    let _ = if Tezos.get_sender () <> store.admin then failwith not_authorised else unit in
    match Big_map.find_opt pool_key store.pools with
    | None -> failwith invalid_pool
    | Some pool -> begin
        let pool_contract: unit contract option = Tezos.get_entrypoint_opt "%toggle_ve" pool in
        match pool_contract with
        | None -> failwith invalid_contract
        | Some c -> [Tezos.transaction unit 0mutez c], store
    end

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


(* Views *)

[@view]
let get_fee_shares (_, store: unit * factory_storage) : nat * nat =
    (store.dev_share_bps, store.protocol_share_bps)

[@view]
let get_voter_address (_, store: unit * factory_storage) : address =
    store.voter

[@view]
let get_dev_address (_, store: unit * factory_storage) : address =
    store.dev

let main (action, store: parameter * factory_storage) : return =
    let _ = if Tezos.get_amount () <> 0mutez then failwith tez_not_accepted else unit in

    match action with
    | Deploy_pool params -> deploy_pool params store
    | Update_dev_share params -> update_dev_share params store
    | Update_protocol_share params -> update_protocol_share params store
    | Update_voter_address params -> update_voter_address params store
    | Update_dev_address params -> update_dev_address params store 
    | Update_fee_tiers params -> update_fee_tiers params store
    | Pause_pool params -> pause_pool params store
    | Toggle_ve params -> toggle_ve params store
    | Propose_new_admin params -> propose_new_admin params store
    | Accept_new_admin -> accept_new_admin store