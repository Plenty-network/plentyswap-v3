(* This file has functions that may take in some values from the storage of the cfmm contract or transaction context and build a specific part of the metadata svg *)

#include "./types.mligo"
#include "./helpers.mligo"
#include "./segments.mligo"
#include "./variations.mligo"

#if !METADATA_BUILDER
#define METADATA_BUILDER

let build_background (seed: nat): bytes = 
    Bytes.concats [
        pre_blur_1;
        (match Map.find_opt seed blur_color_1 with Some c -> c | None -> failwith "impossible");
        pre_blur_2;
        (match Map.find_opt seed blur_color_2 with Some c -> c | None -> failwith "impossible");
        pre_blur_3;
        (match Map.find_opt seed blur_color_3 with Some c -> c | None -> failwith "impossible");
        blur_close
    ]

let build_range_indicator (in_range: bool): bytes =
    Bytes.concats [
        pre_range_1;
        (if in_range then in_range_color else out_range_color);
        pre_range_2;
        (if in_range then in_range_color else out_range_color);
        pre_range_3;
        (if in_range then in_range_color else out_range_color);
        pre_range_4;
        (if in_range then in_range_color else out_range_color);
        pre_range_5;
        (if in_range then in_range_color else out_range_color);
        pre_range_6; 
        (if in_range then in_range_color else out_range_color);
        range_close
    ]

let build_tick_texts (min_tick: int) (max_tick: int): bytes =
    let min_tick_bytes = Bytes.concat (if min_tick < 0 then 0x2d else 0x2b) (bytes_of_nat (abs min_tick)) in
    let max_tick_bytes = Bytes.concat (if max_tick < 0 then 0x2d else 0x2b) (bytes_of_nat (abs max_tick)) in
    Bytes.concats [
        pre_min_tick;
        min_tick_bytes;
        pre_max_tick;
        max_tick_bytes;
        tick_close
    ]

let build_token_amounts (token_x: token_data) (token_y: token_data): bytes =
    let format_amount (amount: nat) (decimals: nat): bytes =
        let whole = amount / decimals in
        let fraction = amount mod decimals in
        if whole >= 10000n then
            let shorten (limit: nat) (symbol: bytes): bytes = 
                let whole_new = whole / limit in
                let fraction_new = whole mod limit in
                let bytes_to_trim = bytes_of_nat (fraction_new + limit) in
                Bytes.concats [(bytes_of_nat whole_new); 0x2e; (Bytes.sub 1n 3n bytes_to_trim); symbol]
            in
            if whole >= billion then shorten billion 0x42 
            else if whole >= million then shorten million 0x4d
            else shorten thousand 0x4b
        else
            let bytes_to_trim = bytes_of_nat (fraction + decimals) in
            let decimals_to_show = 
                if whole > 1000n then 2n else if whole > 100n then 3n else if whole > 10n then 4n else 5n in
            Bytes.concats [bytes_of_nat whole; 0x2e; (Bytes.sub 1n decimals_to_show bytes_to_trim)]
    in
    let token_x_amount_bytes = format_amount token_x.amount token_x.decimals in
    let token_y_amount_bytes = format_amount token_y.amount token_y.decimals in
    Bytes.concats [
        pre_token_x;
        token_x.symbol;
        gap_colon_gap;
        token_x_amount_bytes;
        pre_token_y;
        token_y.symbol;
        gap_colon_gap;
        token_y_amount_bytes;
        token_amount_close
    ]

let build_ticker (token_x_symbol: bytes) (token_y_symbol: bytes): bytes =
    Bytes.concats [pre_ticker; token_x_symbol; 0x202f20; token_y_symbol; ticker_close]

let build_curve (min_tick: int) (max_tick: int): bytes =
    let diff = abs (max_tick - min_tick) in
    let dx = (diff * 200n) / 400n in
    let cp_x1 = (178n - (if dx < 200n then dx else 200n)) in
    let cp_y1 = abs (356n - cp_x1) in
    let cp_x2 = abs (356n - (if dx < 200n then dx else 200n)) in
    let cp_y2 = abs (712n - cp_x2) in
    Bytes.concats [
        pre_curve;
        Bytes.concat (if cp_x1 < 0 then 0x2d else 0x) (bytes_of_nat (abs cp_x1));
        0x2c;
        bytes_of_nat cp_y1;
        0x2c;
        bytes_of_nat cp_x2;
        0x2c;
        bytes_of_nat cp_y2;
        curve_close
    ]

let build_fee (fee_tier: nat): bytes =
    let fees = 
        if fee_tier = 1n then bps_1 
        else if fee_tier = 5n then bps_5 
        else if fee_tier = 30n then bps_30
        else bps_100
    in 
    Bytes.concats [
        pre_fees;
        fees;
        fees_close
    ]

let build_sliders (min_tick: int) (max_tick: int): bytes = 
    let scale_tick (tick: int): nat =
        let scaling_factor = 31805n in
        let flipped = -tick in
        let scaled_tick = 443n + ((flipped * scaling_factor) / 100000000n) in
        abs scaled_tick
    in
    Bytes.concats [
        pre_max_slider;
        bytes_of_nat (scale_tick max_tick);
        pre_min_slider;
        bytes_of_nat (scale_tick min_tick);
        slider_close
    ]


#endif