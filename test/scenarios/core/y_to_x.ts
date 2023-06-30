import axios from "axios";
import { DefaultContractType, MichelsonMap, OpKind } from "@taquito/taquito";
import { Pool, Tick, Math2, MAX_TICK, Approvals, Liquidity } from "@plenty-labs/v3-sdk";

import Tezos from "../../tezos";
import { config } from "../../helpers/config";
import { accounts } from "../../helpers/accounts";
import { dateToTimestamp, number } from "../../helpers/math";
import { DECIMALS, getDefaultCoreStorage } from "../../helpers/default";
import { CoreStorage, FA12Storage, FA2Storage, TickState, YToXParams } from "../../types";

const test = () => {
  describe("core.y_to_x", () => {
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
      fa2Storage.ledger.set({ 0: accounts.alice.pkh, 1: 0 }, number(200 * DECIMALS));
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

    // -----(-10)------------0------<swap range>------(+10)------
    it("swaps correctly within the same range with no protocol share", async () => {
      const lowerTickIndex = -10;
      const upperTickIndex = 10;

      storage.cur_tick_witness = number(-10);

      const sqrtPriceAx80 = Tick.computeSqrtPriceFromTick(lowerTickIndex);
      const sqrtPriceBx80 = Tick.computeSqrtPriceFromTick(upperTickIndex);
      const sqrtPriceCx80 = storage.sqrt_price;

      // Initialise liquidity for swap
      const liquidity = Liquidity.computeLiquidityFromAmount(
        {
          x: number(100 * DECIMALS),
          y: number(100 * DECIMALS),
        },
        sqrtPriceCx80,
        sqrtPriceAx80,
        sqrtPriceBx80
      );

      const lowerTick: TickState = {
        prev: number(-MAX_TICK),
        next: number(10),
        liquidity_net: liquidity,
        n_positions: number(1),
        seconds_outside: number(0),
        tick_cumulative_outside: number(0),
        fee_growth_outside: { x: number(0), y: number(0) },
        seconds_per_liquidity_outside: number(0),
        sqrt_price: number(sqrtPriceAx80),
      };

      const upperTick: TickState = {
        prev: number(-10),
        next: number(MAX_TICK),
        liquidity_net: liquidity.multipliedBy(-1),
        n_positions: number(1),
        seconds_outside: number(0),
        tick_cumulative_outside: number(0),
        fee_growth_outside: { x: number(0), y: number(0) },
        seconds_per_liquidity_outside: number(0),
        sqrt_price: number(sqrtPriceBx80),
      };

      storage.ticks.set(lowerTickIndex, lowerTick);
      storage.ticks.set(upperTickIndex, upperTick);

      storage.liquidity = liquidity;

      // SDK pool instance
      const pool = new Pool(
        storage.cur_tick_index.toNumber(),
        storage.cur_tick_witness.toNumber(),
        storage.constants.tick_spacing.toNumber(),
        storage.sqrt_price,
        5,
        storage.liquidity
      );

      // 1500 bps for dev and 2000 for the protocol
      const factory = await tezos.deployContract("dummyFactory", { 0: 1500, 1: 2000 });

      storage.constants.factory = factory.address;

      const core = await tezos.deployContract("core", storage);

      // Maximum amount of Y for which the entirety of X can be depleted
      let yMax = Liquidity.computeAmountYFromLiquidity(liquidity, sqrtPriceCx80, sqrtPriceBx80);

      const params: YToXParams = {
        dy: Math2.floor(yMax.multipliedBy(0.1)), // swap 10% of the available limit
        to_dx: accounts.alice.pkh,
        min_dx: number(0), // Not relevant for this test
        deadline: NOW + 1000,
      };

      // Transfer token x to core so it can return it back
      await tezos.sendBatchOp([
        {
          kind: OpKind.TRANSACTION,
          ...tokenX.methodsObject
            .transfer({ from: accounts.alice.pkh, to: core.address, value: number(100 * DECIMALS) })
            .toTransferParams(),
        },
      ]);

      // Estimate the final swap amount through SDK
      const estimatedOutputX = await pool.estimateSwapYToX(params.dy, async (tick: number) => {
        const tickElement = (await storage.ticks.get(tick)) as TickState;
        return {
          index: tick,
          prevIndex: tickElement.prev.toNumber(),
          nextIndex: tickElement.next.toNumber(),
          liquidityNet: tickElement.liquidity_net,
          sqrtPrice: tickElement.sqrt_price,
        };
      });

      // When alice makes a swap within the same range
      await tezos.sendBatchOp([
        {
          kind: OpKind.TRANSACTION,
          ...Approvals.updateOperatorsFA2(tokenY, [
            { add_operator: { owner: accounts.alice.pkh, operator: core.address, token_id: 0 } },
          ]),
        },
        { kind: OpKind.TRANSACTION, ...core.methodsObject.y_to_x(params).toTransferParams() },
      ]);

      const updatedStorage = await tezos.getStorage(core);
      const tokenXStorage = await tezos.getStorage(tokenX);
      const tokenYStorage = await tezos.getStorage(tokenY);

      const devShare = params.dy
        .multipliedBy(5 * 0.15)
        .dividedBy(10000)
        .decimalPlaces(0);
      const fees = Math2.ceil(params.dy.multipliedBy(5).dividedBy(10000)).minus(devShare);
      const feeGrowth = Math2.floor(Math2.bitShift(fees, -128).dividedBy(liquidity));

      // the storage is updated correctly
      expect(updatedStorage.liquidity).toEqual(liquidity); // Does not change during a same range swap
      expect(updatedStorage.cur_tick_witness).toEqual(number(-10));
      expect(updatedStorage.dev_share.x).toEqual(number(0));
      expect(updatedStorage.dev_share.y).toEqual(devShare);
      expect(updatedStorage.protocol_share.x).toEqual(number(0));
      expect(updatedStorage.protocol_share.y).toEqual(number(0));
      expect(updatedStorage.fee_growth.x).toEqual(number(0));
      expect(updatedStorage.fee_growth.y).toEqual(number(feeGrowth));

      const aliceBalanceY = await tokenYStorage.ledger.get({ 0: accounts.alice.pkh, 1: 0 });
      const aliceBalanceX = await tokenXStorage.balances.get(accounts.alice.pkh);

      // Alice gets the correct amount of tokens
      expect(aliceBalanceX.balance).toEqual(estimatedOutputX.dx);
      expect(aliceBalanceY).toEqual(
        number(200 * DECIMALS)
          .minus(params.dy)
          .plus(estimatedOutputX.dy)
      );
    });

    // -----(-10)------------0------<swap range>------(+10)------
    it("swaps correctly within the same range with no protocol share", async () => {
      storage.is_ve = true; // Activate protocol share

      const lowerTickIndex = -10;
      const upperTickIndex = 10;

      storage.cur_tick_witness = number(-10);

      const sqrtPriceAx80 = Tick.computeSqrtPriceFromTick(lowerTickIndex);
      const sqrtPriceBx80 = Tick.computeSqrtPriceFromTick(upperTickIndex);
      const sqrtPriceCx80 = storage.sqrt_price;

      // Initialise liquidity for swap
      const liquidity = Liquidity.computeLiquidityFromAmount(
        {
          x: number(100 * DECIMALS),
          y: number(100 * DECIMALS),
        },
        sqrtPriceCx80,
        sqrtPriceAx80,
        sqrtPriceBx80
      );

      const lowerTick: TickState = {
        prev: number(-MAX_TICK),
        next: number(10),
        liquidity_net: liquidity,
        n_positions: number(1),
        seconds_outside: number(0),
        tick_cumulative_outside: number(0),
        fee_growth_outside: { x: number(0), y: number(0) },
        seconds_per_liquidity_outside: number(0),
        sqrt_price: number(sqrtPriceAx80),
      };

      const upperTick: TickState = {
        prev: number(-10),
        next: number(MAX_TICK),
        liquidity_net: liquidity.multipliedBy(-1),
        n_positions: number(1),
        seconds_outside: number(0),
        tick_cumulative_outside: number(0),
        fee_growth_outside: { x: number(0), y: number(0) },
        seconds_per_liquidity_outside: number(0),
        sqrt_price: number(sqrtPriceBx80),
      };

      storage.ticks.set(lowerTickIndex, lowerTick);
      storage.ticks.set(upperTickIndex, upperTick);

      storage.liquidity = liquidity;

      // SDK pool instance
      const pool = new Pool(
        storage.cur_tick_index.toNumber(),
        storage.cur_tick_witness.toNumber(),
        storage.constants.tick_spacing.toNumber(),
        storage.sqrt_price,
        5,
        storage.liquidity
      );

      // 1500 bps for dev and 2000 for the protocol
      const factory = await tezos.deployContract("dummyFactory", { 0: 1500, 1: 2000 });

      storage.constants.factory = factory.address;

      const core = await tezos.deployContract("core", storage);

      // Maximum amount of Y for which the entirety of X can be depleted
      let yMax = Liquidity.computeAmountYFromLiquidity(liquidity, sqrtPriceCx80, sqrtPriceBx80);

      const params: YToXParams = {
        dy: Math2.floor(yMax.multipliedBy(0.1)), // swap 10% of the available limit
        to_dx: accounts.alice.pkh,
        min_dx: number(0), // Not relevant for this test
        deadline: NOW + 1000,
      };

      // Transfer token x to core so it can return it back
      await tezos.sendBatchOp([
        {
          kind: OpKind.TRANSACTION,
          ...tokenX.methodsObject
            .transfer({ from: accounts.alice.pkh, to: core.address, value: number(100 * DECIMALS) })
            .toTransferParams(),
        },
      ]);

      // Estimate the final swap amount through SDK
      const estimatedOutputX = await pool.estimateSwapYToX(params.dy, async (tick: number) => {
        const tickElement = (await storage.ticks.get(tick)) as TickState;
        return {
          index: tick,
          prevIndex: tickElement.prev.toNumber(),
          nextIndex: tickElement.next.toNumber(),
          liquidityNet: tickElement.liquidity_net,
          sqrtPrice: tickElement.sqrt_price,
        };
      });

      // When alice makes a swap within the same range
      await tezos.sendBatchOp([
        {
          kind: OpKind.TRANSACTION,
          ...Approvals.updateOperatorsFA2(tokenY, [
            { add_operator: { owner: accounts.alice.pkh, operator: core.address, token_id: 0 } },
          ]),
        },
        { kind: OpKind.TRANSACTION, ...core.methodsObject.y_to_x(params).toTransferParams() },
      ]);

      const updatedStorage = await tezos.getStorage(core);
      const tokenXStorage = await tezos.getStorage(tokenX);
      const tokenYStorage = await tezos.getStorage(tokenY);

      const devShare = params.dy
        .multipliedBy(5 * 0.15)
        .dividedBy(10000)
        .decimalPlaces(0);
      const protocolShare = params.dy
        .multipliedBy(5 * 0.2)
        .dividedBy(10000)
        .decimalPlaces(0);
      const fees = Math2.ceil(params.dy.multipliedBy(5).dividedBy(10000))
        .minus(devShare)
        .minus(protocolShare);
      const feeGrowth = Math2.floor(Math2.bitShift(fees, -128).dividedBy(liquidity));

      // the storage is updated correctly
      expect(updatedStorage.liquidity).toEqual(liquidity); // Does not change during a same range swap
      expect(updatedStorage.cur_tick_witness).toEqual(number(-10));
      expect(updatedStorage.dev_share.x).toEqual(number(0));
      expect(updatedStorage.dev_share.y).toEqual(devShare);
      expect(updatedStorage.protocol_share.x).toEqual(number(0));
      expect(updatedStorage.protocol_share.y).toEqual(protocolShare);
      expect(updatedStorage.fee_growth.x).toEqual(number(0));
      expect(updatedStorage.fee_growth.y).toEqual(number(feeGrowth));

      const aliceBalanceY = await tokenYStorage.ledger.get({ 0: accounts.alice.pkh, 1: 0 });
      const aliceBalanceX = await tokenXStorage.balances.get(accounts.alice.pkh);

      // Alice gets the correct amount of tokens
      expect(aliceBalanceX.balance).toEqual(estimatedOutputX.dx);
      expect(aliceBalanceY).toEqual(
        number(200 * DECIMALS)
          .minus(params.dy)
          .plus(estimatedOutputX.dy)
      );
    });

    // -----(-10)------------0------<swap range>------(+10)------
    // Multiple small swaps are nearly close to one large swap for the summed input
    it("works correctly for multiple small swaps in the same range", async () => {
      storage.is_ve = true; // Allow for protocol share

      const lowerTickIndex = -10;
      const upperTickIndex = 10;

      storage.cur_tick_witness = number(-10);

      const sqrtPriceAx80 = Tick.computeSqrtPriceFromTick(lowerTickIndex);
      const sqrtPriceBx80 = Tick.computeSqrtPriceFromTick(upperTickIndex);
      const sqrtPriceCx80 = storage.sqrt_price;

      // Initialise liquidity for swap
      const liquidity = Liquidity.computeLiquidityFromAmount(
        {
          x: number(100 * DECIMALS),
          y: number(100 * DECIMALS),
        },
        sqrtPriceCx80,
        sqrtPriceAx80,
        sqrtPriceBx80
      );

      const lowerTick: TickState = {
        prev: number(-MAX_TICK),
        next: number(10),
        liquidity_net: liquidity,
        n_positions: number(1),
        seconds_outside: number(0),
        tick_cumulative_outside: number(0),
        fee_growth_outside: { x: number(0), y: number(0) },
        seconds_per_liquidity_outside: number(0),
        sqrt_price: number(sqrtPriceAx80),
      };

      const upperTick: TickState = {
        prev: number(-10),
        next: number(MAX_TICK),
        liquidity_net: liquidity.multipliedBy(-1),
        n_positions: number(1),
        seconds_outside: number(0),
        tick_cumulative_outside: number(0),
        fee_growth_outside: { x: number(0), y: number(0) },
        seconds_per_liquidity_outside: number(0),
        sqrt_price: number(sqrtPriceBx80),
      };

      storage.ticks.set(lowerTickIndex, lowerTick);
      storage.ticks.set(upperTickIndex, upperTick);

      storage.liquidity = liquidity;

      // SDK pool instance
      const pool = new Pool(
        storage.cur_tick_index.toNumber(),
        storage.cur_tick_witness.toNumber(),
        storage.constants.tick_spacing.toNumber(),
        storage.sqrt_price,
        5,
        storage.liquidity
      );

      // 1500 bps for dev and 2000 for the protocol
      const factory = await tezos.deployContract("dummyFactory", { 0: 1500, 1: 2000 });

      storage.constants.factory = factory.address;

      const core = await tezos.deployContract("core", storage);

      // Maximum amount of Y for which the entirety of X can be depleted
      let yMax = Liquidity.computeAmountYFromLiquidity(liquidity, sqrtPriceCx80, sqrtPriceBx80);

      const params: YToXParams = {
        dy: Math2.floor(yMax.multipliedBy(0.1)), // swap 10% of the available limit
        to_dx: accounts.alice.pkh,
        min_dx: number(0), // Not relevant for this test
        deadline: NOW + 1000,
      };

      // Transfer token x to core so it can return it back
      await tezos.sendBatchOp([
        {
          kind: OpKind.TRANSACTION,
          ...tokenX.methodsObject
            .transfer({ from: accounts.alice.pkh, to: core.address, value: number(100 * DECIMALS) })
            .toTransferParams(),
        },
      ]);

      // Estimate the final swap amount (when the total sum is the input) through SDK
      const estimatedOutputX = await pool.estimateSwapYToX(
        params.dy.multipliedBy(5), // Give the entire amount in one go
        async (tick: number) => {
          const tickElement = (await storage.ticks.get(tick)) as TickState;
          return {
            index: tick,
            prevIndex: tickElement.prev.toNumber(),
            nextIndex: tickElement.next.toNumber(),
            liquidityNet: tickElement.liquidity_net,
            sqrtPrice: tickElement.sqrt_price,
          };
        }
      );

      // When alice makes 5 swaps within the same range
      await tezos.sendBatchOp([
        {
          kind: OpKind.TRANSACTION,
          ...Approvals.updateOperatorsFA2(tokenY, [
            { add_operator: { owner: accounts.alice.pkh, operator: core.address, token_id: 0 } },
          ]),
        },
        { kind: OpKind.TRANSACTION, ...core.methodsObject.y_to_x(params).toTransferParams() },
        { kind: OpKind.TRANSACTION, ...core.methodsObject.y_to_x(params).toTransferParams() },
        { kind: OpKind.TRANSACTION, ...core.methodsObject.y_to_x(params).toTransferParams() },
        { kind: OpKind.TRANSACTION, ...core.methodsObject.y_to_x(params).toTransferParams() },
        { kind: OpKind.TRANSACTION, ...core.methodsObject.y_to_x(params).toTransferParams() },
      ]);

      const updatedStorage = await tezos.getStorage(core);
      const tokenXStorage = await tezos.getStorage(tokenX);

      const devShare = params.dy
        .multipliedBy(5 * 0.15)
        .decimalPlaces(0)
        .dividedBy(10000)
        .decimalPlaces(0);
      const protocolShare = params.dy
        .multipliedBy(5 * 0.2)
        .decimalPlaces(0)
        .dividedBy(10000)
        .decimalPlaces(0);
      const feeSingleSwap = Math2.ceil(params.dy.multipliedBy(5).dividedBy(10000))
        .minus(devShare)
        .minus(protocolShare);
      const growthSingle = Math2.floor(Math2.bitShift(feeSingleSwap, -128).dividedBy(liquidity));
      const feeGrowth = growthSingle.multipliedBy(5);

      // the storage is updated correctly
      expect(updatedStorage.liquidity).toEqual(liquidity); // Does not change during a same range swap
      expect(updatedStorage.cur_tick_witness).toEqual(number(-10));
      expect(updatedStorage.dev_share.y).toEqual(devShare.multipliedBy(5));
      expect(updatedStorage.dev_share.x).toEqual(number(0));
      expect(updatedStorage.protocol_share.y).toEqual(protocolShare.multipliedBy(5));
      expect(updatedStorage.fee_growth.y).toEqual(number(feeGrowth));
      expect(updatedStorage.protocol_share.x).toEqual(number(0));
      expect(updatedStorage.fee_growth.x).toEqual(number(0));

      const aliceBalanceX = await tokenXStorage.balances.get(accounts.alice.pkh);

      // Alice gets the correct amount of tokens
      expect(aliceBalanceX.balance.dividedBy(DECIMALS).toNumber()).toBeCloseTo(
        estimatedOutputX.dx.dividedBy(DECIMALS).toNumber(),
        5 // Expecting at least 5 digits of precision when token decimals is 6
      );
    });

    // -----(-10)---------0------<swap range 1>------(+10)-------<swap range 2>-----(+20)---
    it("works correctly for cross range swaps", async () => {
      storage.is_ve = true; // Allow for protocol share

      const tick1Index = -10;
      const tick2Index = 10;
      const tick3Index = 20;

      storage.cur_tick_witness = number(-10);

      const sqrtPriceTick1 = Tick.computeSqrtPriceFromTick(tick1Index);
      const sqrtPriceTick2 = Tick.computeSqrtPriceFromTick(tick2Index);
      const sqrtPriceTick3 = Tick.computeSqrtPriceFromTick(tick3Index);

      // Liquidity for tick1 -> tick2 (would be half in x and half in y)
      const liquidityOneToTwo = Liquidity.computeLiquidityFromAmount(
        {
          x: number(50 * DECIMALS),
          y: number(50 * DECIMALS),
        },
        storage.sqrt_price,
        sqrtPriceTick1,
        sqrtPriceTick2
      );

      // Liquidity for tick2 -> tick3 (would be purely in token X)
      const liquidityTwoToThree = Liquidity.computeLiquidityFromAmount(
        {
          x: number(50 * DECIMALS),
          y: number(50 * DECIMALS),
        },
        storage.sqrt_price,
        sqrtPriceTick2,
        sqrtPriceTick3
      );

      const tick1: TickState = {
        prev: number(-MAX_TICK),
        next: number(10),
        liquidity_net: liquidityOneToTwo,
        n_positions: number(1),
        seconds_outside: number(0),
        tick_cumulative_outside: number(0),
        fee_growth_outside: { x: number(0), y: number(0) },
        seconds_per_liquidity_outside: number(0),
        sqrt_price: number(sqrtPriceTick1),
      };

      const tick2: TickState = {
        prev: number(-10),
        next: number(20),
        liquidity_net: liquidityOneToTwo.multipliedBy(-1).plus(liquidityTwoToThree),
        n_positions: number(1),
        seconds_outside: number(0),
        tick_cumulative_outside: number(0),
        fee_growth_outside: { x: number(0), y: number(0) },
        seconds_per_liquidity_outside: number(0),
        sqrt_price: number(sqrtPriceTick2),
      };

      const tick3: TickState = {
        prev: number(10),
        next: number(MAX_TICK),
        liquidity_net: liquidityTwoToThree.multipliedBy(-1),
        n_positions: number(1),
        seconds_outside: number(0),
        tick_cumulative_outside: number(0),
        fee_growth_outside: { x: number(0), y: number(0) },
        seconds_per_liquidity_outside: number(0),
        sqrt_price: number(sqrtPriceTick2),
      };

      storage.ticks.set(tick1Index, tick1);
      storage.ticks.set(tick2Index, tick2);
      storage.ticks.set(tick3Index, tick3);

      storage.liquidity = liquidityOneToTwo;

      // SDK pool instance
      const pool = new Pool(
        storage.cur_tick_index.toNumber(),
        storage.cur_tick_witness.toNumber(),
        storage.constants.tick_spacing.toNumber(),
        storage.sqrt_price,
        5,
        storage.liquidity
      );

      // 1500 bps for dev and 2000 for the protocol
      const factory = await tezos.deployContract("dummyFactory", { 0: 1500, 1: 2000 });

      storage.constants.factory = factory.address;

      const core = await tezos.deployContract("core", storage);

      // Maximum y that can clear liquidity from cur tick (0) to tick 2 (10)
      const yCurToTwo = Liquidity.computeAmountYFromLiquidity(
        liquidityOneToTwo,
        storage.sqrt_price,
        sqrtPriceTick2
      );

      // Maximum y that can clear liquidity fromtick 2 (10) to tick 3 (20)
      const yTwoToThree = Liquidity.computeAmountYFromLiquidity(
        liquidityTwoToThree,
        sqrtPriceTick2,
        sqrtPriceTick3
      );

      const params: YToXParams = {
        // Entirety of y for tick 1 -> 2 and 10% of y for tick 2 -> 3
        dy: Math2.floor(yCurToTwo.plus(yTwoToThree.multipliedBy(0.1))),
        to_dx: accounts.alice.pkh,
        min_dx: number(0), // Not relevant for this test
        deadline: NOW + 1000,
      };

      // Transfer token x to core so it can return it back
      await tezos.sendBatchOp([
        {
          kind: OpKind.TRANSACTION,
          ...tokenX.methodsObject
            .transfer({ from: accounts.alice.pkh, to: core.address, value: number(100 * DECIMALS) })
            .toTransferParams(),
        },
      ]);

      // Estimate the final swap amount through SDK
      const estimatedOutputX = await pool.estimateSwapYToX(params.dy, async (tick: number) => {
        const tickElement = (await storage.ticks.get(tick)) as TickState;
        return {
          index: tick,
          prevIndex: tickElement.prev.toNumber(),
          nextIndex: tickElement.next.toNumber(),
          liquidityNet: tickElement.liquidity_net,
          sqrtPrice: tickElement.sqrt_price,
        };
      });

      // When alice makes the swap
      const op = await tezos.sendBatchOp([
        {
          kind: OpKind.TRANSACTION,
          ...Approvals.updateOperatorsFA2(tokenY, [
            { add_operator: { owner: accounts.alice.pkh, operator: core.address, token_id: 0 } },
          ]),
        },
        { kind: OpKind.TRANSACTION, ...core.methodsObject.y_to_x(params).toTransferParams() },
      ]);

      const updatedStorage = await tezos.getStorage(core);
      const tokenXStorage = await tezos.getStorage(tokenX);

      const yCurToTwoConsumed = Math2.ceil(yCurToTwo.multipliedBy(10000).dividedBy(9995));

      // Predicted values of fee
      const feeCurToTwo = Math2.ceil(yCurToTwoConsumed.multipliedBy(5).dividedBy(10000));
      const devShareCurToTwo = Math2.floor(feeCurToTwo.multipliedBy(1500).dividedBy(10000));
      const protocolShareCurToTwo = Math2.floor(feeCurToTwo.multipliedBy(2000).dividedBy(10000));
      const feeGrowthCurToTwo = Math2.floor(
        Math2.bitShift(
          feeCurToTwo.minus(devShareCurToTwo).minus(protocolShareCurToTwo),
          -128
        ).dividedBy(liquidityOneToTwo)
      );
      const feeTwoToFinal = Math2.ceil(
        params.dy.minus(yCurToTwoConsumed).multipliedBy(5).dividedBy(10000)
      );
      const devShareTwoToFinal = Math2.floor(feeTwoToFinal.multipliedBy(1500).dividedBy(10000));
      const protocolShareTwoToFinal = Math2.floor(
        feeTwoToFinal.multipliedBy(2000).dividedBy(10000)
      );
      const feeGrowthTwoToFinal = Math2.floor(
        Math2.bitShift(
          feeTwoToFinal.minus(devShareTwoToFinal).minus(protocolShareTwoToFinal),
          -128
        ).dividedBy(liquidityTwoToThree)
      );

      // block timestamp
      const timestamp = dateToTimestamp(
        (await axios.get(`${config.rpcURL}/chains/main/blocks/${op.includedInBlock}`)).data.header
          .timestamp
      );

      // Predicted values of tick specific cumulatives on tick 2
      const secondsOutside = number(timestamp);
      const tickCumulativeOutside = number(0);
      const feeGrowthOutside = feeGrowthCurToTwo;
      const secondsPerLiquidityOutside = Math2.floor(
        Math2.bitShift(number(timestamp), -128).dividedBy(liquidityOneToTwo)
      );

      // the storage is updated correctly
      expect(updatedStorage.liquidity).toEqual(liquidityTwoToThree); // New cur tick must be between tick 2 and tick 3
      expect(updatedStorage.cur_tick_witness).toEqual(number(10));
      expect(updatedStorage.dev_share.y).toEqual(devShareCurToTwo.plus(devShareTwoToFinal));
      expect(updatedStorage.dev_share.x).toEqual(number(0));
      expect(updatedStorage.protocol_share.x).toEqual(number(0));
      expect(updatedStorage.protocol_share.y).toEqual(
        protocolShareCurToTwo.plus(protocolShareTwoToFinal)
      );
      expect(updatedStorage.fee_growth.y).toEqual(
        number(feeGrowthCurToTwo.plus(feeGrowthTwoToFinal))
      );
      expect(updatedStorage.fee_growth.x).toEqual(number(0));

      const tick = await updatedStorage.ticks.get(10);

      expect(tick.seconds_outside).toEqual(secondsOutside);
      expect(tick.tick_cumulative_outside).toEqual(tickCumulativeOutside);
      expect(tick.fee_growth_outside.y).toEqual(number(feeGrowthOutside));
      expect(tick.seconds_per_liquidity_outside).toEqual(secondsPerLiquidityOutside);

      const aliceBalanceX = await tokenXStorage.balances.get(accounts.alice.pkh);

      // Alice gets the correct amount of tokens
      expect(aliceBalanceX.balance).toEqual(estimatedOutputX.dx);
    });

    // -----(-10)------------0------<swap range>------(+10)------
    it("swaps partially if a no liquidity boundary is hit", async () => {
      storage.is_ve = true; // Allow for protocol share

      const lowerTickIndex = -10;
      const upperTickIndex = 10;

      storage.cur_tick_witness = number(-10);

      const sqrtPriceAx80 = Tick.computeSqrtPriceFromTick(lowerTickIndex);
      const sqrtPriceBx80 = Tick.computeSqrtPriceFromTick(upperTickIndex);
      const sqrtPriceCx80 = storage.sqrt_price;

      // Initialise liquidity for swap
      const liquidity = Liquidity.computeLiquidityFromAmount(
        {
          x: number(100 * DECIMALS),
          y: number(100 * DECIMALS),
        },
        sqrtPriceCx80,
        sqrtPriceAx80,
        sqrtPriceBx80
      );

      const lowerTick: TickState = {
        prev: number(-MAX_TICK),
        next: number(10),
        liquidity_net: liquidity,
        n_positions: number(1),
        seconds_outside: number(0),
        tick_cumulative_outside: number(0),
        fee_growth_outside: { x: number(0), y: number(0) },
        seconds_per_liquidity_outside: number(0),
        sqrt_price: number(sqrtPriceAx80),
      };

      const upperTick: TickState = {
        prev: number(-10),
        next: number(MAX_TICK),
        liquidity_net: liquidity.multipliedBy(-1),
        n_positions: number(1),
        seconds_outside: number(0),
        tick_cumulative_outside: number(0),
        fee_growth_outside: { x: number(0), y: number(0) },
        seconds_per_liquidity_outside: number(0),
        sqrt_price: number(sqrtPriceBx80),
      };

      storage.ticks.set(lowerTickIndex, lowerTick);
      storage.ticks.set(upperTickIndex, upperTick);

      storage.liquidity = liquidity;

      // 1500 bps for dev and 2000 for the protocol
      const factory = await tezos.deployContract("dummyFactory", { 0: 1500, 1: 2000 });

      storage.constants.factory = factory.address;

      const core = await tezos.deployContract("core", storage);

      // Maximum amount of Y for which the entirety of X can be depleted
      let yMax = Liquidity.computeAmountYFromLiquidity(liquidity, sqrtPriceCx80, sqrtPriceBx80);

      const params: YToXParams = {
        dy: Math2.floor(yMax.multipliedBy(1.1)), // Send 10% more to jump to the zero liquidity zone
        to_dx: accounts.alice.pkh,
        min_dx: number(0), // Not relevant for this test
        deadline: NOW + 1000,
      };

      // Transfer token x to core so it can return it back
      await tezos.sendBatchOp([
        {
          kind: OpKind.TRANSACTION,
          ...tokenX.methodsObject
            .transfer({ from: accounts.alice.pkh, to: core.address, value: number(100 * DECIMALS) })
            .toTransferParams(),
        },
      ]);

      // When alice makes a swap
      await tezos.sendBatchOp([
        {
          kind: OpKind.TRANSACTION,
          ...Approvals.updateOperatorsFA2(tokenY, [
            { add_operator: { owner: accounts.alice.pkh, operator: core.address, token_id: 0 } },
          ]),
        },
        { kind: OpKind.TRANSACTION, ...core.methodsObject.y_to_x(params).toTransferParams() },
      ]);

      const updatedStorage = await tezos.getStorage(core);
      const tokenXStorage = await tezos.getStorage(tokenX);

      // the storage is updated correctly
      expect(updatedStorage.liquidity).toEqual(number(0)); // New zone has zero liquidity
      expect(updatedStorage.cur_tick_witness).toEqual(number(10));

      const aliceBalanceX = await tokenXStorage.balances.get(accounts.alice.pkh);

      // Alice gets the correct amount of tokens (should be the whole amt of x)
      // -1 to adjust for rounding down in the contract
      expect(aliceBalanceX.balance).toEqual(number(100 * DECIMALS - 1));
    });

    it("fails if deadline is crossed", async () => {
      storage.is_ve = true; // Allow for protocol share

      const lowerTickIndex = -10;
      const upperTickIndex = 10;

      storage.cur_tick_witness = number(-10);

      const sqrtPriceAx80 = Tick.computeSqrtPriceFromTick(lowerTickIndex);
      const sqrtPriceBx80 = Tick.computeSqrtPriceFromTick(upperTickIndex);
      const sqrtPriceCx80 = storage.sqrt_price;

      // Initialise liquidity for swap
      const liquidity = Liquidity.computeLiquidityFromAmount(
        {
          x: number(100 * DECIMALS),
          y: number(100 * DECIMALS),
        },
        sqrtPriceCx80,
        sqrtPriceAx80,
        sqrtPriceBx80
      );

      const lowerTick: TickState = {
        prev: number(-MAX_TICK),
        next: number(10),
        liquidity_net: liquidity,
        n_positions: number(1),
        seconds_outside: number(0),
        tick_cumulative_outside: number(0),
        fee_growth_outside: { x: number(0), y: number(0) },
        seconds_per_liquidity_outside: number(0),
        sqrt_price: number(sqrtPriceAx80),
      };

      const upperTick: TickState = {
        prev: number(-10),
        next: number(MAX_TICK),
        liquidity_net: liquidity.multipliedBy(-1),
        n_positions: number(1),
        seconds_outside: number(0),
        tick_cumulative_outside: number(0),
        fee_growth_outside: { x: number(0), y: number(0) },
        seconds_per_liquidity_outside: number(0),
        sqrt_price: number(sqrtPriceBx80),
      };

      storage.ticks.set(lowerTickIndex, lowerTick);
      storage.ticks.set(upperTickIndex, upperTick);

      storage.liquidity = liquidity;

      // 1500 bps for dev and 2000 for the protocol
      const factory = await tezos.deployContract("dummyFactory", { 0: 1500, 1: 2000 });

      storage.constants.factory = factory.address;

      const core = await tezos.deployContract("core", storage);

      // Maximum amount of Y for which the entirety of X can be depleted
      let yMax = Liquidity.computeAmountYFromLiquidity(liquidity, sqrtPriceCx80, sqrtPriceBx80);

      const params: YToXParams = {
        dy: Math2.floor(yMax.multipliedBy(0.1)),
        to_dx: accounts.alice.pkh,
        min_dx: number(0),
        deadline: NOW - 1000, // Deadline is crossed
      };

      // Transfer token x to core so it can return it back
      await tezos.sendBatchOp([
        {
          kind: OpKind.TRANSACTION,
          ...tokenX.methodsObject
            .transfer({ from: accounts.alice.pkh, to: core.address, value: number(100 * DECIMALS) })
            .toTransferParams(),
        },
      ]);

      // When alice makes a swap with the deadline being crossed, the txn fails
      await expect(
        tezos.sendBatchOp([
          {
            kind: OpKind.TRANSACTION,
            ...Approvals.updateOperatorsFA2(tokenY, [
              { add_operator: { owner: accounts.alice.pkh, operator: core.address, token_id: 0 } },
            ]),
          },
          { kind: OpKind.TRANSACTION, ...core.methodsObject.y_to_x(params).toTransferParams() },
        ])
      ).rejects.toThrow();
    });

    it("fails if dx received is less than minimum requested dx", async () => {
      storage.is_ve = true; // Allow for protocol share

      const lowerTickIndex = -10;
      const upperTickIndex = 10;

      storage.cur_tick_witness = number(-10);

      const sqrtPriceAx80 = Tick.computeSqrtPriceFromTick(lowerTickIndex);
      const sqrtPriceBx80 = Tick.computeSqrtPriceFromTick(upperTickIndex);
      const sqrtPriceCx80 = storage.sqrt_price;

      // Initialise liquidity for swap
      const liquidity = Liquidity.computeLiquidityFromAmount(
        {
          x: number(100 * DECIMALS),
          y: number(100 * DECIMALS),
        },
        sqrtPriceCx80,
        sqrtPriceAx80,
        sqrtPriceBx80
      );

      const lowerTick: TickState = {
        prev: number(-MAX_TICK),
        next: number(10),
        liquidity_net: liquidity,
        n_positions: number(1),
        seconds_outside: number(0),
        tick_cumulative_outside: number(0),
        fee_growth_outside: { x: number(0), y: number(0) },
        seconds_per_liquidity_outside: number(0),
        sqrt_price: number(sqrtPriceAx80),
      };

      const upperTick: TickState = {
        prev: number(-10),
        next: number(MAX_TICK),
        liquidity_net: liquidity.multipliedBy(-1),
        n_positions: number(1),
        seconds_outside: number(0),
        tick_cumulative_outside: number(0),
        fee_growth_outside: { x: number(0), y: number(0) },
        seconds_per_liquidity_outside: number(0),
        sqrt_price: number(sqrtPriceBx80),
      };

      storage.ticks.set(lowerTickIndex, lowerTick);
      storage.ticks.set(upperTickIndex, upperTick);

      storage.liquidity = liquidity;

      // 1500 bps for dev and 2000 for the protocol
      const factory = await tezos.deployContract("dummyFactory", { 0: 1500, 1: 2000 });

      storage.constants.factory = factory.address;

      const core = await tezos.deployContract("core", storage);

      // Maximum amount of Y for which the entirety of X can be depleted
      let yMax = Liquidity.computeAmountYFromLiquidity(liquidity, sqrtPriceCx80, sqrtPriceBx80);

      const params: YToXParams = {
        dy: Math2.floor(yMax.multipliedBy(0.1)),
        to_dx: accounts.alice.pkh,
        min_dx: number(101 * DECIMALS), // more than the possible amount
        deadline: NOW + 1000,
      };

      // Transfer token x to core so it can return it back
      await tezos.sendBatchOp([
        {
          kind: OpKind.TRANSACTION,
          ...tokenX.methodsObject
            .transfer({ from: accounts.alice.pkh, to: core.address, value: number(100 * DECIMALS) })
            .toTransferParams(),
        },
      ]);

      // When alice makes a swap with the deadline being crossed, the txn fails
      await expect(
        tezos.sendBatchOp([
          {
            kind: OpKind.TRANSACTION,
            ...Approvals.updateOperatorsFA2(tokenY, [
              { add_operator: { owner: accounts.alice.pkh, operator: core.address, token_id: 0 } },
            ]),
          },
          { kind: OpKind.TRANSACTION, ...core.methodsObject.y_to_x(params).toTransferParams() },
        ])
      ).rejects.toThrow();
    });

    it("fails if dev and protocol share collectively exceed swap fees", async () => {
      storage.is_ve = true; // Allow for protocol share

      const lowerTickIndex = -10;
      const upperTickIndex = 10;

      storage.cur_tick_witness = number(-10);

      const sqrtPriceAx80 = Tick.computeSqrtPriceFromTick(lowerTickIndex);
      const sqrtPriceBx80 = Tick.computeSqrtPriceFromTick(upperTickIndex);
      const sqrtPriceCx80 = storage.sqrt_price;

      // Initialise liquidity for swap
      const liquidity = Liquidity.computeLiquidityFromAmount(
        {
          x: number(100 * DECIMALS),
          y: number(100 * DECIMALS),
        },
        sqrtPriceCx80,
        sqrtPriceAx80,
        sqrtPriceBx80
      );

      const lowerTick: TickState = {
        prev: number(-MAX_TICK),
        next: number(10),
        liquidity_net: liquidity,
        n_positions: number(1),
        seconds_outside: number(0),
        tick_cumulative_outside: number(0),
        fee_growth_outside: { x: number(0), y: number(0) },
        seconds_per_liquidity_outside: number(0),
        sqrt_price: number(sqrtPriceAx80),
      };

      const upperTick: TickState = {
        prev: number(-10),
        next: number(MAX_TICK),
        liquidity_net: liquidity.multipliedBy(-1),
        n_positions: number(1),
        seconds_outside: number(0),
        tick_cumulative_outside: number(0),
        fee_growth_outside: { x: number(0), y: number(0) },
        seconds_per_liquidity_outside: number(0),
        sqrt_price: number(sqrtPriceBx80),
      };

      storage.ticks.set(lowerTickIndex, lowerTick);
      storage.ticks.set(upperTickIndex, upperTick);

      storage.liquidity = liquidity;

      // Shares exceed 100%
      const factory = await tezos.deployContract("dummyFactory", { 0: 6500, 1: 5500 });

      storage.constants.factory = factory.address;

      const core = await tezos.deployContract("core", storage);

      // Maximum amount of Y for which the entirety of X can be depleted
      let yMax = Liquidity.computeAmountYFromLiquidity(liquidity, sqrtPriceCx80, sqrtPriceBx80);

      const params: YToXParams = {
        dy: Math2.floor(yMax.multipliedBy(0.1)),
        to_dx: accounts.alice.pkh,
        min_dx: number(0),
        deadline: NOW + 1000,
      };

      // Transfer token x to core so it can return it back
      await tezos.sendBatchOp([
        {
          kind: OpKind.TRANSACTION,
          ...tokenX.methodsObject
            .transfer({ from: accounts.alice.pkh, to: core.address, value: number(100 * DECIMALS) })
            .toTransferParams(),
        },
      ]);

      // When alice makes a swap with the deadline being crossed, the txn fails
      await expect(
        tezos.sendBatchOp([
          {
            kind: OpKind.TRANSACTION,
            ...Approvals.updateOperatorsFA2(tokenY, [
              { add_operator: { owner: accounts.alice.pkh, operator: core.address, token_id: 0 } },
            ]),
          },
          { kind: OpKind.TRANSACTION, ...core.methodsObject.y_to_x(params).toTransferParams() },
        ])
      ).rejects.toThrow("404");
    });

    it("fails if swap fees is greater than 100%", async () => {
      storage.is_ve = true; // Allow for protocol share

      storage.constants.fee_bps = number(10100); // 101% swap fees

      const lowerTickIndex = -10;
      const upperTickIndex = 10;

      storage.cur_tick_witness = number(-10);

      const sqrtPriceAx80 = Tick.computeSqrtPriceFromTick(lowerTickIndex);
      const sqrtPriceBx80 = Tick.computeSqrtPriceFromTick(upperTickIndex);
      const sqrtPriceCx80 = storage.sqrt_price;

      // Initialise liquidity for swap
      const liquidity = Liquidity.computeLiquidityFromAmount(
        {
          x: number(100 * DECIMALS),
          y: number(100 * DECIMALS),
        },
        sqrtPriceCx80,
        sqrtPriceAx80,
        sqrtPriceBx80
      );

      const lowerTick: TickState = {
        prev: number(-MAX_TICK),
        next: number(10),
        liquidity_net: liquidity,
        n_positions: number(1),
        seconds_outside: number(0),
        tick_cumulative_outside: number(0),
        fee_growth_outside: { x: number(0), y: number(0) },
        seconds_per_liquidity_outside: number(0),
        sqrt_price: number(sqrtPriceAx80),
      };

      const upperTick: TickState = {
        prev: number(-10),
        next: number(MAX_TICK),
        liquidity_net: liquidity.multipliedBy(-1),
        n_positions: number(1),
        seconds_outside: number(0),
        tick_cumulative_outside: number(0),
        fee_growth_outside: { x: number(0), y: number(0) },
        seconds_per_liquidity_outside: number(0),
        sqrt_price: number(sqrtPriceBx80),
      };

      storage.ticks.set(lowerTickIndex, lowerTick);
      storage.ticks.set(upperTickIndex, upperTick);

      storage.liquidity = liquidity;

      // 1500 bps for dev and 2000 for the protocol
      const factory = await tezos.deployContract("dummyFactory", { 0: 1500, 1: 2000 });

      storage.constants.factory = factory.address;

      const core = await tezos.deployContract("core", storage);

      // Maximum amount of Y for which the entirety of X can be depleted
      let yMax = Liquidity.computeAmountYFromLiquidity(liquidity, sqrtPriceCx80, sqrtPriceBx80);

      const params: YToXParams = {
        dy: Math2.floor(yMax.multipliedBy(0.1)),
        to_dx: accounts.alice.pkh,
        min_dx: number(0), // irrelevant
        deadline: NOW + 1000,
      };

      // Transfer token x to core so it can return it back
      await tezos.sendBatchOp([
        {
          kind: OpKind.TRANSACTION,
          ...tokenX.methodsObject
            .transfer({ from: accounts.alice.pkh, to: core.address, value: number(100 * DECIMALS) })
            .toTransferParams(),
        },
      ]);

      // When alice makes a swap with the deadline being crossed, the txn fails
      await expect(
        tezos.sendBatchOp([
          {
            kind: OpKind.TRANSACTION,
            ...Approvals.updateOperatorsFA2(tokenY, [
              { add_operator: { owner: accounts.alice.pkh, operator: core.address, token_id: 0 } },
            ]),
          },
          { kind: OpKind.TRANSACTION, ...core.methodsObject.y_to_x(params).toTransferParams() },
        ])
      ).rejects.toThrow("303");
    });
  });
};

export default test;
