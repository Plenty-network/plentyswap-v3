#include "../../src/ligo/common/types.mligo"

type storage = {
  ve: bool option;
  position: position_info option;
  cumulatives_inside_snapshot: cumulatives_inside_snapshot option;
  transfer_params: transfer_params option;
}

type parameter = 
  | Toggle_ve
  | Transfer of transfer_params
  | Default

[@view] let get_position_info (_, store: nat * storage) = Option.unopt store.position

[@view] let snapshot_cumulatives_inside (_, store: { lower_tick_index: int; upper_tick_index: int } * storage) = Option.unopt store.cumulatives_inside_snapshot

let main (action, store: parameter * storage): operation list * storage = 
  [], (
  match action with 
  | Toggle_ve -> { store with ve = Some true } 
  | Transfer p -> { store with transfer_params = Some p }
  | Default -> failwith "Not allowed")