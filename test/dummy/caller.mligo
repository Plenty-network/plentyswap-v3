(* This is used to call `balance_of` EP of core *)

#include "../../src/ligo/common/types.mligo"

type storage = {
    balances: nat list;
}

type parameter = 
    | Call of address * balance_request_item list
    | Set of balance_response_item list

let main (action, store : parameter * storage) : operation list * storage =
    match action with 
    | Call (addr, req) -> begin
        match ((Tezos.get_entrypoint_opt "%balance_of" addr) : balance_request_params contract option) with 
        | None -> failwith 0
        | Some c -> 
            let call_params = { 
                requests = req; 
                callback = (Tezos.self "%set" : (balance_response_item list) contract)
            } in
        [Tezos.transaction call_params 0mutez c], store
    end
    | Set params -> [], { balances = List.map (fun (item: balance_response_item) -> item.balance) params }