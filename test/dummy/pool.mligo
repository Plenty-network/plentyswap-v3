(* Only required for testing toggle_ve calls from factory *)

#include "../../src/ligo/common/types.mligo"

type storage = bool option

type parameter = 
  | Toggle_ve
  | Default

let main (action, _: parameter * storage): operation list * storage = 
  [], (match action with Toggle_ve -> (Some true) | Default -> failwith "Not allowed")