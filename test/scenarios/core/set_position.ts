import axios from "axios";
import { DefaultContractType, MichelsonMap, OpKind } from "@taquito/taquito";
import {
  Tick,
  MAX_TICK,
  Approvals,
  Liquidity,
  PositionManager,
  SetPositionOptions,
} from "@plenty-labs/v3-sdk";

import Tezos from "../../tezos";
import { config } from "../../helpers/config";
import { accounts } from "../../helpers/accounts";
import { dateToTimestamp, number } from "../../helpers/math";
import { DECIMALS, getDefaultCoreStorage } from "../../helpers/default";
import { CoreStorage, FA12Storage, FA2Storage, TickState } from "../../types";

const test = () => {
  describe("core.set_position", () => {
    let tezos: Tezos;
    let storage: CoreStorage;
    let tokenX: DefaultContractType;
    let tokenY: DefaultContractType;

    const NOW = Math.floor(new Date().getTime() / 1000);

    beforeEach(async () => {
      tezos = new Tezos(config.rpcURL);
      await tezos.setSigner(accounts.alice.sk);

      const fa12Storage: FA12Storage = {
        administrator: accounts.alice.pkh,
        balances: new MichelsonMap(),
        metadata: new MichelsonMap(),
        paused: false,
        token_metadata: new MichelsonMap(),
        totalSupply: number(100 * DECIMALS),
      };

      const fa2Storage: FA2Storage = {
        administrator: accounts.alice.pkh,
        last_token_id: 1,
        ledger: new MichelsonMap(),
        metadata: new MichelsonMap(),
        paused: false,
        operators: new MichelsonMap(),
        token_metadata: new MichelsonMap(),
        supply: new MichelsonMap(),
      };

      // Set initial balance for Alice
      fa12Storage.balances.set(accounts.alice.pkh, {
        balance: number(100 * DECIMALS),
        approvals: new MichelsonMap(),
      });
      fa2Storage.ledger.set({ 0: accounts.alice.pkh, 1: 0 }, number(100 * DECIMALS));
      fa2Storage.token_metadata.set(0, { token_id: 0, token_info: new MichelsonMap() });

      // Deploy the tokens
      tokenX = await tezos.deployContract("fa12", fa12Storage);
      tokenY = await tezos.deployContract("fa2", fa2Storage);

      const defaultCoreStorage = getDefaultCoreStorage();

      storage = {
        ...defaultCoreStorage,
        constants: {
          ...defaultCoreStorage.constants,
          token_x: { fa12: tokenX.address },
          token_y: { fa2: { address: tokenY.address, token_id: number(0) } },
        },
      };
    });

    it("correctly mints a position when liquidity is spread on both sides of the current tick and both ticks are not initialised", async () => {
      storage.cur_tick_index = number(10);
      storage.sqrt_price = Tick.computeSqrtPriceFromTick(10);

      const core = await tezos.deployContract("core", storage);

      const lowerTickIndex = -10;
      const upperTickIndex = 20;

      const sqrtPriceAx80 = Tick.computeSqrtPriceFromTick(lowerTickIndex);
      const sqrtPriceBx80 = Tick.computeSqrtPriceFromTick(upperTickIndex);
      const sqrtPriceCx80 = storage.sqrt_price;

      // Arbitrary initial amounts
      const amount = {
        x: number(50 * DECIMALS),
        y: number(50 * DECIMALS),
      };

      // SDK resolves the correct liquidity and associated amounts
      const liquidity = Liquidity.computeLiquidityFromAmount(
        amount,
        sqrtPriceCx80,
        sqrtPriceAx80,
        sqrtPriceBx80
      );
      const finalAmounts = Liquidity.computeAmountFromLiquidity(
        liquidity,
        sqrtPriceCx80,
        sqrtPriceAx80,
        sqrtPriceBx80
      );

      const options: SetPositionOptions = {
        lowerTickIndex,
        upperTickIndex,
        lowerTickWitness: -MAX_TICK,
        upperTickWitness: -MAX_TICK,
        liquidity,
        deadline: NOW + 1000,
        maximumTokensContributed: finalAmounts,
      };

      // When alice sets a new position
      const op = await tezos.sendBatchOp([
        {
          kind: OpKind.TRANSACTION,
          ...Approvals.approveFA12(tokenX, { spender: core.address, value: amount.x }),
        },
        {
          kind: OpKind.TRANSACTION,
          ...Approvals.updateOperatorsFA2(tokenY, [
            { add_operator: { owner: accounts.alice.pkh, operator: core.address, token_id: 0 } },
          ]),
        },
        { kind: OpKind.TRANSACTION, ...PositionManager.setPositionOp(core, options) },
      ]);

      // block timestamp
      const timestamp = dateToTimestamp(
        (await axios.get(`${config.rpcURL}/chains/main/blocks/${op.includedInBlock}`)).data.header
          .timestamp
      );

      const updatedStorage = await tezos.getStorage(core);
      const tokenXStorage = await tezos.getStorage(tokenX);
      const tokenYStorage = await tezos.getStorage(tokenY);

      const position = await updatedStorage.positions.get(0);
      const lowerTickState = await updatedStorage.ticks.get(lowerTickIndex);
      const upperTickState = await updatedStorage.ticks.get(upperTickIndex);

      // the storage is updated correctly
      expect(updatedStorage.liquidity).toEqual(liquidity);
      expect(updatedStorage.cur_tick_witness).toEqual(number(-10));
      expect(updatedStorage.new_position_id).toEqual(number(1));

      expect(lowerTickState).toEqual({
        prev: number(-MAX_TICK),
        next: number(20),
        liquidity_net: liquidity,
        n_positions: number(1),
        seconds_outside: number(timestamp),
        tick_cumulative_outside: number(timestamp * 10),
        fee_growth_outside: { x: number(0), y: number(0) },
        seconds_per_liquidity_outside: number(0),
        sqrt_price: number(sqrtPriceAx80),
      });
      expect(upperTickState).toEqual({
        prev: number(-10),
        next: number(MAX_TICK),
        liquidity_net: liquidity.multipliedBy(-1),
        n_positions: number(1),
        seconds_outside: number(0),
        tick_cumulative_outside: number(0),
        fee_growth_outside: { x: number(0), y: number(0) },
        seconds_per_liquidity_outside: number(0),
        sqrt_price: number(sqrtPriceBx80),
      });
      expect(position).toEqual({
        fee_growth_inside_last: {
          x: number(0),
          y: number(0),
        },
        liquidity,
        lower_tick_index: number(lowerTickIndex),
        upper_tick_index: number(upperTickIndex),
        owner: accounts.alice.pkh,
      });

      const cfmmBalanceX = await tokenXStorage.balances.get(core.address);
      const cfmmBalanceY = await tokenYStorage.ledger.get({ 0: core.address, 1: 0 });

      // Tokens are transferred correctly to the cfmm
      expect(cfmmBalanceX.balance).toEqual(finalAmounts.x);
      expect(cfmmBalanceY).toEqual(finalAmounts.y);
    });

    // Lower and Upper tick are already initialised for this test
    it("correctly mints a position when liquidity is spread on both sides of the current tick", async () => {
      storage.cur_tick_index = number(10);
      storage.cur_tick_witness = number(-10);
      storage.sqrt_price = Tick.computeSqrtPriceFromTick(10);

      // Initialise already existing ticks
      const lowerTickIndex = -10;
      const upperTickIndex = 20;

      const sqrtPriceAx80 = Tick.computeSqrtPriceFromTick(lowerTickIndex);
      const sqrtPriceBx80 = Tick.computeSqrtPriceFromTick(upperTickIndex);
      const sqrtPriceCx80 = storage.sqrt_price;

      const initialLiquidity = Liquidity.computeLiquidityFromAmount(
        {
          x: number(50 * DECIMALS),
          y: number(50 * DECIMALS),
        },
        sqrtPriceCx80,
        sqrtPriceAx80,
        sqrtPriceBx80
      );

      const lowerTick: TickState = {
        prev: number(-MAX_TICK),
        next: number(20),
        liquidity_net: initialLiquidity,
        n_positions: number(1),
        seconds_outside: number(0),
        tick_cumulative_outside: number(0),
        // NOTE: Technically, this should have no connection with DECIMALS since the contract stores it
        // in x128 format, however this works just fine for proving the correctness of the math.
        fee_growth_outside: { x: number(1 * DECIMALS), y: number(2 * DECIMALS) },
        seconds_per_liquidity_outside: number(0),
        sqrt_price: number(sqrtPriceAx80),
      };

      const upperTick: TickState = {
        prev: number(-10),
        next: number(MAX_TICK),
        liquidity_net: initialLiquidity.multipliedBy(-1),
        n_positions: number(1),
        seconds_outside: number(0),
        tick_cumulative_outside: number(0),
        fee_growth_outside: { x: number(0), y: number(0) },
        seconds_per_liquidity_outside: number(0),
        sqrt_price: number(sqrtPriceBx80),
      };

      storage.ticks.set(lowerTickIndex, lowerTick);
      storage.ticks.set(upperTickIndex, upperTick);

      storage.fee_growth = { x: number(2 * DECIMALS), y: number(3 * DECIMALS) };

      const core = await tezos.deployContract("core", storage);

      // Arbitrary
      const amount = {
        x: number(20 * DECIMALS),
        y: number(20 * DECIMALS),
      };

      // Compute final values from SDK
      const liquidity = Liquidity.computeLiquidityFromAmount(
        amount,
        sqrtPriceCx80,
        sqrtPriceAx80,
        sqrtPriceBx80
      );
      const finalAmounts = Liquidity.computeAmountFromLiquidity(
        liquidity,
        sqrtPriceCx80,
        sqrtPriceAx80,
        sqrtPriceBx80
      );

      const options: SetPositionOptions = {
        lowerTickIndex,
        upperTickIndex,
        lowerTickWitness: -MAX_TICK,
        upperTickWitness: lowerTickIndex,
        liquidity,
        deadline: NOW + 1000,
        maximumTokensContributed: finalAmounts,
      };

      // When alice sets a new position
      await tezos.sendBatchOp([
        {
          kind: OpKind.TRANSACTION,
          ...Approvals.approveFA12(tokenX, { spender: core.address, value: amount.x }),
        },
        {
          kind: OpKind.TRANSACTION,
          ...Approvals.updateOperatorsFA2(tokenY, [
            { add_operator: { owner: accounts.alice.pkh, operator: core.address, token_id: 0 } },
          ]),
        },
        { kind: OpKind.TRANSACTION, ...PositionManager.setPositionOp(core, options) },
      ]);

      const updatedStorage = await tezos.getStorage(core);
      const tokenXStorage = await tezos.getStorage(tokenX);
      const tokenYStorage = await tezos.getStorage(tokenY);

      const position = await updatedStorage.positions.get(0);
      const lowerTickState = await updatedStorage.ticks.get(lowerTickIndex);
      const upperTickState = await updatedStorage.ticks.get(upperTickIndex);

      // the storage is updated correctly
      expect(updatedStorage.liquidity).toEqual(liquidity);
      expect(updatedStorage.cur_tick_witness).toEqual(number(-10));
      expect(updatedStorage.new_position_id).toEqual(number(1));

      expect(lowerTickState).toEqual({
        prev: number(-MAX_TICK),
        next: number(20),
        liquidity_net: initialLiquidity.plus(liquidity),
        n_positions: number(2),
        seconds_outside: number(0),
        tick_cumulative_outside: number(0),
        fee_growth_outside: { x: number(1 * DECIMALS), y: number(2 * DECIMALS) },
        seconds_per_liquidity_outside: number(0),
        sqrt_price: number(sqrtPriceAx80),
      });
      expect(upperTickState).toEqual({
        prev: number(-10),
        next: number(MAX_TICK),
        liquidity_net: initialLiquidity.plus(liquidity).multipliedBy(-1),
        n_positions: number(2),
        seconds_outside: number(0),
        tick_cumulative_outside: number(0),
        fee_growth_outside: { x: number(0), y: number(0) },
        seconds_per_liquidity_outside: number(0),
        sqrt_price: number(sqrtPriceBx80),
      });
      expect(position).toEqual({
        fee_growth_inside_last: {
          x: number(1 * DECIMALS),
          y: number(1 * DECIMALS),
        },
        liquidity,
        lower_tick_index: number(lowerTickIndex),
        upper_tick_index: number(upperTickIndex),
        owner: accounts.alice.pkh,
      });

      const cfmmBalanceX = await tokenXStorage.balances.get(core.address);
      const cfmmBalanceY = await tokenYStorage.ledger.get({ 0: core.address, 1: 0 });

      // Tokens are transferred correctly to the cfmm
      expect(cfmmBalanceX.balance).toEqual(finalAmounts.x);
      expect(cfmmBalanceY).toEqual(finalAmounts.y);
    });

    it("correctly mints a position when liquidity is entirely below the current tick", async () => {
      storage.cur_tick_index = number(10);
      storage.cur_tick_witness = number(0);
      storage.sqrt_price = Tick.computeSqrtPriceFromTick(10);

      // Initialise already existing ticks
      const lowerTickIndex = -10;
      const upperTickIndex = 0;

      const sqrtPriceAx80 = Tick.computeSqrtPriceFromTick(lowerTickIndex);
      const sqrtPriceBx80 = Tick.computeSqrtPriceFromTick(upperTickIndex);
      const sqrtPriceCx80 = storage.sqrt_price;

      const initialLiquidity = Liquidity.computeLiquidityFromAmount(
        {
          x: number(50 * DECIMALS),
          y: number(50 * DECIMALS),
        },
        sqrtPriceCx80,
        sqrtPriceAx80,
        sqrtPriceBx80
      );

      const lowerTick: TickState = {
        prev: number(-MAX_TICK),
        next: number(20),
        liquidity_net: initialLiquidity,
        n_positions: number(1),
        seconds_outside: number(0),
        tick_cumulative_outside: number(0),
        fee_growth_outside: { x: number(1 * DECIMALS), y: number(2 * DECIMALS) },
        seconds_per_liquidity_outside: number(0),
        sqrt_price: number(sqrtPriceAx80),
      };

      const upperTick: TickState = {
        prev: number(-10),
        next: number(MAX_TICK),
        liquidity_net: initialLiquidity.multipliedBy(-1),
        n_positions: number(1),
        seconds_outside: number(0),
        tick_cumulative_outside: number(0),
        fee_growth_outside: { x: number(2 * DECIMALS), y: number(4 * DECIMALS) },
        seconds_per_liquidity_outside: number(0),
        sqrt_price: number(sqrtPriceBx80),
      };

      storage.ticks.set(lowerTickIndex, lowerTick);
      storage.ticks.set(upperTickIndex, upperTick);

      storage.fee_growth = { x: number(10 * DECIMALS), y: number(10 * DECIMALS) };

      const core = await tezos.deployContract("core", storage);

      // Arbitrary
      const amount = {
        x: number(20 * DECIMALS),
        y: number(20 * DECIMALS),
      };

      // Compute final values from SDK
      const liquidity = Liquidity.computeLiquidityFromAmount(
        amount,
        sqrtPriceCx80,
        sqrtPriceAx80,
        sqrtPriceBx80
      );
      const finalAmounts = Liquidity.computeAmountFromLiquidity(
        liquidity,
        sqrtPriceCx80,
        sqrtPriceAx80,
        sqrtPriceBx80
      );

      const options: SetPositionOptions = {
        lowerTickIndex,
        upperTickIndex,
        lowerTickWitness: -MAX_TICK,
        upperTickWitness: lowerTickIndex,
        liquidity,
        deadline: NOW + 1000,
        maximumTokensContributed: finalAmounts,
      };

      // When alice sets a new position
      await tezos.sendBatchOp([
        {
          kind: OpKind.TRANSACTION,
          ...Approvals.approveFA12(tokenX, { spender: core.address, value: amount.x }),
        },
        {
          kind: OpKind.TRANSACTION,
          ...Approvals.updateOperatorsFA2(tokenY, [
            { add_operator: { owner: accounts.alice.pkh, operator: core.address, token_id: 0 } },
          ]),
        },
        { kind: OpKind.TRANSACTION, ...PositionManager.setPositionOp(core, options) },
      ]);

      const updatedStorage = await tezos.getStorage(core);
      const tokenXStorage = await tezos.getStorage(tokenX);
      const tokenYStorage = await tezos.getStorage(tokenY);

      const position = await updatedStorage.positions.get(0);
      const lowerTickState = await updatedStorage.ticks.get(lowerTickIndex);
      const upperTickState = await updatedStorage.ticks.get(upperTickIndex);

      // the storage is updated correctly
      expect(updatedStorage.liquidity).toEqual(number(0)); // Stays the same since liquidity is not in range
      expect(updatedStorage.cur_tick_witness).toEqual(number(upperTickIndex));
      expect(updatedStorage.new_position_id).toEqual(number(1));

      expect(lowerTickState).toEqual({
        prev: number(-MAX_TICK),
        next: number(20),
        liquidity_net: initialLiquidity.plus(liquidity),
        n_positions: number(2),
        seconds_outside: number(0),
        tick_cumulative_outside: number(0),
        fee_growth_outside: { x: number(1 * DECIMALS), y: number(2 * DECIMALS) },
        seconds_per_liquidity_outside: number(0),
        sqrt_price: number(sqrtPriceAx80),
      });
      expect(upperTickState).toEqual({
        prev: number(-10),
        next: number(MAX_TICK),
        liquidity_net: initialLiquidity.plus(liquidity).multipliedBy(-1),
        n_positions: number(2),
        seconds_outside: number(0),
        tick_cumulative_outside: number(0),
        fee_growth_outside: { x: number(2 * DECIMALS), y: number(4 * DECIMALS) },
        seconds_per_liquidity_outside: number(0),
        sqrt_price: number(sqrtPriceBx80),
      });
      expect(position).toEqual({
        fee_growth_inside_last: {
          x: number(1 * DECIMALS),
          y: number(2 * DECIMALS),
        },
        liquidity,
        lower_tick_index: number(lowerTickIndex),
        upper_tick_index: number(upperTickIndex),
        owner: accounts.alice.pkh,
      });

      const cfmmBalanceX = await tokenXStorage.balances.get(core.address);
      const cfmmBalanceY = await tokenYStorage.ledger.get({ 0: core.address, 1: 0 });

      // Tokens are transferred correctly to the cfmm
      expect(cfmmBalanceX.balance).toEqual(finalAmounts.x);
      expect(cfmmBalanceY).toEqual(finalAmounts.y);
    });

    it("correctly mints a position when liquidity is entirely above the current tick", async () => {
      storage.cur_tick_index = number(10);
      storage.cur_tick_witness = number(-MAX_TICK);
      storage.sqrt_price = Tick.computeSqrtPriceFromTick(10);

      // Initialise already existing ticks
      const lowerTickIndex = 20;
      const upperTickIndex = 30;

      const sqrtPriceAx80 = Tick.computeSqrtPriceFromTick(lowerTickIndex);
      const sqrtPriceBx80 = Tick.computeSqrtPriceFromTick(upperTickIndex);
      const sqrtPriceCx80 = storage.sqrt_price;

      const initialLiquidity = Liquidity.computeLiquidityFromAmount(
        {
          x: number(50 * DECIMALS),
          y: number(50 * DECIMALS),
        },
        sqrtPriceCx80,
        sqrtPriceAx80,
        sqrtPriceBx80
      );

      const lowerTick: TickState = {
        prev: number(-MAX_TICK),
        next: number(30),
        liquidity_net: initialLiquidity,
        n_positions: number(1),
        seconds_outside: number(0),
        tick_cumulative_outside: number(0),
        fee_growth_outside: { x: number(2 * DECIMALS), y: number(4 * DECIMALS) },
        seconds_per_liquidity_outside: number(0),
        sqrt_price: number(sqrtPriceAx80),
      };

      const upperTick: TickState = {
        prev: number(20),
        next: number(MAX_TICK),
        liquidity_net: initialLiquidity.multipliedBy(-1),
        n_positions: number(1),
        seconds_outside: number(0),
        tick_cumulative_outside: number(0),
        fee_growth_outside: { x: number(1 * DECIMALS), y: number(2 * DECIMALS) },
        seconds_per_liquidity_outside: number(0),
        sqrt_price: number(sqrtPriceBx80),
      };

      storage.ticks.set(lowerTickIndex, lowerTick);
      storage.ticks.set(upperTickIndex, upperTick);

      storage.fee_growth = { x: number(10 * DECIMALS), y: number(10 * DECIMALS) };

      const core = await tezos.deployContract("core", storage);

      // Arbitrary
      const amount = {
        x: number(20 * DECIMALS),
        y: number(20 * DECIMALS),
      };

      // Compute final values from SDK
      const liquidity = Liquidity.computeLiquidityFromAmount(
        amount,
        sqrtPriceCx80,
        sqrtPriceAx80,
        sqrtPriceBx80
      );
      const finalAmounts = Liquidity.computeAmountFromLiquidity(
        liquidity,
        sqrtPriceCx80,
        sqrtPriceAx80,
        sqrtPriceBx80
      );

      const options: SetPositionOptions = {
        lowerTickIndex,
        upperTickIndex,
        lowerTickWitness: -MAX_TICK,
        upperTickWitness: lowerTickIndex,
        liquidity,
        deadline: NOW + 1000,
        maximumTokensContributed: finalAmounts,
      };

      // When alice sets a new position
      await tezos.sendBatchOp([
        {
          kind: OpKind.TRANSACTION,
          ...Approvals.approveFA12(tokenX, { spender: core.address, value: amount.x }),
        },
        {
          kind: OpKind.TRANSACTION,
          ...Approvals.updateOperatorsFA2(tokenY, [
            { add_operator: { owner: accounts.alice.pkh, operator: core.address, token_id: 0 } },
          ]),
        },
        { kind: OpKind.TRANSACTION, ...PositionManager.setPositionOp(core, options) },
      ]);

      const updatedStorage = await tezos.getStorage(core);
      const tokenXStorage = await tezos.getStorage(tokenX);
      const tokenYStorage = await tezos.getStorage(tokenY);

      const position = await updatedStorage.positions.get(0);
      const lowerTickState = await updatedStorage.ticks.get(lowerTickIndex);
      const upperTickState = await updatedStorage.ticks.get(upperTickIndex);

      // the storage is updated correctly
      expect(updatedStorage.liquidity).toEqual(number(0)); // Stays the same since liquidity is not in range
      expect(updatedStorage.cur_tick_witness).toEqual(number(-MAX_TICK));
      expect(updatedStorage.new_position_id).toEqual(number(1));

      expect(lowerTickState).toEqual({
        prev: number(-MAX_TICK),
        next: number(30),
        liquidity_net: initialLiquidity.plus(liquidity),
        n_positions: number(2),
        seconds_outside: number(0),
        tick_cumulative_outside: number(0),
        fee_growth_outside: { x: number(2 * DECIMALS), y: number(4 * DECIMALS) },
        seconds_per_liquidity_outside: number(0),
        sqrt_price: number(sqrtPriceAx80),
      });
      expect(upperTickState).toEqual({
        prev: number(20),
        next: number(MAX_TICK),
        liquidity_net: initialLiquidity.plus(liquidity).multipliedBy(-1),
        n_positions: number(2),
        seconds_outside: number(0),
        tick_cumulative_outside: number(0),
        fee_growth_outside: { x: number(1 * DECIMALS), y: number(2 * DECIMALS) },
        seconds_per_liquidity_outside: number(0),
        sqrt_price: number(sqrtPriceBx80),
      });
      expect(position).toEqual({
        fee_growth_inside_last: {
          x: number(1 * DECIMALS),
          y: number(2 * DECIMALS),
        },
        liquidity,
        lower_tick_index: number(lowerTickIndex),
        upper_tick_index: number(upperTickIndex),
        owner: accounts.alice.pkh,
      });

      const cfmmBalanceX = await tokenXStorage.balances.get(core.address);
      const cfmmBalanceY = await tokenYStorage.ledger.get({ 0: core.address, 1: 0 });

      // Tokens are transferred correctly to the cfmm
      expect(cfmmBalanceX.balance).toEqual(finalAmounts.x);
      expect(cfmmBalanceY).toEqual(undefined);
    });

    it("skips for 0 liquidity", async () => {
      // Initialise already existing ticks
      const lowerTickIndex = -10;
      const upperTickIndex = 10;

      const core = await tezos.deployContract("core", storage);

      // Arbitrary
      const amount = {
        x: number(20 * DECIMALS),
        y: number(20 * DECIMALS),
      };

      const options: SetPositionOptions = {
        lowerTickIndex,
        upperTickIndex,
        lowerTickWitness: -MAX_TICK,
        upperTickWitness: lowerTickIndex,
        liquidity: number(0), // 0 liquidity
        deadline: NOW + 1000,
        maximumTokensContributed: amount,
      };

      // When alice sets a new position with 0 liquidity, nothing happens.
      const op = await tezos.sendBatchOp([
        { kind: OpKind.TRANSACTION, ...PositionManager.setPositionOp(core, options) },
      ]);

      // Since no token approvals are done above, the transaction must have been completed to reach here.
      expect(op.status).toEqual("applied");
    });

    it("fails if deadline is crossed", async () => {
      // Initialise already existing ticks
      const lowerTickIndex = -10;
      const upperTickIndex = 10;

      const core = await tezos.deployContract("core", storage);

      // Arbitrary
      const amount = {
        x: number(20 * DECIMALS),
        y: number(20 * DECIMALS),
      };

      const options: SetPositionOptions = {
        lowerTickIndex,
        upperTickIndex,
        lowerTickWitness: -MAX_TICK,
        upperTickWitness: lowerTickIndex,
        liquidity: number(0),
        deadline: NOW - 1000, // In the past
        maximumTokensContributed: amount,
      };

      // When alice sets a new position after deadline is crossed, the txn fails
      await expect(
        tezos.sendBatchOp([
          { kind: OpKind.TRANSACTION, ...PositionManager.setPositionOp(core, options) },
        ])
      ).rejects.toThrow("103");
    });

    it("fails if lower tick does not respect tick spacing", async () => {
      // Initialise already existing ticks
      const lowerTickIndex = -11; // Incorrrect spacing
      const upperTickIndex = 10;

      const core = await tezos.deployContract("core", storage);

      // Arbitrary
      const amount = {
        x: number(20 * DECIMALS),
        y: number(20 * DECIMALS),
      };

      const options: SetPositionOptions = {
        lowerTickIndex,
        upperTickIndex,
        lowerTickWitness: -MAX_TICK,
        upperTickWitness: lowerTickIndex,
        liquidity: number(0),
        deadline: NOW + 1000,
        maximumTokensContributed: amount,
      };

      // When alice sets a new position with incorrect lower tick
      await expect(
        tezos.sendBatchOp([
          { kind: OpKind.TRANSACTION, ...PositionManager.setPositionOp(core, options) },
        ])
      ).rejects.toThrow("112");
    });

    it("fails if upper tick does not respect tick spacing", async () => {
      // Initialise already existing ticks
      const lowerTickIndex = -10;
      const upperTickIndex = 11; // Incorrrect spacing

      const core = await tezos.deployContract("core", storage);

      // Arbitrary
      const amount = {
        x: number(20 * DECIMALS),
        y: number(20 * DECIMALS),
      };

      const options: SetPositionOptions = {
        lowerTickIndex,
        upperTickIndex,
        lowerTickWitness: -MAX_TICK,
        upperTickWitness: lowerTickIndex,
        liquidity: number(0),
        deadline: NOW + 1000,
        maximumTokensContributed: amount,
      };

      // When alice sets a new position with incorrect upper tick
      await expect(
        tezos.sendBatchOp([
          { kind: OpKind.TRANSACTION, ...PositionManager.setPositionOp(core, options) },
        ])
      ).rejects.toThrow("112");
    });

    it("fails if lower tick is greater than or equals upper tick", async () => {
      // Initialise already existing ticks
      const lowerTickIndex = -10;
      const upperTickIndex = -10; // same as lower

      const core = await tezos.deployContract("core", storage);

      // Arbitrary
      const amount = {
        x: number(20 * DECIMALS),
        y: number(20 * DECIMALS),
      };

      const options: SetPositionOptions = {
        lowerTickIndex,
        upperTickIndex,
        lowerTickWitness: -MAX_TICK,
        upperTickWitness: lowerTickIndex,
        liquidity: number(0),
        deadline: NOW + 1000,
        maximumTokensContributed: amount,
      };

      // When alice sets a new position with lower tick = upper tick, the txn fails
      await expect(
        tezos.sendBatchOp([
          { kind: OpKind.TRANSACTION, ...PositionManager.setPositionOp(core, options) },
        ])
      ).rejects.toThrow("110");
    });

    it("fails if invalid lower tick witness is provided", async () => {
      // Initialise already existing ticks
      const lowerTickIndex = -10;
      const upperTickIndex = 10;

      const core = await tezos.deployContract("core", storage);

      // Arbitrary
      const amount = {
        x: number(20 * DECIMALS),
        y: number(20 * DECIMALS),
      };

      const options: SetPositionOptions = {
        lowerTickIndex,
        upperTickIndex,
        lowerTickWitness: 20, // Invalid witness
        upperTickWitness: lowerTickIndex,
        liquidity: number(1),
        deadline: NOW + 1000,
        maximumTokensContributed: amount,
      };

      // When alice sets a new position with invalid lower tick witness, the txn fails
      await expect(
        tezos.sendBatchOp([
          { kind: OpKind.TRANSACTION, ...PositionManager.setPositionOp(core, options) },
        ])
      ).rejects.toThrow("100");
    });

    it("fails if invalid upper tick witness is provided", async () => {
      // Initialise already existing ticks
      const lowerTickIndex = -10;
      const upperTickIndex = 10;

      const core = await tezos.deployContract("core", storage);

      // Arbitrary
      const amount = {
        x: number(20 * DECIMALS),
        y: number(20 * DECIMALS),
      };

      const options: SetPositionOptions = {
        lowerTickIndex,
        upperTickIndex,
        lowerTickWitness: -MAX_TICK,
        upperTickWitness: MAX_TICK, // Invalid witness
        liquidity: number(1),
        deadline: NOW + 1000,
        maximumTokensContributed: amount,
      };

      // When alice sets a new position with invalid upper tick witness, the txn fails
      await expect(
        tezos.sendBatchOp([
          { kind: OpKind.TRANSACTION, ...PositionManager.setPositionOp(core, options) },
        ])
      ).rejects.toThrow("100");
    });

    it("fails if more than maximum tokens conributed are requested", async () => {
      storage.cur_tick_index = number(10);
      storage.sqrt_price = Tick.computeSqrtPriceFromTick(10);

      const core = await tezos.deployContract("core", storage);

      const lowerTickIndex = -10;
      const upperTickIndex = 20;

      const sqrtPriceAx80 = Tick.computeSqrtPriceFromTick(lowerTickIndex);
      const sqrtPriceBx80 = Tick.computeSqrtPriceFromTick(upperTickIndex);
      const sqrtPriceCx80 = storage.sqrt_price;

      // Arbitrary initial amounts
      const amount = {
        x: number(50 * DECIMALS),
        y: number(50 * DECIMALS),
      };

      // SDK resolves the correct liquidity and associated amounts
      const liquidity = Liquidity.computeLiquidityFromAmount(
        amount,
        sqrtPriceCx80,
        sqrtPriceAx80,
        sqrtPriceBx80
      );

      const options: SetPositionOptions = {
        lowerTickIndex,
        upperTickIndex,
        lowerTickWitness: -MAX_TICK,
        upperTickWitness: -MAX_TICK,
        liquidity,
        deadline: NOW + 1000,
        maximumTokensContributed: { x: number(0), y: number(0) }, // Make it zero to make the test fail
      };

      // When alice sets a new position with really low max tokens contributed, the txn fails
      await expect(
        tezos.sendBatchOp([
          { kind: OpKind.TRANSACTION, ...PositionManager.setPositionOp(core, options) },
        ])
      ).rejects.toThrow();
    });
  });
};

export default test;
