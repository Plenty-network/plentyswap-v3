import BigNumber from "bignumber.js";
import { MAX_TICK, Tick } from "@plenty-labs/v3-sdk";
import { MichelsonMap, UnitValue } from "@taquito/taquito";

import { number } from "./math";
import { CoreStorage, TickState, TimedCumulatives, FactoryStorage, FarmStorage } from "../types";
import { accounts } from "./accounts";

export const DECIMALS = 10 ** 6;

// Binary exponentiation ladder
const ladder = new MichelsonMap();

ladder.set(
  { exp: 0, positive: true },
  { v: new BigNumber("38687560557337355742483221"), offset: -85 }
);
ladder.set(
  { exp: 1, positive: true },
  { v: new BigNumber("38689494983725479307861971"), offset: -85 }
);
ladder.set(
  { exp: 2, positive: true },
  { v: new BigNumber("38693364126677775184793561"), offset: -85 }
);
ladder.set(
  { exp: 3, positive: true },
  { v: new BigNumber("38701103573421987005215721"), offset: -85 }
);
ladder.set(
  { exp: 4, positive: true },
  { v: new BigNumber("38716587111352494729706462"), offset: -85 }
);
ladder.set(
  { exp: 5, positive: true },
  { v: new BigNumber("38747572773653928660613512"), offset: -85 }
);
ladder.set(
  { exp: 6, positive: true },
  { v: new BigNumber("38809618513447185627569983"), offset: -85 }
);
ladder.set(
  { exp: 7, positive: true },
  { v: new BigNumber("38934008210058939100663682"), offset: -85 }
);
ladder.set(
  { exp: 8, positive: true },
  { v: new BigNumber("39183984934869404935943141"), offset: -85 }
);
ladder.set(
  { exp: 9, positive: true },
  { v: new BigNumber("39688763633815974521145659"), offset: -85 }
);
ladder.set(
  { exp: 10, positive: true },
  { v: new BigNumber("40717912888646086984030507"), offset: -85 }
);
ladder.set(
  { exp: 11, positive: true },
  { v: new BigNumber("42856962434838368098529959"), offset: -85 }
);
ladder.set(
  { exp: 12, positive: true },
  { v: new BigNumber("47478079282778087338933597"), offset: -85 }
);
ladder.set(
  { exp: 13, positive: true },
  { v: new BigNumber("29134438707490415855866100"), offset: -84 }
);
ladder.set(
  { exp: 14, positive: true },
  { v: new BigNumber("43882733799120415566608322"), offset: -84 }
);
ladder.set(
  { exp: 15, positive: true },
  { v: new BigNumber("49778031622173924435819796"), offset: -83 }
);
ladder.set(
  { exp: 16, positive: true },
  { v: new BigNumber("32025492072892644517427309"), offset: -80 }
);
ladder.set(
  { exp: 17, positive: true },
  { v: new BigNumber("53023938993515524338629870"), offset: -76 }
);
ladder.set(
  { exp: 18, positive: true },
  { v: new BigNumber("36338278329035183585718600"), offset: -66 }
);
ladder.set(
  { exp: 19, positive: true },
  { v: new BigNumber("34133361681864713959105863"), offset: -47 }
);

ladder.set(
  { exp: 0, positive: false },
  { v: new BigNumber("19341845997356488514015570"), offset: -84 }
);
ladder.set(
  { exp: 1, positive: false },
  { v: new BigNumber("2417609866154190654524678"), offset: -81 }
);
ladder.set(
  { exp: 2, positive: false },
  { v: new BigNumber("38677889876083546261210550"), offset: -85 }
);
ladder.set(
  { exp: 3, positive: false },
  { v: new BigNumber("38670155071614559132217310"), offset: -85 }
);
ladder.set(
  { exp: 4, positive: false },
  { v: new BigNumber("19327345051392939314248854"), offset: -84 }
);
ladder.set(
  { exp: 5, positive: false },
  { v: new BigNumber("19311889358453304431405214"), offset: -84 }
);
ladder.set(
  { exp: 6, positive: false },
  { v: new BigNumber("77124060166079386301517011"), offset: -86 }
);
ladder.set(
  { exp: 7, positive: false },
  { v: new BigNumber("38438828813936263312862610"), offset: -85 }
);
ladder.set(
  { exp: 8, positive: false },
  { v: new BigNumber("76387211720013513967242610"), offset: -86 }
);
ladder.set(
  { exp: 9, positive: false },
  { v: new BigNumber("75415686436335201065707301"), offset: -86 }
);
ladder.set(
  { exp: 10, positive: false },
  { v: new BigNumber("73509547540888574991368714"), offset: -86 }
);
ladder.set(
  { exp: 11, positive: false },
  { v: new BigNumber("17460146398643019245576278"), offset: -84 }
);
ladder.set(
  { exp: 12, positive: false },
  { v: new BigNumber("126085780994910985395717054"), offset: -87 }
);
ladder.set(
  { exp: 13, positive: false },
  { v: new BigNumber("102735988268212419722671870"), offset: -87 }
);
ladder.set(
  { exp: 14, positive: false },
  { v: new BigNumber("68208042073114503830679361"), offset: -87 }
);
ladder.set(
  { exp: 15, positive: false },
  { v: new BigNumber("60130046442422405275353178"), offset: -88 }
);
ladder.set(
  { exp: 16, positive: false },
  { v: new BigNumber("11682706336100247487260846"), offset: -88 }
);
ladder.set(
  { exp: 17, positive: false },
  { v: new BigNumber("56449132412055094618915006"), offset: -95 }
);
ladder.set(
  { exp: 18, positive: false },
  { v: new BigNumber("20592303012757789234393034"), offset: -103 }
);
ladder.set(
  { exp: 19, positive: false },
  { v: new BigNumber("1370156647050591448120178"), offset: -118 }
);

export const getDefaultCoreStorage = (): CoreStorage => {
  const ticks = new MichelsonMap<number, TickState>();

  ticks.set(-MAX_TICK, {
    prev: number(-MAX_TICK - 1),
    next: number(MAX_TICK),
    liquidity_net: number(0),
    n_positions: number(1),
    seconds_outside: number(0),
    tick_cumulative_outside: number(0),
    fee_growth_outside: { x: number(0), y: number(0) },
    seconds_per_liquidity_outside: number(0),
    sqrt_price: Tick.computeSqrtPriceFromTick(-MAX_TICK),
  });

  ticks.set(MAX_TICK, {
    prev: number(-MAX_TICK),
    next: number(MAX_TICK + 1),
    liquidity_net: number(0),
    n_positions: number(1),
    seconds_outside: number(0),
    tick_cumulative_outside: number(0),
    fee_growth_outside: { x: number(0), y: number(0) },
    seconds_per_liquidity_outside: number(0),
    sqrt_price: Tick.computeSqrtPriceFromTick(MAX_TICK),
  });

  const timedCumulatives = new MichelsonMap<number, TimedCumulatives>();

  timedCumulatives.set(0, {
    time: 0,
    tick: { sum: number(0), block_start_value: number(0) },
    spl: { sum: number(0), block_start_liquidity_value: number(0) },
  });

  return {
    liquidity: number(0),
    sqrt_price: Tick.computeSqrtPriceFromTick(0),
    cur_tick_index: number(0),
    cur_tick_witness: number(-MAX_TICK),
    fee_growth: {
      x: number(0),
      y: number(0),
    },
    dev_share: {
      x: number(0),
      y: number(0),
    },
    protocol_share: {
      x: number(0),
      y: number(0),
    },
    ticks,
    positions: new MichelsonMap(),
    cumulatives_buffer: {
      map: timedCumulatives,
      first: number(0),
      last: number(0),
      reserved_length: number(1),
    },
    metadata: new MichelsonMap(),
    new_position_id: number(0),
    operators: new MichelsonMap(),
    constants: {
      factory: "tz1PWmqx43ZWaG4Hsze5dN3MHKhqxz19CDoG", // Dummy
      fee_bps: number(5), // 5 bps
      token_x: { fa12: "tz1PWmqx43ZWaG4Hsze5dN3MHKhqxz19CDoG" }, // Dummy
      token_y: { fa12: "tz1PWmqx43ZWaG4Hsze5dN3MHKhqxz19CDoG" }, // Dummy
      tick_spacing: number(10),
    },
    ladder,
    is_ve: false,
  };
};

// Function to return default factory storage
export const getDefaultFactoryStorage = (): FactoryStorage => {
  const feeTiers = new MichelsonMap<number, number>();
  feeTiers.set(1, 1);
  feeTiers.set(5, 10);
  feeTiers.set(30, 60);
  feeTiers.set(100, 200);

  return {
    admin: accounts.alice.pkh,
    proposed_admin: null,
    pools: new MichelsonMap(),
    fee_tiers: feeTiers,
    dev: accounts.alice.pkh,
    protocol_share_bps: 2000,
    dev_share_bps: 1500,
    voter: accounts.alice.pkh,
  };
};

// Function to return default farm storage
export const getDefaultFarmStorage = (): FarmStorage => {
  return {
    admin: accounts.alice.pkh,
    proposed_admin: null,
    cfmm_address: accounts.bob.pkh,
    last_incentive_id: 0,
    incentives: new MichelsonMap(),
    deposits: new MichelsonMap(),
    stakes: new MichelsonMap(),
    rewards: new MichelsonMap(),
  };
};
