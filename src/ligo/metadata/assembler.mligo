#include "./types.mligo"
#include "./builder.mligo"
#include "./helpers.mligo"
#include "../common/types.mligo"
#include "../common/errors.mligo"
#include "../common/consts.mligo"
#include "../common/helpers.mligo"
#include "../common/token/fa2.mligo"

(* Metadata *)

(* Plenty V3 Liquidity Position *)
let name = 0x506c656e7479205633204c697175696469747920506f736974696f6e

(* 0 *)
let decimals = 0x30

(* pNFT *)
let symbol = 0x704e4654

let token_metadata (token_id, store : nat * storage) : token_metadata_value =
    let position = get_position (token_id, store.positions) in
    
    let lower_tick_index = position.lower_tick_index in 
    let upper_tick_index = position.upper_tick_index in
    let liquidity = position.liquidity in

    let cur_tick = store.cur_tick_index.i in
    let in_range = cur_tick >= lower_tick_index.i && cur_tick <= upper_tick_index.i in
    
    (* Pull token metadata from factory *)
    let xt_opt = 
        match Tezos.call_view "get_token_metadata" store.constants.token_x ("KT1WPqxWYRF3EWTFR6JwNBBcwHAi4huAb9sp": address) with
        | Some v -> v
        | None -> failwith invalid_contract in
    let yt_opt = 
        match Tezos.call_view "get_token_metadata" store.constants.token_y ("KT1WPqxWYRF3EWTFR6JwNBBcwHAi4huAb9sp": address) with
        | Some v -> v
        | None -> failwith invalid_contract in
    
    match xt_opt, yt_opt with
    | Some (x_symbol, x_decimals), Some (y_symbol, y_decimals) -> begin
        (* Resolve liquidity to token amounts *)
        let (x_amount, y_amount) = 
            let tick_u = get_tick store.ticks upper_tick_index internal_tick_not_exist_err in
            let tick_l = get_tick store.ticks lower_tick_index internal_tick_not_exist_err in
            let srp_u = tick_u.sqrt_price in
            let srp_l = tick_l.sqrt_price in
            if cur_tick < lower_tick_index.i then
                (
                    ceildiv_int (liquidity * (int (Bitwise.shift_left (assert_nat (srp_u.x80 - srp_l.x80, internal_sqrt_price_grow_err_1)) 80n))) (int (srp_l.x80 * srp_u.x80)),
                    0
                )
            else if lower_tick_index.i <= cur_tick && cur_tick < upper_tick_index.i then
                (
                    ceildiv_int (liquidity * (int (Bitwise.shift_left (assert_nat (srp_u.x80 - store.sqrt_price.x80, internal_sqrt_price_grow_err_2)) 80n))) (int (store.sqrt_price.x80 * srp_u.x80)),
                    ceildiv_int (liquidity * (store.sqrt_price.x80 - srp_l.x80)) pow_2_80
                )
            else
                (0, ceildiv_int (liquidity * (srp_u.x80 - srp_l.x80)) pow_2_80) 
        in
        
        let token_x: token_data = { symbol = x_symbol; amount = abs x_amount; decimals = x_decimals; } in
        let token_y: token_data = { symbol = y_symbol; amount = abs y_amount; decimals = y_decimals; } in

        let background_seed = 
            match store.constants.token_x, store.constants.token_y with 
            | Fa12 _, Fa2 _ -> 0n
            | Fa12 _, Fa12 _ -> 1n
            | _ -> 2n
        in

        (* Construct data uri *)
        let image_uri = Bytes.concats [
            build_background background_seed;
            build_range_indicator in_range;
            build_tick_texts lower_tick_index.i upper_tick_index.i;
            build_token_amounts token_x token_y;
            build_ticker token_x.symbol token_y.symbol;
            build_curve lower_tick_index.i upper_tick_index.i;
            build_fee store.constants.fee_bps;
            build_sliders lower_tick_index.i upper_tick_index.i;
            style
        ] in
        { 
            token_id = token_id;
            (* TZIP-21 compliant format *)
            token_info = Map.literal [
                ("name", name);
                ("symbol", symbol);
                ("decimals", decimals);
                ("thumbnailUri", image_uri);
                ("artifactUri", image_uri);
                ("displayUri", image_uri);
                ("ttl", bytes_of_nat 600n);
            ]; 
        }
    end
    | _, _ -> begin
        { 
            token_id = token_id;
            (* TZIP-21 compliant format *)
            token_info = Map.literal [
                ("name", name);
                ("symbol", symbol);
                ("decimals", decimals);
                ("thumbnailUri", blank_svg);
                ("artifactUri", blank_svg);
                ("displayUri", blank_svg);
                ("ttl", bytes_of_nat 600n);
            ]; 
        }
    end

    