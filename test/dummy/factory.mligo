type storage = {
  shares: nat * nat;
}

type parameter = Default

[@view]
let get_fee_shares (_, store: unit * storage) = store.shares

let main (action, _: parameter * storage): operation list * storage = 
  [], (match action with Default -> failwith "Not allowed")