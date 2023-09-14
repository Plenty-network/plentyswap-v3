import { Math2 } from "@plenty-labs/v3-sdk";

import Tezos from "../../tezos";
import { CoreStorage } from "../../types";
import { number } from "../../helpers/math";
import { config } from "../../helpers/config";
import { accounts } from "../../helpers/accounts";
import { getDefaultCoreStorage } from "../../helpers/default";

describe("core.observe", () => {
  let tezos: Tezos;
  let storage: CoreStorage;

  beforeEach(async () => {
    tezos = new Tezos(config.rpcURL);
    await tezos.setSigner(accounts.alice.sk);

    const defaultCoreStorage = getDefaultCoreStorage();

    storage = {
      ...defaultCoreStorage,
    };
  });

  it("returns the exact cumulative entry for 1 item", async () => {
    storage.cumulatives_buffer.map.set(0, {
      time: 100,
      tick: { sum: number(1000), block_start_value: number(10) },
      spl: { sum: number(1000), block_start_liquidity_value: number(10) },
    });

    const core = await tezos.deployContract("core", storage);

    // When the view is called
    const result = await core.contractViews
      .observe([100])
      .executeView({ viewCaller: accounts.alice.pkh });

    // Correct value is returned
    expect(result[0].seconds_per_liquidity_cumulative).toEqual(number(1000));
    expect(result[0].tick_cumulative).toEqual(number(1000));
  });

  it("extrapolates the last value correctly", async () => {
    storage.cumulatives_buffer.map.set(0, {
      time: 100,
      tick: { sum: number(1000), block_start_value: number(10) },
      spl: { sum: number(1000), block_start_liquidity_value: number(10) },
    });

    storage.liquidity = number(11);
    storage.cur_tick_index = number(11);

    const core = await tezos.deployContract("core", storage);

    // When the view is called
    const result = await core.contractViews
      .observe([105])
      .executeView({ viewCaller: accounts.alice.pkh });

    const splDelta = Math2.bitShift(number(5), -128).dividedBy(11).decimalPlaces(0);

    // Correct value is returned
    expect(result[0].seconds_per_liquidity_cumulative).toEqual(number(1000).plus(splDelta));
    expect(result[0].tick_cumulative).toEqual(number(1055));
  });

  it("correctly extrapolates for 2 entries", async () => {
    storage.cumulatives_buffer.map.set(0, {
      time: 100,
      tick: { sum: number(1000), block_start_value: number(10) },
      spl: { sum: number(1000), block_start_liquidity_value: number(10) },
    });
    storage.cumulatives_buffer.map.set(1, {
      time: 200,
      tick: { sum: number(2000), block_start_value: number(12) },
      spl: { sum: number(2000), block_start_liquidity_value: number(12) },
    });

    storage.cumulatives_buffer.last = number(1);

    const core = await tezos.deployContract("core", storage);

    // When the view is called
    const result = await core.contractViews
      .observe([100, 150])
      .executeView({ viewCaller: accounts.alice.pkh });

    // Correct values are returned
    expect(result[0].seconds_per_liquidity_cumulative).toEqual(number(1000));
    expect(result[0].tick_cumulative).toEqual(number(1000));
    expect(result[1].seconds_per_liquidity_cumulative).toEqual(
      Math2.bitShift(number(50), -128).dividedBy(12).decimalPlaces(0).plus(1000)
    );
    expect(result[1].tick_cumulative).toEqual(number(1600));
  });

  it("correctly extrapolates for 3 entries", async () => {
    storage.cumulatives_buffer.map.set(0, {
      time: 100,
      tick: { sum: number(1000), block_start_value: number(10) },
      spl: { sum: number(1000), block_start_liquidity_value: number(10) },
    });
    storage.cumulatives_buffer.map.set(1, {
      time: 200,
      tick: { sum: number(2000), block_start_value: number(12) },
      spl: { sum: number(2000), block_start_liquidity_value: number(12) },
    });
    storage.cumulatives_buffer.map.set(2, {
      time: 300,
      tick: { sum: number(3000), block_start_value: number(15) },
      spl: { sum: number(3000), block_start_liquidity_value: number(15) },
    });

    storage.cumulatives_buffer.last = number(2);

    const core = await tezos.deployContract("core", storage);

    // When the view is called
    const result = await core.contractViews
      .observe([200, 250])
      .executeView({ viewCaller: accounts.alice.pkh });

    // Correct values are returned
    expect(result[0].seconds_per_liquidity_cumulative).toEqual(number(2000));
    expect(result[0].tick_cumulative).toEqual(number(2000));
    expect(result[1].seconds_per_liquidity_cumulative).toEqual(
      Math2.bitShift(number(50), -128).dividedBy(15).decimalPlaces(0).plus(2000)
    );
    expect(result[1].tick_cumulative).toEqual(number(2750));
  });

  it("correctly extrapolates for 4 entries", async () => {
    storage.cumulatives_buffer.map.set(0, {
      time: 100,
      tick: { sum: number(1000), block_start_value: number(10) },
      spl: { sum: number(1000), block_start_liquidity_value: number(10) },
    });
    storage.cumulatives_buffer.map.set(1, {
      time: 200,
      tick: { sum: number(2000), block_start_value: number(12) },
      spl: { sum: number(2000), block_start_liquidity_value: number(12) },
    });
    storage.cumulatives_buffer.map.set(2, {
      time: 300,
      tick: { sum: number(3000), block_start_value: number(15) },
      spl: { sum: number(3000), block_start_liquidity_value: number(15) },
    });
    storage.cumulatives_buffer.map.set(3, {
      time: 400,
      tick: { sum: number(4000), block_start_value: number(18) },
      spl: { sum: number(4000), block_start_liquidity_value: number(18) },
    });

    storage.cumulatives_buffer.last = number(3);

    const core = await tezos.deployContract("core", storage);

    // When the view is called
    const result = await core.contractViews
      .observe([300, 350])
      .executeView({ viewCaller: accounts.alice.pkh });

    // Correct values are returned
    expect(result[0].seconds_per_liquidity_cumulative).toEqual(number(3000));
    expect(result[0].tick_cumulative).toEqual(number(3000));
    expect(result[1].seconds_per_liquidity_cumulative).toEqual(
      Math2.bitShift(number(50), -128).dividedBy(18).decimalPlaces(0).plus(3000)
    );
    expect(result[1].tick_cumulative).toEqual(number(3900));
  });

  it("fails if the requested timestamps do not fall within the record boundaries", async () => {
    storage.cumulatives_buffer.map.set(0, {
      time: 100,
      tick: { sum: number(1000), block_start_value: number(10) },
      spl: { sum: number(1000), block_start_liquidity_value: number(10) },
    });
    storage.cumulatives_buffer.map.set(1, {
      time: 200,
      tick: { sum: number(2000), block_start_value: number(12) },
      spl: { sum: number(2000), block_start_liquidity_value: number(12) },
    });
    storage.cumulatives_buffer.map.set(2, {
      time: 300,
      tick: { sum: number(3000), block_start_value: number(15) },
      spl: { sum: number(3000), block_start_liquidity_value: number(15) },
    });
    storage.cumulatives_buffer.map.set(3, {
      time: 400,
      tick: { sum: number(4000), block_start_value: number(18) },
      spl: { sum: number(4000), block_start_liquidity_value: number(18) },
    });

    storage.cumulatives_buffer.last = number(3);

    const core = await tezos.deployContract("core", storage);

    // When the view is called with a timestamp less than lowest record, txn fails
    await expect(
      core.contractViews.observe([50]).executeView({ viewCaller: accounts.alice.pkh })
    ).rejects.toThrow();

    // When the view is called with a timestamp higher than current time, txn fails
    await expect(
      core.contractViews
        .observe([Math.floor(Date.now() / 1000) + 10])
        .executeView({ viewCaller: accounts.alice.pkh })
    ).rejects.toThrow();
  });
});
