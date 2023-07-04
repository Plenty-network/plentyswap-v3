(* 
    Taken and modified from the original code at: 
    https://github.com/tezos-checker/segmented-cfmm/blob/master/ligo/consts.mligo 
*)

#include "types.mligo"

#if CONSTS_MLIGO
#else
#define CONSTS_MLIGO

(* Note: `half_bps_pow` only supports sqrt_price up to this tick index: `2^20 - 1`
   when originated with the 'default_ladder'. *)
[@inline] let const_max_tick : nat = 1048575n

(* Invalid tick index. Shouldn't be reached. Cannot be defined as failwith
    due to `compile-storage` returning the error. *)
[@inline] let impossible_tick : nat = const_max_tick + 1n


[@inline] let epoch_time = (0 : timestamp)

(* 2^80 *)
[@inline] let pow_2_80n = 1208925819614629174706176n
[@inline] let pow_2_80  = 1208925819614629174706176

(*  Not quite constants, but effectively so in the context of individual pools since fee_bps itself
    is a constant. *)
[@inline] let one_minus_fee_bps (c : constants) : nat =
  abs(10000n - c.fee_bps)

[@inline] let max_dev_share = 4000n

[@inline] let max_protocol_share = 5000n

#endif
