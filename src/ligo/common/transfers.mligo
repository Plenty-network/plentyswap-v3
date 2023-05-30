(* 
    Taken and modified from the original code at: 
    https://github.com/tezos-checker/segmented-cfmm/blob/master/ligo/transfers.mligo 
*)

#include "./types.mligo"
#include "./errors.mligo"

type transfer_fa2 = (address * (address * (token_id * nat)) list) list
type transfer_fa12 = address * (address * nat)

let cfmm_token_transfer (from : address) (to_ : address) (amnt : nat) (t : token) : operation =
    match t with
    | Fa2 (addr, token_id) -> begin
        let token_contract: transfer_fa2 contract =
            match (Tezos.get_entrypoint_opt "%transfer" addr : transfer_fa2 contract option) with
            | None -> failwith asset_transfer_invalid_entrypoints_err
            | Some c -> c in
        Tezos.transaction [(from, [(to_, (token_id, amnt))])] 0mutez token_contract
    end
    | Fa12 addr -> begin
        let token_contract: transfer_fa12 contract =
            match (Tezos.get_entrypoint_opt "%transfer" addr : transfer_fa12 contract option) with
            | None -> failwith asset_transfer_invalid_entrypoints_err
            | Some c -> c in
        Tezos.transaction (from, (to_, amnt)) 0mutez token_contract
    end
    | Tez -> failwith internal_impossible_err