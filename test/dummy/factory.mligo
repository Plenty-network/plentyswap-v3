type storage = {
  shares: nat * nat;
  address: address;
}

type parameter = Default

[@view]
let get_fee_shares (_, store: unit * storage) = store.shares

[@view]
let get_voter_address (_, store: unit * storage) = store.address

let main (action, _: parameter * storage): operation list * storage = 
  [], (match action with Default -> failwith "Not allowed")