#if !HELPERS_METADATA
#define HELPERS_METADATA

let bytes_of_nat (num : nat) : bytes = 
    let nat_to_bytes : (nat, bytes) map = Map.literal [
        (0n , 0x30); 
        (1n , 0x31);
        (2n , 0x32); 
        (3n , 0x33); 
        (4n , 0x34); 
        (5n , 0x35); 
        (6n , 0x36); 
        (7n , 0x37); 
        (8n , 0x38); 
        (9n , 0x39); 
    ] in
    let rec aux (n : nat) (res : bytes) : bytes =
        if n = 0n then res
        else aux (n / 10n) (Bytes.concat (Option.unopt (Map.find_opt (n mod 10n) nat_to_bytes)) res)
    in aux (num / 10n) (Option.unopt (Map.find_opt (num mod 10n) nat_to_bytes))

#endif