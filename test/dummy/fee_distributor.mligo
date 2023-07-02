#include "../../src/ligo/common/types.mligo"

type storage = add_fees_params option

type parameter = 
  | Add_fees of add_fees_params 
  | Default

let main (action, _: parameter * storage): operation list * storage = 
  [], (match action with Add_fees p -> (Some p) | Default -> failwith "Not allowed")