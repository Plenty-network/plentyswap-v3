import BigNumber from "bignumber.js";
import { MichelsonMap, UnitValue } from "@taquito/taquito";

export interface Tez {
  tez: typeof UnitValue;
}

export interface Fa12 {
  fa12: string;
}

export interface Fa2 {
  fa2: {
    address: string;
    token_id: BigNumber;
  };
}

export type Token = Fa12 | Fa2 | Tez;

export interface FA12Storage {
  administrator: string;
  balances: MichelsonMap<
    string,
    { balance: BigNumber; approvals: MichelsonMap<string, BigNumber> }
  >;
  metadata: MichelsonMap<any, any>;
  paused: boolean;
  token_metadata: MichelsonMap<
    number,
    { token_id: number; token_info: MichelsonMap<string, string> }
  >;
  totalSupply: BigNumber;
}

export interface FA2Storage {
  administrator: string;
  last_token_id: number;
  ledger: MichelsonMap<{ 0: string; 1: number }, BigNumber>;
  metadata: MichelsonMap<any, any>;
  operators: MichelsonMap<any, any>;
  paused: boolean;
  supply: MichelsonMap<any, any>;
  token_metadata: MichelsonMap<
    number,
    { token_id: number; token_info: MichelsonMap<string, string> }
  >;
}

export interface TimedCumulatives {
  time: number;
  tick: { sum: BigNumber; block_start_value: BigNumber };
  spl: { sum: BigNumber; block_start_liquidity_value: BigNumber };
}

export interface Position {
  fee_growth_inside_last: {
    x: BigNumber;
    y: BigNumber;
  };
  liquidity: BigNumber;
  lower_tick_index: BigNumber;
  upper_tick_index: BigNumber;
  owner: string;
}

export interface TickState {
  prev: BigNumber;
  next: BigNumber;
  liquidity_net: BigNumber;
  n_positions: BigNumber;
  seconds_outside: BigNumber;
  tick_cumulative_outside: BigNumber;
  fee_growth_outside: { x: BigNumber; y: BigNumber };
  seconds_per_liquidity_outside: BigNumber;
  sqrt_price: BigNumber;
}

export interface CoreStorage {
  liquidity: BigNumber;
  sqrt_price: BigNumber;
  cur_tick_index: BigNumber;
  cur_tick_witness: BigNumber;
  fee_growth: {
    x: BigNumber;
    y: BigNumber;
  };
  dev_share: {
    x: BigNumber;
    y: BigNumber;
  };
  protocol_share: {
    x: BigNumber;
    y: BigNumber;
  };
  ticks: MichelsonMap<number, TickState>;
  positions: MichelsonMap<number, Position>;
  cumulatives_buffer: {
    map: MichelsonMap<number, TimedCumulatives>;
    first: BigNumber;
    last: BigNumber;
    reserved_length: BigNumber;
  };
  metadata: MichelsonMap<any, any>;
  new_position_id: BigNumber;
  operators: MichelsonMap<any, any>;
  constants: {
    factory: string;
    fee_bps: BigNumber;
    token_x: Token;
    token_y: Token;
    tick_spacing: BigNumber;
  };
  ladder: MichelsonMap<any, any>;
  is_ve: boolean;
}
