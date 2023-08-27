#include "./common/types.mligo"
#include "./common/errors.mligo"

type token_value = (bytes, "symbol", nat, "decimals") michelson_pair

type storage = {
    admins: address set;
    tokens: (token, token_value) big_map;
}

type parameter =
    | Add_admin of address
    | Remove_admin of address
    | Add_tokens of (token * token_value) list
    | Remove_tokens of token list

type return = operation list * storage

(* Entrypoints *)

let add_admin (addr: address) (store: storage): storage = 
    let _ = if not Set.mem (Tezos.get_sender ()) store.admins then failwith not_authorised else unit in
    { store with admins = Set.add addr store.admins }

let remove_admin (addr: address) (store: storage): storage = 
    let _ = if not Set.mem (Tezos.get_sender ()) store.admins then failwith not_authorised else unit in
    let _ = if (Set.cardinal store.admins) = 1n then failwith not_authorised else unit in
    { store with admins = Set.remove addr store.admins }

let add_tokens (tokens: (token * token_value) list) (store: storage): storage =
    let _ = if not Set.mem (Tezos.get_sender ()) store.admins then failwith not_authorised else unit in
    let rec aux (tokens: (token * token_value) list) (store: storage): storage =
        match tokens with
        | [] -> store
        | (token, data)::t -> aux t { store with tokens = Big_map.add token data store.tokens }
    in aux tokens store

let remove_tokens (tokens: token list) (store: storage): storage =
    let _ = if not Set.mem (Tezos.get_sender ()) store.admins then failwith not_authorised else unit in
    let rec aux (tokens: token list) (store: storage): storage =
        match tokens with
        | [] -> store
        | token::t -> aux t { store with tokens = Big_map.update token None store.tokens }
    in aux tokens store


(* Views *)

[@view]
let get_token_metadata (token, store: token * storage): token_value = 
    match Big_map.find_opt token store.tokens with 
    | Some t -> t
    | None -> failwith 100n (* Todo: change this to simply return None once the blank NFT is received *)


let main (action, s: parameter * storage): return =
    [], 
    (
        match action with
        | Add_admin p -> add_admin p s 
        | Remove_admin p -> remove_admin p s
        | Add_tokens p -> add_tokens p s 
        | Remove_tokens p -> remove_tokens p s
    )