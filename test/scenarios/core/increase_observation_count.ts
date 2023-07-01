import axios from "axios";
import { OpKind } from "@taquito/taquito";

import Tezos from "../../tezos";
import { CoreStorage } from "../../types";
import { config } from "../../helpers/config";
import { accounts } from "../../helpers/accounts";
import { dateToTimestamp, number } from "../../helpers/math";
import { getDefaultCoreStorage } from "../../helpers/default";

const test = () => {
  describe("core.increase_observation_count", () => {
    let tezos: Tezos;
    let storage: CoreStorage;

    beforeEach(async () => {
      tezos = new Tezos(config.rpcURL);
      await tezos.setSigner(accounts.alice.sk);

      storage = { ...getDefaultCoreStorage() };
    });

    it("correctly increases the buffer slots and replicates the last slot values", async () => {
      // Initial buffer values
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

      const core = await tezos.deployContract("core", storage);

      // When alice increases observation count by 3
      const op = await tezos.sendBatchOp([
        {
          kind: OpKind.TRANSACTION,
          // An implicit internal call to update timed cumulatives is also happens
          ...core.methods.increase_observation_count(3).toTransferParams(),
        },
      ]);

      // block timestamp
      const timestamp = dateToTimestamp(
        (await axios.get(`${config.rpcURL}/chains/main/blocks/${op.includedInBlock}`)).data.header
          .timestamp
      );

      const updatedStorage = await tezos.getStorage(core);

      const bufferSlot1 = await updatedStorage.cumulatives_buffer.map.get(1);
      const bufferSlot2 = await updatedStorage.cumulatives_buffer.map.get(2);
      const bufferSlot3 = await updatedStorage.cumulatives_buffer.map.get(3);
      const bufferSlot4 = await updatedStorage.cumulatives_buffer.map.get(4);
      const bufferSlot5 = await updatedStorage.cumulatives_buffer.map.get(5);

      // Timed cumulatives are updated correctly
      expect(updatedStorage.cumulatives_buffer.first).toEqual(number(1));
      expect(updatedStorage.cumulatives_buffer.last).toEqual(number(2));
      expect(updatedStorage.cumulatives_buffer.reserved_length).toEqual(number(5));

      expect(dateToTimestamp(bufferSlot1.time)).toEqual(100);
      expect(bufferSlot1.tick).toEqual({
        sum: number(100),
        block_start_value: number(100),
      });
      expect(bufferSlot1.spl).toEqual({
        sum: number(100),
        block_start_liquidity_value: number(100),
      });

      expect(dateToTimestamp(bufferSlot2.time)).toEqual(timestamp);
      expect(bufferSlot2.tick).toEqual({
        sum: number(100),
        block_start_value: number(0),
      });
      expect(bufferSlot2.spl).toEqual({
        sum: number(100),
        block_start_liquidity_value: number(0),
      });

      // New slots are added with the same values as the last slot
      expect(dateToTimestamp(bufferSlot3.time)).toEqual(timestamp);
      expect(bufferSlot3.tick).toEqual({
        sum: number(100),
        block_start_value: number(0),
      });
      expect(bufferSlot3.spl).toEqual({
        sum: number(100),
        block_start_liquidity_value: number(0),
      });

      expect(dateToTimestamp(bufferSlot4.time)).toEqual(timestamp);
      expect(bufferSlot4.tick).toEqual({
        sum: number(100),
        block_start_value: number(0),
      });
      expect(bufferSlot4.spl).toEqual({
        sum: number(100),
        block_start_liquidity_value: number(0),
      });

      expect(dateToTimestamp(bufferSlot5.time)).toEqual(timestamp);
      expect(bufferSlot5.tick).toEqual({
        sum: number(100),
        block_start_value: number(0),
      });
      expect(bufferSlot5.spl).toEqual({
        sum: number(100),
        block_start_liquidity_value: number(0),
      });
    });
  });
};

export default test;
