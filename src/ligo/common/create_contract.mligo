#include "./types.mligo"

type params = [@layout:comb] {
    delegate : key_hash option;
    balance : tez;
    storage : storage;
}

[@inline]
let create_contract (params: params): (operation * address) =
    ([%Michelson ( {| 
        {
            UNPAIR 3;
            CREATE_CONTRACT #include "../../michelson/core.tz"
            ; 
            PAIR
        } 
    |} : params -> (operation * address))] params)
