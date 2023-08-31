import { DefaultContractType, MichelsonMap, OpKind } from "@taquito/taquito";
import {
  Tick,
  Math2,
  MAX_TICK,
  Approvals,
  Liquidity,
  PositionManager,
  UpdatePositionOptions,
} from "@plenty-labs/v3-sdk";

import Tezos from "../../tezos";
import { number } from "../../helpers/math";
import { config } from "../../helpers/config";
import { accounts } from "../../helpers/accounts";
import { DECIMALS, getDefaultCoreStorage } from "../../helpers/default";
import { CoreStorage, FA12Storage, FA2Storage, Position, TickState } from "../../types";

describe("core.update_position", () => {
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

  it("correctly increases liquidity in a position", async () => {
    const lowerTickIndex = -10;
    const upperTickIndex = 10;

    const initialLiquidity = number(1000);

    const position: Position = {
      fee_growth_inside_last: {
        x: number(0),
        y: number(0),
      },
      liquidity: initialLiquidity, // arbitrary
      lower_tick_index: number(lowerTickIndex),
      upper_tick_index: number(upperTickIndex),
    };

    const sqrtPriceAx80 = Tick.computeSqrtPriceFromTick(lowerTickIndex);
    const sqrtPriceBx80 = Tick.computeSqrtPriceFromTick(upperTickIndex);
    const sqrtPriceCx80 = storage.sqrt_price;

    storage.ledger.set(1, accounts.alice.pkh);
    storage.positions.set(1, position);

    const lowerTick: TickState = {
      prev: number(-MAX_TICK),
      next: number(10),
      liquidity_net: initialLiquidity,
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

    // Simulating fees
    // Let's say 2 * DECIMALS of each x and y was collected in the range
    // f/L = 2_000_000 / 1000 = 2000, so
    const feeGrowthX = Math2.bitShift(number(2000), -128);
    const feeGrowthY = Math2.bitShift(number(2000), -128);

    storage.fee_growth = {
      x: feeGrowthX,
      y: feeGrowthY,
    };

    storage.liquidity = number(1000);

    const core = await tezos.deployContract("core", storage);

    // Arbitrary amount to increase liquidity by
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

    const options: UpdatePositionOptions = {
      positionId: 1,
      liquidityDelta: liquidity,
      toX: accounts.mike.pkh, // irrelevant for addition
      toY: accounts.john.pkh, // irrelevant
      deadline: NOW + 1000,
      maximumTokensContributed: finalAmounts,
    };

    // When alice updates a position
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
      { kind: OpKind.TRANSACTION, ...PositionManager.updatePositionOp(core, options) },
    ]);

    const updatedStorage = await tezos.getStorage(core);
    const tokenXStorage = await tezos.getStorage(tokenX);
    const tokenYStorage = await tezos.getStorage(tokenY);

    const updatedPosition = await updatedStorage.positions.get(1);
    const lowerTickState = await updatedStorage.ticks.get(lowerTickIndex);
    const upperTickState = await updatedStorage.ticks.get(upperTickIndex);

    // the storage is updated correctly
    expect(updatedStorage.liquidity).toEqual(liquidity.plus(1000));

    expect(lowerTickState.liquidity_net).toEqual(liquidity.plus(1000));
    expect(upperTickState.liquidity_net).toEqual(liquidity.plus(1000).multipliedBy(-1));
    expect(updatedPosition).toEqual({
      fee_growth_inside_last: {
        x: number(feeGrowthX),
        y: number(feeGrowthY),
      },
      liquidity: liquidity.plus(1000),
      lower_tick_index: number(lowerTickIndex),
      upper_tick_index: number(upperTickIndex),
    });

    const cfmmBalanceX = await tokenXStorage.balances.get(core.address);
    const cfmmBalanceY = await tokenYStorage.ledger.get({ 0: core.address, 1: 0 });

    // Since fees is reinvested, the final amount transferred would be less by the amt of fees
    finalAmounts.x = finalAmounts.x.minus(2 * DECIMALS);
    finalAmounts.y = finalAmounts.y.minus(2 * DECIMALS);

    // Tokens are transferred correctly to the cfmm
    expect(cfmmBalanceX.balance).toEqual(finalAmounts.x);
    expect(cfmmBalanceY).toEqual(finalAmounts.y);
  });

  it("correctly increases liquidity in a position not owned by the sender", async () => {
    const lowerTickIndex = -10;
    const upperTickIndex = 10;

    const initialLiquidity = number(1000);

    const position: Position = {
      fee_growth_inside_last: {
        x: number(0),
        y: number(0),
      },
      liquidity: initialLiquidity, // arbitrary
      lower_tick_index: number(lowerTickIndex),
      upper_tick_index: number(upperTickIndex),
    };

    const sqrtPriceAx80 = Tick.computeSqrtPriceFromTick(lowerTickIndex);
    const sqrtPriceBx80 = Tick.computeSqrtPriceFromTick(upperTickIndex);
    const sqrtPriceCx80 = storage.sqrt_price;

    storage.ledger.set(1, accounts.bob.pkh);
    storage.positions.set(1, position);

    const lowerTick: TickState = {
      prev: number(-MAX_TICK),
      next: number(10),
      liquidity_net: initialLiquidity,
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

    // Simulating fees
    // Let's say 2 * DECIMALS of each x and y was collected in the range
    // f/L = 2_000_000 / 1000 = 2000, so
    const feeGrowthX = Math2.bitShift(number(2000), -128);
    const feeGrowthY = Math2.bitShift(number(2000), -128);

    storage.fee_growth = {
      x: feeGrowthX,
      y: feeGrowthY,
    };

    storage.liquidity = number(1000);

    const core = await tezos.deployContract("core", storage);

    // Arbitrary amount to increase liquidity by
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

    const options: UpdatePositionOptions = {
      positionId: 1,
      liquidityDelta: liquidity,
      toX: accounts.mike.pkh, // irrelevant for addition
      toY: accounts.john.pkh, // irrelevant
      deadline: NOW + 1000,
      maximumTokensContributed: finalAmounts,
    };

    // When alice (not position owner) updates a position
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
      { kind: OpKind.TRANSACTION, ...PositionManager.updatePositionOp(core, options) },
    ]);

    const updatedStorage = await tezos.getStorage(core);
    const tokenXStorage = await tezos.getStorage(tokenX);
    const tokenYStorage = await tezos.getStorage(tokenY);

    const updatedPosition = await updatedStorage.positions.get(1);
    const lowerTickState = await updatedStorage.ticks.get(lowerTickIndex);
    const upperTickState = await updatedStorage.ticks.get(upperTickIndex);

    // the storage is updated correctly
    expect(updatedStorage.liquidity).toEqual(liquidity.plus(1000));

    expect(lowerTickState.liquidity_net).toEqual(liquidity.plus(1000));
    expect(upperTickState.liquidity_net).toEqual(liquidity.plus(1000).multipliedBy(-1));
    expect(updatedPosition).toEqual({
      fee_growth_inside_last: {
        x: number(feeGrowthX),
        y: number(feeGrowthY),
      },
      liquidity: liquidity.plus(1000),
      lower_tick_index: number(lowerTickIndex),
      upper_tick_index: number(upperTickIndex),
    });

    const cfmmBalanceX = await tokenXStorage.balances.get(core.address);
    const cfmmBalanceY = await tokenYStorage.ledger.get({ 0: core.address, 1: 0 });

    // Since fees is reinvested, the final amount transferred would be less by the amt of fees
    finalAmounts.x = finalAmounts.x.minus(2 * DECIMALS);
    finalAmounts.y = finalAmounts.y.minus(2 * DECIMALS);

    // Tokens are transferred correctly to the cfmm
    expect(cfmmBalanceX.balance).toEqual(finalAmounts.x);
    expect(cfmmBalanceY).toEqual(finalAmounts.y);
  });

  it("correctly removes liquidity from a position", async () => {
    const lowerTickIndex = -10;
    const upperTickIndex = 10;

    const sqrtPriceAx80 = Tick.computeSqrtPriceFromTick(lowerTickIndex);
    const sqrtPriceBx80 = Tick.computeSqrtPriceFromTick(upperTickIndex);
    const sqrtPriceCx80 = storage.sqrt_price;

    // Arbitrary amount of tokens for initial liquidity
    const amount = {
      x: number(50 * DECIMALS),
      y: number(50 * DECIMALS),
    };

    // SDK resolves the correct liquidity and associated amounts
    const initialLiquidity = Liquidity.computeLiquidityFromAmount(
      amount,
      sqrtPriceCx80,
      sqrtPriceAx80,
      sqrtPriceBx80
    );

    const position: Position = {
      fee_growth_inside_last: {
        x: number(0),
        y: number(0),
      },
      liquidity: initialLiquidity,
      lower_tick_index: number(lowerTickIndex),
      upper_tick_index: number(upperTickIndex),
    };

    storage.ledger.set(1, accounts.alice.pkh);
    storage.positions.set(1, position);

    const lowerTick: TickState = {
      prev: number(-MAX_TICK),
      next: number(10),
      liquidity_net: initialLiquidity,
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

    // Simulating fees
    // Let's say 2 * DECIMALS of each x and y was collected in the range
    // f/L = 2_000_000 / L
    const feeGrowthX = Math2.floor(
      Math2.bitShift(number(2_000_000).dividedBy(initialLiquidity), -128)
    );
    const feeGrowthY = Math2.floor(
      Math2.bitShift(number(2_000_000).dividedBy(initialLiquidity), -128)
    );

    storage.fee_growth = {
      x: feeGrowthX,
      y: feeGrowthY,
    };

    storage.liquidity = initialLiquidity;

    const core = await tezos.deployContract("core", storage);

    const liquidityDelta = Math2.floor(initialLiquidity.multipliedBy(-0.1));
    const remainingLiquidity = initialLiquidity.plus(liquidityDelta);

    const removedAmount = Liquidity.computeAmountFromLiquidity(
      liquidityDelta,
      sqrtPriceCx80,
      sqrtPriceAx80,
      sqrtPriceBx80
    );

    const options: UpdatePositionOptions = {
      positionId: 1,
      liquidityDelta: liquidityDelta, // Remove 10% of liquidity
      toX: accounts.alice.pkh,
      toY: accounts.alice.pkh,
      deadline: NOW + 1000,
      maximumTokensContributed: { x: number(0), y: number(0) },
    };

    // Transfer tokens to core so it can return it back when removing liquidity
    await tezos.sendBatchOp([
      {
        kind: OpKind.TRANSACTION,
        ...tokenX.methodsObject
          .transfer({
            from: accounts.alice.pkh,
            to: core.address,
            value: number(100 * DECIMALS),
          })
          .toTransferParams(),
      },
      {
        kind: OpKind.TRANSACTION,
        ...tokenY.methodsObject
          .transfer([
            {
              from_: accounts.alice.pkh,
              txs: [{ to_: core.address, token_id: 0, amount: number(100 * DECIMALS) }],
            },
          ])
          .toTransferParams(),
      },
    ]);

    // When alice updates a position
    const op = await tezos.sendBatchOp([
      { kind: OpKind.TRANSACTION, ...PositionManager.updatePositionOp(core, options) },
    ]);

    const updatedStorage = await tezos.getStorage(core);
    const tokenXStorage = await tezos.getStorage(tokenX);
    const tokenYStorage = await tezos.getStorage(tokenY);

    const updatedPosition = await updatedStorage.positions.get(1);
    const lowerTickState = await updatedStorage.ticks.get(lowerTickIndex);
    const upperTickState = await updatedStorage.ticks.get(upperTickIndex);

    // the storage is updated correctly
    expect(updatedStorage.liquidity).toEqual(remainingLiquidity);
    expect(lowerTickState.liquidity_net).toEqual(remainingLiquidity);
    expect(upperTickState.liquidity_net).toEqual(remainingLiquidity.multipliedBy(-1));
    expect(updatedPosition).toEqual({
      fee_growth_inside_last: {
        x: number(feeGrowthX),
        y: number(feeGrowthY),
      },
      liquidity: remainingLiquidity,
      lower_tick_index: number(lowerTickIndex),
      upper_tick_index: number(upperTickIndex),
    });

    const aliceBalanceX = await tokenXStorage.balances.get(accounts.alice.pkh);
    const aliceBalanceY = await tokenYStorage.ledger.get({ 0: accounts.alice.pkh, 1: 0 });

    // Recalculate to adjust for rounding
    const collectedFeesX = Math2.bitShift(storage.fee_growth.x.multipliedBy(initialLiquidity), 128);
    const collectedFeesY = Math2.bitShift(storage.fee_growth.y.multipliedBy(initialLiquidity), 128);

    // Since fees is returned along, alice gets the removed liquidity + fees
    removedAmount.x = removedAmount.x.abs().plus(collectedFeesX);
    removedAmount.y = removedAmount.y.abs().plus(collectedFeesY);

    // Tokens are transferred correctly to alice
    expect(aliceBalanceX.balance).toEqual(removedAmount.x);
    expect(aliceBalanceY).toEqual(removedAmount.y);
  });

  it("correctly removes the entire position", async () => {
    const lowerTickIndex = -10;
    const upperTickIndex = 10;

    const sqrtPriceAx80 = Tick.computeSqrtPriceFromTick(lowerTickIndex);
    const sqrtPriceBx80 = Tick.computeSqrtPriceFromTick(upperTickIndex);
    const sqrtPriceCx80 = storage.sqrt_price;

    // Arbitrary amount of tokens for initial liquidity
    const amount = {
      x: number(50 * DECIMALS),
      y: number(50 * DECIMALS),
    };

    // SDK resolves the correct liquidity and associated amounts
    const initialLiquidity = Liquidity.computeLiquidityFromAmount(
      amount,
      sqrtPriceCx80,
      sqrtPriceAx80,
      sqrtPriceBx80
    );

    const position: Position = {
      fee_growth_inside_last: {
        x: number(0),
        y: number(0),
      },
      liquidity: initialLiquidity,
      lower_tick_index: number(lowerTickIndex),
      upper_tick_index: number(upperTickIndex),
    };

    storage.ledger.set(1, accounts.alice.pkh);
    storage.positions.set(1, position);

    const lowerTick: TickState = {
      prev: number(-MAX_TICK),
      next: number(10),
      liquidity_net: initialLiquidity,
      n_positions: number(2),
      seconds_outside: number(0),
      tick_cumulative_outside: number(0),
      fee_growth_outside: { x: number(0), y: number(0) },
      seconds_per_liquidity_outside: number(0),
      sqrt_price: number(sqrtPriceAx80),
    };

    const upperTick: TickState = {
      prev: number(-10),
      next: number(MAX_TICK),
      liquidity_net: initialLiquidity.multipliedBy(-1),
      n_positions: number(2),
      seconds_outside: number(0),
      tick_cumulative_outside: number(0),
      fee_growth_outside: { x: number(0), y: number(0) },
      seconds_per_liquidity_outside: number(0),
      sqrt_price: number(sqrtPriceBx80),
    };

    storage.ticks.set(lowerTickIndex, lowerTick);
    storage.ticks.set(upperTickIndex, upperTick);

    // Simulating fees
    // Let's say 2 * DECIMALS of each x and y was collected in the range
    // f/L = 2_000_000 / L
    const feeGrowthX = Math2.floor(
      Math2.bitShift(number(2_000_000).dividedBy(initialLiquidity), -128)
    );
    const feeGrowthY = Math2.floor(
      Math2.bitShift(number(2_000_000).dividedBy(initialLiquidity), -128)
    );

    storage.fee_growth = {
      x: feeGrowthX,
      y: feeGrowthY,
    };

    storage.liquidity = initialLiquidity;

    const core = await tezos.deployContract("core", storage);

    const options: UpdatePositionOptions = {
      positionId: 1,
      liquidityDelta: initialLiquidity.multipliedBy(-1), // Remove 100% of liquidity
      toX: accounts.alice.pkh,
      toY: accounts.alice.pkh,
      deadline: NOW + 1000,
      maximumTokensContributed: { x: number(0), y: number(0) },
    };

    // Transfer tokens to core so it can return it back when removing liquidity
    await tezos.sendBatchOp([
      {
        kind: OpKind.TRANSACTION,
        ...tokenX.methodsObject
          .transfer({
            from: accounts.alice.pkh,
            to: core.address,
            value: number(100 * DECIMALS),
          })
          .toTransferParams(),
      },
      {
        kind: OpKind.TRANSACTION,
        ...tokenY.methodsObject
          .transfer([
            {
              from_: accounts.alice.pkh,
              txs: [{ to_: core.address, token_id: 0, amount: number(100 * DECIMALS) }],
            },
          ])
          .toTransferParams(),
      },
    ]);

    // When alice updates a position
    const op = await tezos.sendBatchOp([
      { kind: OpKind.TRANSACTION, ...PositionManager.updatePositionOp(core, options) },
    ]);

    const updatedStorage = await tezos.getStorage(core);
    const tokenXStorage = await tezos.getStorage(tokenX);
    const tokenYStorage = await tezos.getStorage(tokenY);

    const updatedLedger = await updatedStorage.ledger.get(1);
    const updatedPosition = await updatedStorage.positions.get(1);
    const lowerTickState = await updatedStorage.ticks.get(lowerTickIndex);
    const upperTickState = await updatedStorage.ticks.get(upperTickIndex);

    // the storage is updated correctly
    expect(updatedStorage.liquidity).toEqual(number(0));
    expect(lowerTickState.liquidity_net).toEqual(number(0));
    expect(upperTickState.liquidity_net).toEqual(number(0));
    expect(lowerTickState.n_positions).toEqual(number(1));
    expect(upperTickState.n_positions).toEqual(number(1));
    expect(updatedPosition).toEqual(undefined); // Position is removed
    expect(updatedLedger).toEqual(undefined); // Position is removed

    const aliceBalanceX = await tokenXStorage.balances.get(accounts.alice.pkh);
    const aliceBalanceY = await tokenYStorage.ledger.get({ 0: accounts.alice.pkh, 1: 0 });

    // Recalculate to adjust for rounding
    const collectedFeesX = Math2.bitShift(storage.fee_growth.x.multipliedBy(initialLiquidity), 128);
    const collectedFeesY = Math2.bitShift(storage.fee_growth.y.multipliedBy(initialLiquidity), 128);

    const removedAmount = Liquidity.computeAmountFromLiquidity(
      initialLiquidity.multipliedBy(-1),
      sqrtPriceCx80,
      sqrtPriceAx80,
      sqrtPriceBx80
    );

    // Since fees is returned along, alice gets the removed liquidity + fees
    removedAmount.x = removedAmount.x.abs().plus(collectedFeesX);
    removedAmount.y = removedAmount.y.abs().plus(collectedFeesY);

    // Tokens are transferred correctly to alice
    expect(aliceBalanceX.balance).toEqual(removedAmount.x);
    expect(aliceBalanceY).toEqual(removedAmount.y);
  });

  it("fails if deadline is crossed", async () => {
    const core = await tezos.deployContract("core", storage);

    const options: UpdatePositionOptions = {
      positionId: 1,
      liquidityDelta: number(0),
      toX: accounts.alice.pkh,
      toY: accounts.alice.pkh,
      deadline: NOW - 1000, // in the past
      maximumTokensContributed: { x: number(0), y: number(0) },
    };

    // When alice updates a position after deadline is crossed, the txn fails
    await expect(
      tezos.sendBatchOp([
        { kind: OpKind.TRANSACTION, ...PositionManager.updatePositionOp(core, options) },
      ])
    ).rejects.toThrow("103");
  });

  it("fails if the liquidity is attempted to be removed by someone other than owner", async () => {
    const lowerTickIndex = -10;
    const upperTickIndex = 10;

    const position: Position = {
      fee_growth_inside_last: {
        x: number(0),
        y: number(0),
      },
      liquidity: number(1),
      lower_tick_index: number(lowerTickIndex),
      upper_tick_index: number(upperTickIndex),
    };
    storage.ledger.set(1, accounts.bob.pkh);
    storage.positions.set(1, position);

    const core = await tezos.deployContract("core", storage);

    const options: UpdatePositionOptions = {
      positionId: 1,
      liquidityDelta: number(-1),
      toX: accounts.alice.pkh,
      toY: accounts.alice.pkh,
      deadline: NOW + 1000,
      maximumTokensContributed: { x: number(0), y: number(0) },
    };

    // When alice (not owner) tries to remove liquidity, the txn fails
    await expect(
      tezos.sendBatchOp([
        { kind: OpKind.TRANSACTION, ...PositionManager.updatePositionOp(core, options) },
      ])
    ).rejects.toThrow("401");
  });

  it("fails if more than the available liquidity is being removed", async () => {
    const lowerTickIndex = -10;
    const upperTickIndex = 10;

    const position: Position = {
      fee_growth_inside_last: {
        x: number(0),
        y: number(0),
      },
      liquidity: number(1),
      lower_tick_index: number(lowerTickIndex),
      upper_tick_index: number(upperTickIndex),
    };

    storage.ledger.set(1, accounts.alice.pkh);
    storage.positions.set(1, position);

    const core = await tezos.deployContract("core", storage);

    const options: UpdatePositionOptions = {
      positionId: 1,
      liquidityDelta: number(-2), // more than available
      toX: accounts.alice.pkh,
      toY: accounts.alice.pkh,
      deadline: NOW + 1000,
      maximumTokensContributed: { x: number(0), y: number(0) },
    };

    // When alice tries to remove liquidity than available, the txn fails
    await expect(
      tezos.sendBatchOp([
        { kind: OpKind.TRANSACTION, ...PositionManager.updatePositionOp(core, options) },
      ])
    ).rejects.toThrow("111");
  });

  it("fails if the position is invalid", async () => {
    const lowerTickIndex = -10;
    const upperTickIndex = 10;

    const position: Position = {
      fee_growth_inside_last: {
        x: number(0),
        y: number(0),
      },
      liquidity: number(0),
      lower_tick_index: number(lowerTickIndex),
      upper_tick_index: number(upperTickIndex),
    };

    storage.ledger.set(1, accounts.alice.pkh);
    storage.positions.set(1, position);

    const core = await tezos.deployContract("core", storage);

    const options: UpdatePositionOptions = {
      positionId: 2, // does not exist
      liquidityDelta: number(0),
      toX: accounts.alice.pkh,
      toY: accounts.alice.pkh,
      deadline: NOW + 1000,
      maximumTokensContributed: { x: number(0), y: number(0) },
    };

    // When alice tries to update position 2 (not existing), the txn fails
    await expect(
      tezos.sendBatchOp([
        { kind: OpKind.TRANSACTION, ...PositionManager.updatePositionOp(core, options) },
      ])
    ).rejects.toThrow("FA2_TOKEN_UNDEFINED");
  });
});
