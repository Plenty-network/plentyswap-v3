// This is not an entrypoint, but an auxillary that is called every timed the contract is called.
// We assess the calls to update_timed_cumulatives by calling set_positon with zero liquidity

import axios from "axios";
import { OpKind } from "@taquito/taquito";
import { Tick, MAX_TICK, PositionManager, SetPositionOptions, Math2 } from "@plenty-labs/v3-sdk";

import Tezos from "../../tezos";
import { CoreStorage } from "../../types";
import { config } from "../../helpers/config";
import { accounts } from "../../helpers/accounts";
import { dateToTimestamp, number } from "../../helpers/math";
import { DECIMALS, getDefaultCoreStorage } from "../../helpers/default";

describe("core.update_timed_cumulatives", () => {
  let tezos: Tezos;
  let storage: CoreStorage;

  const NOW = Math.floor(new Date().getTime() / 1000);

  beforeEach(async () => {
    tezos = new Tezos(config.rpcURL);
    await tezos.setSigner(accounts.alice.sk);

    storage = { ...getDefaultCoreStorage() };
  });

  it("correctly updates cumulatives for a single slot buffer", async () => {
    storage.cur_tick_index = number(10);
    storage.sqrt_price = Tick.computeSqrtPriceFromTick(10);

    storage.liquidity = number(100);

    const core = await tezos.deployContract("core", storage);

    const lowerTickIndex = -10;
    const upperTickIndex = 20;

    // Arbitrary initial amounts
    const amount = {
      x: number(50 * DECIMALS),
      y: number(50 * DECIMALS),
    };

    const options: SetPositionOptions = {
      lowerTickIndex,
      upperTickIndex,
      lowerTickWitness: -MAX_TICK,
      upperTickWitness: -MAX_TICK,
      liquidity: number(0),
      deadline: NOW + 1000,
      maximumTokensContributed: amount,
    };

    // When alice sets a new position
    const op = await tezos.sendBatchOp([
      { kind: OpKind.TRANSACTION, ...PositionManager.setPositionOp(core, options) },
    ]);

    // block timestamp
    const timestamp = dateToTimestamp(
      (await axios.get(`${config.rpcURL}/chains/main/blocks/${op.includedInBlock}`)).data.header
        .timestamp
    );

    const updatedStorage = await tezos.getStorage(core);

    const bufferSlot = await updatedStorage.cumulatives_buffer.map.get(1);

    // Timed cumulatives are updated correctly
    expect(updatedStorage.cumulatives_buffer.first).toEqual(number(1));
    expect(updatedStorage.cumulatives_buffer.last).toEqual(number(1));
    expect(dateToTimestamp(bufferSlot.time)).toEqual(timestamp);
    expect(bufferSlot.tick).toEqual({
      sum: number(storage.cur_tick_index.multipliedBy(timestamp)),
      block_start_value: number(storage.cur_tick_index),
    });
    expect(bufferSlot.spl).toEqual({
      sum: Math2.bitShift(number(timestamp), -128).dividedBy(storage.liquidity).decimalPlaces(0),
      block_start_liquidity_value: storage.liquidity,
    });
  });

  it("correctly updates cumulatives for a two slot buffer", async () => {
    storage.cur_tick_index = number(10);
    storage.sqrt_price = Tick.computeSqrtPriceFromTick(10);

    storage.cumulatives_buffer.reserved_length = number(2); // Make 2 slots available

    storage.liquidity = number(100);

    const core = await tezos.deployContract("core", storage);

    const lowerTickIndex = -10;
    const upperTickIndex = 20;

    // Arbitrary initial amounts
    const amount = {
      x: number(50 * DECIMALS),
      y: number(50 * DECIMALS),
    };

    const options: SetPositionOptions = {
      lowerTickIndex,
      upperTickIndex,
      lowerTickWitness: -MAX_TICK,
      upperTickWitness: -MAX_TICK,
      liquidity: number(0),
      deadline: NOW + 1000,
      maximumTokensContributed: amount,
    };

    // When alice sets a new position
    const op = await tezos.sendBatchOp([
      { kind: OpKind.TRANSACTION, ...PositionManager.setPositionOp(core, options) },
    ]);

    // block timestamp
    const timestamp = dateToTimestamp(
      (await axios.get(`${config.rpcURL}/chains/main/blocks/${op.includedInBlock}`)).data.header
        .timestamp
    );

    const updatedStorage = await tezos.getStorage(core);

    const bufferSlot0 = await updatedStorage.cumulatives_buffer.map.get(0);
    const bufferSlot1 = await updatedStorage.cumulatives_buffer.map.get(1);

    // Timed cumulatives are updated correctly
    expect(updatedStorage.cumulatives_buffer.first).toEqual(number(0));
    expect(updatedStorage.cumulatives_buffer.last).toEqual(number(1));

    // Values are added in new slot
    expect(dateToTimestamp(bufferSlot1.time)).toEqual(timestamp);
    expect(bufferSlot1.tick).toEqual({
      sum: number(storage.cur_tick_index.multipliedBy(timestamp)),
      block_start_value: number(storage.cur_tick_index),
    });
    expect(bufferSlot1.spl).toEqual({
      sum: Math2.bitShift(number(timestamp), -128).dividedBy(storage.liquidity).decimalPlaces(0),
      block_start_liquidity_value: storage.liquidity,
    });

    // Old slot continues to exist
    expect(dateToTimestamp(bufferSlot0.time)).toEqual(0);
    expect(bufferSlot0.tick).toEqual({
      sum: number(0),
      block_start_value: number(0),
    });
    expect(bufferSlot0.spl).toEqual({
      sum: number(0),
      block_start_liquidity_value: number(0),
    });
  });

  it("removes oldest slot when a new value is added in a two slot buffer", async () => {
    storage.cur_tick_index = number(10);
    storage.sqrt_price = Tick.computeSqrtPriceFromTick(10);

    storage.cumulatives_buffer.reserved_length = number(2); // Make 2 slots available

    // Add values in both the slots
    storage.cumulatives_buffer.first = number(0);
    storage.cumulatives_buffer.last = number(1);
    storage.cumulatives_buffer.map.set(0, {
      time: 0,
      tick: {
        sum: number(0),
        block_start_value: number(0),
      },
      spl: {
        sum: number(0),
        block_start_liquidity_value: number(0),
      },
    });
    // Absolutely arbitrary values just to test the logic
    storage.cumulatives_buffer.map.set(1, {
      time: 100,
      tick: {
        sum: number(100),
        block_start_value: number(100),
      },
      spl: {
        sum: number(100),
        block_start_liquidity_value: number(100),
      },
    });

    storage.liquidity = number(100);

    const core = await tezos.deployContract("core", storage);

    const lowerTickIndex = -10;
    const upperTickIndex = 20;

    // Arbitrary initial amounts
    const amount = {
      x: number(50 * DECIMALS),
      y: number(50 * DECIMALS),
    };

    const options: SetPositionOptions = {
      lowerTickIndex,
      upperTickIndex,
      lowerTickWitness: -MAX_TICK,
      upperTickWitness: -MAX_TICK,
      liquidity: number(0),
      deadline: NOW + 1000,
      maximumTokensContributed: amount,
    };
    // When alice sets a new position
    const op = await tezos.sendBatchOp([
      { kind: OpKind.TRANSACTION, ...PositionManager.setPositionOp(core, options) },
    ]);

    // block timestamp
    const timestamp = dateToTimestamp(
      (await axios.get(`${config.rpcURL}/chains/main/blocks/${op.includedInBlock}`)).data.header
        .timestamp
    );

    const updatedStorage = await tezos.getStorage(core);

    const bufferSlot0 = await updatedStorage.cumulatives_buffer.map.get(0);
    const bufferSlot1 = await updatedStorage.cumulatives_buffer.map.get(1);
    const bufferSlot2 = await updatedStorage.cumulatives_buffer.map.get(2);

    // Timed cumulatives are updated correctly
    expect(updatedStorage.cumulatives_buffer.first).toEqual(number(1));
    expect(updatedStorage.cumulatives_buffer.last).toEqual(number(2)); // Incremented

    // Slot 0 is removed
    expect(bufferSlot0).toBeUndefined();

    // Slot with id 1 is same as before
    expect(dateToTimestamp(bufferSlot1.time)).toEqual(100);
    expect(bufferSlot1.tick).toEqual({
      sum: number(100),
      block_start_value: number(100),
    });
    expect(bufferSlot1.spl).toEqual({
      sum: number(100),
      block_start_liquidity_value: number(100),
    });

    // Slot id 2 is added
    expect(dateToTimestamp(bufferSlot2.time)).toEqual(timestamp);
    expect(bufferSlot2.tick).toEqual({
      sum: number(storage.cur_tick_index.multipliedBy(timestamp - 100)).plus(100),
      block_start_value: number(storage.cur_tick_index),
    });
    expect(bufferSlot2.spl).toEqual({
      sum: Math2.bitShift(number(timestamp - 100), -128)
        .dividedBy(storage.liquidity)
        .decimalPlaces(0)
        .plus(100),
      block_start_liquidity_value: storage.liquidity,
    });
  });

  it("skips additional buffer updates if called more than once in the same block", async () => {
    storage.cur_tick_index = number(10);
    storage.sqrt_price = Tick.computeSqrtPriceFromTick(10);

    storage.liquidity = number(100);

    const core = await tezos.deployContract("core", storage);

    const lowerTickIndex = -10;
    const upperTickIndex = 20;

    // Arbitrary initial amounts
    const amount = {
      x: number(50 * DECIMALS),
      y: number(50 * DECIMALS),
    };

    const options: SetPositionOptions = {
      lowerTickIndex,
      upperTickIndex,
      lowerTickWitness: -MAX_TICK,
      upperTickWitness: -MAX_TICK,
      liquidity: number(0),
      deadline: NOW + 1000,
      maximumTokensContributed: amount,
    };

    // When alice sets a new position
    const op = await tezos.sendBatchOp([
      // Call twice so that update_timed_cumulatives is also called twice
      { kind: OpKind.TRANSACTION, ...PositionManager.setPositionOp(core, options) },
      { kind: OpKind.TRANSACTION, ...PositionManager.setPositionOp(core, options) },
    ]);

    // block timestamp
    const timestamp = dateToTimestamp(
      (await axios.get(`${config.rpcURL}/chains/main/blocks/${op.includedInBlock}`)).data.header
        .timestamp
    );

    const updatedStorage = await tezos.getStorage(core);

    const bufferSlot = await updatedStorage.cumulatives_buffer.map.get(1);

    // Timed cumulatives are updated correctly with values such that it was only called once
    expect(updatedStorage.cumulatives_buffer.first).toEqual(number(1));
    expect(updatedStorage.cumulatives_buffer.last).toEqual(number(1));
    expect(dateToTimestamp(bufferSlot.time)).toEqual(timestamp);
    expect(bufferSlot.tick).toEqual({
      sum: number(storage.cur_tick_index.multipliedBy(timestamp)),
      block_start_value: number(storage.cur_tick_index),
    });
    expect(bufferSlot.spl).toEqual({
      sum: Math2.bitShift(number(timestamp), -128).dividedBy(storage.liquidity).decimalPlaces(0),
      block_start_liquidity_value: storage.liquidity,
    });
  });
});
