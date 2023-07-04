import axios from "axios";
import BigNumber from "bignumber.js";
import { MichelsonMap } from "@taquito/taquito";
import { MAX_TICK, Tick } from "@plenty-labs/v3-sdk";

import Tezos from "../../tezos";
import { config } from "../../helpers/config";
import { accounts } from "../../helpers/accounts";
import { CoreStorage, TickState } from "../../types";
import { dateToTimestamp, number } from "../../helpers/math";
import { getDefaultCoreStorage } from "../../helpers/default";

describe("core.snapshot_cumulatives_inside", () => {
  let tezos: Tezos;
  let storage: CoreStorage;

  function differsByNoMoreThan(a: BigNumber, b: BigNumber, x: number) {
    if (a.minus(b).abs().isLessThan(x)) return true;
    else return false;
  }

  beforeEach(async () => {
    tezos = new Tezos(config.rpcURL);
    await tezos.setSigner(accounts.alice.sk);

    const ticks = new MichelsonMap<number, TickState>();

    ticks.set(-10, {
      prev: number(-MAX_TICK),
      next: number(10),
      liquidity_net: number(1000),
      n_positions: number(1),
      seconds_outside: number(100),
      tick_cumulative_outside: number(100),
      fee_growth_outside: { x: number(0), y: number(0) },
      seconds_per_liquidity_outside: number(100),
      sqrt_price: number(Tick.computeSqrtPriceFromTick(-10)),
    });

    ticks.set(10, {
      prev: number(-10),
      next: number(MAX_TICK),
      liquidity_net: number(-1000),
      n_positions: number(1),
      seconds_outside: number(200),
      tick_cumulative_outside: number(200),
      fee_growth_outside: { x: number(0), y: number(0) },
      seconds_per_liquidity_outside: number(200),
      sqrt_price: number(Tick.computeSqrtPriceFromTick(10)),
    });

    const defaultCoreStorage = getDefaultCoreStorage();

    storage = {
      ...defaultCoreStorage,
      ticks,
    };
  });

  it("returns the correct cumulatives when current tick is between both ticks", async () => {
    storage.cumulatives_buffer.map.set(0, {
      time: 100,
      tick: { sum: number(1000), block_start_value: number(10) },
      spl: { sum: number(1000), block_start_liquidity_value: number(10) },
    });

    const core = await tezos.deployContract("core", storage);

    // When the view is called
    const result = await core.contractViews
      .snapshot_cumulatives_inside({
        lower_tick_index: number(-10),
        upper_tick_index: number(10),
      })
      .executeView({ viewCaller: accounts.alice.pkh });

    // lastest block timestamp
    const timestamp = dateToTimestamp(
      (await axios.get(`${config.rpcURL}/chains/main/blocks/head/header`)).data.timestamp
    );

    // Correct value is returned
    expect(result.tick_cumulative_inside).toEqual(number(700));
    expect(result.seconds_per_liquidity_inside).toEqual(number(700));
    // hard to get exact timetamp of the call so we check for a maximum difference of 2 seconds.
    expect(differsByNoMoreThan(result.seconds_inside, number(timestamp - 300), 2)).toBeTruthy();
  });

  it("returns the correct cumulatives when current tick is above both ticks", async () => {
    storage.cumulatives_buffer.map.set(0, {
      time: 100,
      tick: { sum: number(1000), block_start_value: number(10) },
      spl: { sum: number(1000), block_start_liquidity_value: number(10) },
    });

    storage.cur_tick_index = number(20); // current tick is above both ticks

    const core = await tezos.deployContract("core", storage);

    // When the view is called
    const result = await core.contractViews
      .snapshot_cumulatives_inside({
        lower_tick_index: number(-10),
        upper_tick_index: number(10),
      })
      .executeView({ viewCaller: accounts.alice.pkh });

    // lastest block timestamp
    const timestamp = dateToTimestamp(
      (await axios.get(`${config.rpcURL}/chains/main/blocks/head/header`)).data.timestamp
    );

    // Correct value is returned
    expect(result.tick_cumulative_inside).toEqual(number(1000 - (1000 - 200) - 100));
    expect(result.seconds_per_liquidity_inside).toEqual(number(1000 - (1000 - 200) - 100));
    // hard to get exact timetamp of the call so we check for a maximum difference of 2 seconds.
    expect(
      differsByNoMoreThan(result.seconds_inside, number(timestamp - 100 - (timestamp - 200)), 2)
    ).toBeTruthy();
  });

  it("returns the correct cumulatives when current tick is below both ticks", async () => {
    storage.cumulatives_buffer.map.set(0, {
      time: 100,
      tick: { sum: number(1000), block_start_value: number(10) },
      spl: { sum: number(1000), block_start_liquidity_value: number(10) },
    });

    storage.cur_tick_index = number(-20); // current tick is below both ticks

    const core = await tezos.deployContract("core", storage);

    // When the view is called
    const result = await core.contractViews
      .snapshot_cumulatives_inside({
        lower_tick_index: number(-10),
        upper_tick_index: number(10),
      })
      .executeView({ viewCaller: accounts.alice.pkh });

    // lastest block timestamp
    const timestamp = dateToTimestamp(
      (await axios.get(`${config.rpcURL}/chains/main/blocks/head/header`)).data.timestamp
    );

    // Correct value is returned
    expect(result.tick_cumulative_inside).toEqual(number(1000 - (1000 - 100) - 200));
    expect(result.seconds_per_liquidity_inside).toEqual(number(1000 - (1000 - 100) - 200));
    // hard to get exact timetamp of the call so we check for a maximum difference of 2 seconds.
    expect(
      differsByNoMoreThan(result.seconds_inside, number(timestamp - 200 - (timestamp - 100)), 2)
    ).toBeTruthy();
  });

  it("fails if ticks are not initialised", async () => {
    storage.cumulatives_buffer.map.set(0, {
      time: 100,
      tick: { sum: number(1000), block_start_value: number(10) },
      spl: { sum: number(1000), block_start_liquidity_value: number(10) },
    });

    storage.cur_tick_index = number(-20); // current tick is below both ticks

    const core = await tezos.deployContract("core", storage);

    // When the view is called with an uninitialised tick, txn fails
    await expect(
      core.contractViews
        .snapshot_cumulatives_inside({
          lower_tick_index: number(-20), // not initialised
          upper_tick_index: number(10),
        })
        .executeView({ viewCaller: accounts.alice.pkh })
    ).rejects.toThrow("105");

    // When the view is called with an uninitialised tick, txn fails
    await expect(
      core.contractViews
        .snapshot_cumulatives_inside({
          lower_tick_index: number(-10),
          upper_tick_index: number(20), // not initialised
        })
        .executeView({ viewCaller: accounts.alice.pkh })
    ).rejects.toThrow("105");
  });
});
