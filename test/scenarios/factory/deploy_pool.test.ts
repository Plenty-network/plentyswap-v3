import axios from "axios";
import { Tick, MAX_TICK } from "@plenty-labs/v3-sdk";
import { MichelsonMap, OpKind } from "@taquito/taquito";

import Tezos from "../../tezos";
import { number } from "../../helpers/math";
import { config } from "../../helpers/config";
import { accounts } from "../../helpers/accounts";
import { Fa2, Fa12, Token, FactoryStorage } from "../../types";
import { getDefaultFactoryStorage } from "../../helpers/default";

describe("factory.deploy_pool", () => {
  let tezos: Tezos;
  let storage: FactoryStorage;

  beforeEach(async () => {
    tezos = new Tezos(config.rpcURL);
    await tezos.setSigner(accounts.alice.sk);

    const defaultFactoryStorage = getDefaultFactoryStorage();

    storage = {
      ...defaultFactoryStorage,
    };
  });

  it("correctly deploys a pool without extra slots", async () => {
    const factory = await tezos.deployContract("factory", storage);

    // Doesn't make sense to have bob as a token, but it works for the purpose of this test
    const tokenX: Fa12 = { fa12: accounts.bob.pkh };
    const tokenY: Fa2 = { fa2: { address: accounts.bob.pkh, token_id: number(1) } };

    // When deployed pool is called
    const op = await tezos.sendBatchOp([
      {
        kind: OpKind.TRANSACTION,
        ...factory.methodsObject
          .deploy_pool({
            token_x: tokenX,
            token_y: tokenY,
            initial_tick_index: 10,
            fee_bps: 1,
            extra_slots: 0,
          })
          .toTransferParams(),
      },
    ]);

    const deployedPool = await (
      await axios.get(`${config.rpcURL}/chains/main/blocks/${op.includedInBlock}`)
    ).data.operations[3][0].contents[0].metadata.internal_operation_results[0].result
      .originated_contracts[0];

    const poolStorage = await tezos.getStorage(deployedPool);
    const factoryStorage = await tezos.getStorage(factory.address);

    const minTick = await poolStorage.ticks.get(-MAX_TICK);
    const maxTick = await poolStorage.ticks.get(MAX_TICK);
    const bufferEntry = await poolStorage.cumulatives_buffer.map.get(0);

    // Pool is deployed correctly
    expect(poolStorage.liquidity).toEqual(number(0));
    expect(poolStorage.sqrt_price).toEqual(Tick.computeSqrtPriceFromTick(10));
    expect(poolStorage.cur_tick_index).toEqual(number(10));
    expect(poolStorage.cur_tick_witness).toEqual(number(-MAX_TICK));
    expect(poolStorage.fee_growth.x).toEqual(number(0));
    expect(poolStorage.fee_growth.y).toEqual(number(0));
    expect(poolStorage.dev_share.x).toEqual(number(0));
    expect(poolStorage.dev_share.y).toEqual(number(0));
    expect(poolStorage.protocol_share.x).toEqual(number(0));
    expect(poolStorage.protocol_share.y).toEqual(number(0));
    expect(poolStorage.cumulatives_buffer.first).toEqual(number(0));
    expect(poolStorage.cumulatives_buffer.last).toEqual(number(0));
    expect(poolStorage.cumulatives_buffer.reserved_length).toEqual(number(1));
    expect(poolStorage.new_position_id).toEqual(number(0));
    expect(poolStorage.constants.factory).toEqual(factory.address);
    expect(poolStorage.constants.fee_bps).toEqual(number(1));
    expect(poolStorage.constants.token_x).toEqual({
      fa12: accounts.bob.pkh,
    });
    expect(poolStorage.constants.token_y).toEqual({
      fa2: { address: accounts.bob.pkh, token_id: number(1) },
    });
    expect(poolStorage.constants.tick_spacing).toEqual(number(1));
    expect(poolStorage.is_ve).toEqual(false);
    expect(await poolStorage.metadata.get("")).toEqual(
      "68747470733a2f2f6d657461646174615f75726c2e636f6d"
    );

    expect(minTick).toEqual({
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

    expect(maxTick).toEqual({
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

    expect(bufferEntry).toEqual({
      time: new Date(0).toISOString(),
      tick: { sum: number(0), block_start_value: number(0) },
      spl: { sum: number(0), block_start_liquidity_value: number(0) },
    });

    // Pool is also recorded in the factory
    expect(await factoryStorage.pools.get({ 0: tokenX, 1: tokenY, 2: 1 })).toEqual(deployedPool);
  });

  it("correctly deploys a pool with 2 extra slots", async () => {
    const factory = await tezos.deployContract("factory", storage);

    // Doesn't make sense to have bob as a token, but it works for the purpose of this test
    const tokenX: Fa12 = { fa12: accounts.bob.pkh };
    const tokenY: Fa2 = { fa2: { address: accounts.bob.pkh, token_id: number(1) } };

    // When deploy_pool is called
    const op = await tezos.sendBatchOp([
      {
        kind: OpKind.TRANSACTION,
        ...factory.methodsObject
          .deploy_pool({
            token_x: tokenX,
            token_y: tokenY,
            initial_tick_index: 10,
            fee_bps: 1,
            extra_slots: 2, // three extra slots so total 3 entries in the buffer
          })
          .toTransferParams(),
      },
    ]);

    const deployedPool = await (
      await axios.get(`${config.rpcURL}/chains/main/blocks/${op.includedInBlock}`)
    ).data.operations[3][0].contents[0].metadata.internal_operation_results[0].result
      .originated_contracts[0];

    const poolStorage = await tezos.getStorage(deployedPool);
    const factoryStorage = await tezos.getStorage(factory.address);

    const minTick = await poolStorage.ticks.get(-MAX_TICK);
    const maxTick = await poolStorage.ticks.get(MAX_TICK);
    const bufferEntry1 = await poolStorage.cumulatives_buffer.map.get(0);

    // Extra slots
    const bufferEntry2 = await poolStorage.cumulatives_buffer.map.get(1);
    const bufferEntry3 = await poolStorage.cumulatives_buffer.map.get(2);

    // Correct pool is deployed
    expect(poolStorage.liquidity).toEqual(number(0));
    expect(poolStorage.sqrt_price).toEqual(Tick.computeSqrtPriceFromTick(10));
    expect(poolStorage.cur_tick_index).toEqual(number(10));
    expect(poolStorage.cur_tick_witness).toEqual(number(-MAX_TICK));
    expect(poolStorage.fee_growth.x).toEqual(number(0));
    expect(poolStorage.fee_growth.y).toEqual(number(0));
    expect(poolStorage.dev_share.x).toEqual(number(0));
    expect(poolStorage.dev_share.y).toEqual(number(0));
    expect(poolStorage.protocol_share.x).toEqual(number(0));
    expect(poolStorage.protocol_share.y).toEqual(number(0));
    expect(poolStorage.cumulatives_buffer.first).toEqual(number(0));
    expect(poolStorage.cumulatives_buffer.last).toEqual(number(0));
    expect(poolStorage.cumulatives_buffer.reserved_length).toEqual(number(3));
    expect(poolStorage.new_position_id).toEqual(number(0));
    expect(poolStorage.constants.factory).toEqual(factory.address);
    expect(poolStorage.constants.fee_bps).toEqual(number(1));
    expect(poolStorage.constants.token_x).toEqual({
      fa12: accounts.bob.pkh,
    });
    expect(poolStorage.constants.token_y).toEqual({
      fa2: { address: accounts.bob.pkh, token_id: number(1) },
    });
    expect(poolStorage.constants.tick_spacing).toEqual(number(1));
    expect(poolStorage.is_ve).toEqual(false);

    expect(minTick).toEqual({
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

    expect(maxTick).toEqual({
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
    expect(await poolStorage.metadata.get("")).toEqual(
      "68747470733a2f2f6d657461646174615f75726c2e636f6d"
    );

    expect(bufferEntry1).toEqual({
      time: new Date(0).toISOString(),
      tick: { sum: number(0), block_start_value: number(0) },
      spl: { sum: number(0), block_start_liquidity_value: number(0) },
    });
    expect(bufferEntry2).toEqual({
      time: new Date(0).toISOString(),
      tick: { sum: number(0), block_start_value: number(0) },
      spl: { sum: number(0), block_start_liquidity_value: number(0) },
    });
    expect(bufferEntry3).toEqual({
      time: new Date(0).toISOString(),
      tick: { sum: number(0), block_start_value: number(0) },
      spl: { sum: number(0), block_start_liquidity_value: number(0) },
    });

    // Pool is also recorded in the factory
    expect(await factoryStorage.pools.get({ 0: tokenX, 1: tokenY, 2: 1 })).toEqual(deployedPool);
  });

  it("fails for invalid fee tier", async () => {
    const factory = await tezos.deployContract("factory", storage);

    // Doesn't make sense to have bob as a token, but it works for the purpose of this test
    const tokenX: Fa12 = { fa12: accounts.bob.pkh };
    const tokenY: Fa2 = { fa2: { address: accounts.bob.pkh, token_id: number(1) } };

    // Fails if fee tier is invalid
    await expect(
      tezos.sendBatchOp([
        {
          kind: OpKind.TRANSACTION,
          ...factory.methodsObject
            .deploy_pool({
              token_x: tokenX,
              token_y: tokenY,
              initial_tick_index: 10,
              fee_bps: 8, // Invalid fee tier
              extra_slots: 0,
            })
            .toTransferParams(),
        },
      ])
    ).rejects.toThrow("407");
  });

  it("fails if pool with same tokens and specific fee tier is already deployed", async () => {
    // Doesn't make sense to have bob as a token, but it works for the purpose of this test
    const tokenX: Fa12 = { fa12: accounts.bob.pkh };
    const tokenY: Fa2 = { fa2: { address: accounts.bob.pkh, token_id: number(1) } };

    // Add the pool in storage
    const pools = new MichelsonMap<{ 0: Token; 1: Token; 2: number }, string>();
    pools.set({ 0: tokenX, 1: tokenY, 2: 1 }, accounts.bob.pkh);

    storage.pools = pools;

    const factory = await tezos.deployContract("factory", storage);

    // Fails when the pool is deployed again
    await expect(
      tezos.sendBatchOp([
        {
          kind: OpKind.TRANSACTION,
          ...factory.methodsObject
            .deploy_pool({
              token_x: tokenX,
              token_y: tokenY,
              initial_tick_index: 10,
              fee_bps: 1,
              extra_slots: 0,
            })
            .toTransferParams(),
        },
      ])
    ).rejects.toThrow("406");

    // Fails when the pool is deployed again (tokens flipped)
    await expect(
      tezos.sendBatchOp([
        {
          kind: OpKind.TRANSACTION,
          ...factory.methodsObject
            .deploy_pool({
              token_x: tokenY, // Flip
              token_y: tokenX,
              initial_tick_index: 10,
              fee_bps: 1,
              extra_slots: 0,
            })
            .toTransferParams(),
        },
      ])
    ).rejects.toThrow("406");
  });
});
