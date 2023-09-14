#if !METADATA_TYPES
#define METADATA_TYPES

type token_data = {
  symbol: bytes;
  amount: nat;
  decimals: nat;
}

type token_metadata_value = {
  token_id : nat;
  token_info : (string, bytes) map;
}

#endif