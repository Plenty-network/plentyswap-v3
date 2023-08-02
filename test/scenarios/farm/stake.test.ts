import { OpKind } from "@taquito/taquito";
import { Math2, Stake, StakeManager, StakeOptions } from "@plenty-labs/v3-sdk";

import Tezos from "../../tezos";
import { number } from "../../helpers/math";
import { config } from "../../helpers/config";
import { accounts } from "../../helpers/accounts";
import { Incentive, FarmStorage, Position } from "../../types";
import { DECIMALS, getDefaultFarmStorage } from "../../helpers/default";

describe("farm.stake", () => {
  let tezos: Tezos;
  let storage: FarmStorage;

  const NOW = Math.floor(new Date().getTime() / 1000);

  beforeEach(async () => {
    tezos = new Tezos(config.rpcURL);
    await tezos.setSigner(accounts.alice.sk);

    const defaultFarmStorage = getDefaultFarmStorage();

    storage = {
      ...defaultFarmStorage,
    };
  });

  it("correctly mints a fresh position", async () => {
    // Arbitrary values for testing the farm logic
    const position: Position = {
      fee_growth_inside_last: {
        x: number(0),
        y: number(0),
      },
      liquidity: number(100),
      lower_tick_index: number(-10),
      upper_tick_index: number(10),
      owner: accounts.alice.pkh,
    };
    const cumulativesSnapshot = {
      tick_cumulative_inside: number(0),
      seconds_per_liquidity_inside: number(50),
      seconds_inside: number(0),
    };
    const incentive: Incentive = {
      reward_token: { fa12: accounts.bob.pkh },
      start_time: NOW - 1000,
      end_time: NOW + 1000,
      claim_deadline: NOW + 2000,
      total_reward: number(100 * DECIMALS),
      total_reward_unclaimed: number(100 * DECIMALS),
      total_seconds_claimed: number(0),
      n_stakes: 0,
      refundee: accounts.alice.pkh,
    };

    storage.incentives.set(1, incentive);

    const core = await tezos.deployContract("dummyPool", {
      position,
      cumulatives_inside_snapshot: cumulativesSnapshot,
    });

    storage.cfmm_address = core.address;

    const farm = await tezos.deployContract("farm", storage);

    const options: StakeOptions = { incentiveId: 1, tokenId: 1 };

    // When alice stakes a position
    await tezos.sendBatchOp([{ kind: OpKind.TRANSACTION, ...StakeManager.stake(farm, options) }]);

    // // block timestamp
    // const timestamp = dateToTimestamp(
    //   (await axios.get(`${config.rpcURL}/chains/main/blocks/${op.includedInBlock}`)).data.header
    //     .timestamp
    // );

    const updatedStorage = await tezos.getStorage(farm);
    const poolStorage = await tezos.getStorage(core.address);

    const stake = await updatedStorage.stakes.get({ 0: 1, 1: 1 });
    const deposit = await updatedStorage.deposits.get(1);
    const updatedIncentive = await updatedStorage.incentives.get(1);

    // the storage is updated correctly
    expect(stake).toEqual({
      seconds_per_liquidity_inside_last: cumulativesSnapshot.seconds_per_liquidity_inside,
      liquidity: number(100),
    });
    expect(deposit).toEqual({
      owner: accounts.alice.pkh,
      n_stakes: number(1),
      tick_range: { 2: number(-10), 3: number(10) },
    });
    expect(updatedIncentive.n_stakes).toEqual(number(1));

    // Transfer is called correctly
    expect(poolStorage.transfer_params).toEqual([
      {
        from_: accounts.alice.pkh,
        txs: [{ to_: farm.address, token_id: number(1), amount: number(1) }],
      },
    ]);
  });

  it("correctly updates an existing stake and records the reward before incentive is over", async () => {
    // Arbitrary values for testing the farm logic
    const position: Position = {
      fee_growth_inside_last: {
        x: number(0),
        y: number(0),
      },
      liquidity: number(150),
      lower_tick_index: number(-10),
      upper_tick_index: number(10),
      owner: accounts.alice.pkh,
    };
    const cumulativesSnapshot = {
      tick_cumulative_inside: number(0),
      seconds_per_liquidity_inside: Math2.bitShift(number(50), -128)
        .dividedBy(number(100))
        .decimalPlaces(0),
      seconds_inside: number(0),
    };
    const incentive: Incentive = {
      reward_token: { fa12: accounts.bob.pkh },
      start_time: NOW - 1000,
      end_time: NOW + 1000,
      claim_deadline: NOW + 2000,
      total_reward: number(100 * DECIMALS),
      total_reward_unclaimed: number(100 * DECIMALS),
      total_seconds_claimed: number(0),
      n_stakes: 1,
      refundee: accounts.alice.pkh,
    };

    storage.incentives.set(1, incentive);
    storage.stakes.set(
      { 0: 1, 1: 1 },
      {
        seconds_per_liquidity_inside_last: Math2.bitShift(number(10), -128)
          .dividedBy(number(100))
          .decimalPlaces(0),
        liquidity: number(100),
      }
    );
    storage.deposits.set(1, {
      owner: accounts.alice.pkh,
      n_stakes: 1,
      tick_range: { 2: -10, 3: 10 },
    });

    const core = await tezos.deployContract("dummyPool", {
      position,
      cumulatives_inside_snapshot: cumulativesSnapshot,
    });

    storage.cfmm_address = core.address;

    const farm = await tezos.deployContract("farm", storage);

    const options: StakeOptions = { incentiveId: 1, tokenId: 1 };

    // When alice stakes a position
    await tezos.sendBatchOp([{ kind: OpKind.TRANSACTION, ...StakeManager.stake(farm, options) }]);

    const updatedStorage = await tezos.getStorage(farm);

    const updatedStake = await updatedStorage.stakes.get({ 0: 1, 1: 1 });
    const deposit = await updatedStorage.deposits.get(1);
    const updatedIncentive = await updatedStorage.incentives.get(1);
    const reward = await updatedStorage.rewards.get({
      0: { fa12: accounts.bob.pkh },
      1: accounts.alice.pkh,
    });

    const stake = new Stake(
      {
        startTime: incentive.start_time,
        endTime: incentive.end_time,
        totalRewardUnclaimed: incentive.total_reward_unclaimed,
        totalSecondsClaimed: incentive.total_seconds_claimed,
      },
      number(100),
      Math2.bitShift(number(10), -128).dividedBy(number(100)).decimalPlaces(0)
    );
    const estimatedReward = stake.computeUnclaimedReward(
      Math2.bitShift(number(50), -128).dividedBy(number(100)).decimalPlaces(0)
    );

    const estimatedSecondsClaimed = cumulativesSnapshot.seconds_per_liquidity_inside
      .minus(Math2.bitShift(number(10), -128).dividedBy(number(100)).decimalPlaces(0))
      .multipliedBy(number(100));

    // the storage is updated correctly
    expect(updatedStake).toEqual({
      seconds_per_liquidity_inside_last: cumulativesSnapshot.seconds_per_liquidity_inside,
      liquidity: number(150),
    });
    // Stays the same
    expect(deposit).toEqual({
      owner: accounts.alice.pkh,
      n_stakes: number(1),
      tick_range: { 2: number(-10), 3: number(10) },
    });
    expect(reward).toEqual(estimatedReward);
    expect(updatedIncentive.total_reward_unclaimed).toEqual(
      number(100 * DECIMALS).minus(estimatedReward)
    );
    expect(updatedIncentive.total_seconds_claimed).toEqual(estimatedSecondsClaimed);
  });

  it("fails if invalid incentive id is used", async () => {
    const farm = await tezos.deployContract("farm", storage);

    const options: StakeOptions = { incentiveId: 1, tokenId: 1 }; // Invalid incentive

    // When alice stakes for invalid incentive id, txn fails
    await expect(
      tezos.sendBatchOp([{ kind: OpKind.TRANSACTION, ...StakeManager.stake(farm, options) }])
    ).rejects.toThrow("411");
  });

  it("fails if not called by owner of the position", async () => {
    // Arbitrary values for testing the farm logic
    const position: Position = {
      fee_growth_inside_last: {
        x: number(0),
        y: number(0),
      },
      liquidity: number(150),
      lower_tick_index: number(-10),
      upper_tick_index: number(10),
      owner: accounts.bob.pkh, // bob is the owner
    };
    const cumulativesSnapshot = {
      tick_cumulative_inside: number(0),
      seconds_per_liquidity_inside: Math2.bitShift(number(50), -128)
        .dividedBy(number(100))
        .decimalPlaces(0),
      seconds_inside: number(0),
    };
    const incentive: Incentive = {
      reward_token: { fa12: accounts.bob.pkh },
      start_time: NOW - 1000,
      end_time: NOW + 1000,
      claim_deadline: NOW + 2000,
      total_reward: number(100 * DECIMALS),
      total_reward_unclaimed: number(100 * DECIMALS),
      total_seconds_claimed: number(0),
      n_stakes: 1,
      refundee: accounts.alice.pkh,
    };

    storage.incentives.set(1, incentive);
    storage.stakes.set(
      { 0: 1, 1: 1 },
      {
        seconds_per_liquidity_inside_last: Math2.bitShift(number(10), -128)
          .dividedBy(number(100))
          .decimalPlaces(0),
        liquidity: number(100),
      }
    );
    storage.deposits.set(1, {
      owner: accounts.alice.pkh,
      n_stakes: 1,
      tick_range: { 2: -10, 3: 10 },
    });

    const core = await tezos.deployContract("dummyPool", {
      position,
      cumulatives_inside_snapshot: cumulativesSnapshot,
    });

    storage.cfmm_address = core.address;

    const farm = await tezos.deployContract("farm", storage);

    const options: StakeOptions = { incentiveId: 1, tokenId: 1 };

    // When alice tries to stake for bob, txn fails
    await expect(
      tezos.sendBatchOp([{ kind: OpKind.TRANSACTION, ...StakeManager.stake(farm, options) }])
    ).rejects.toThrow("401");
  });

  it("fails if incentive is over", async () => {
    // Arbitrary values for testing the farm logic
    const position: Position = {
      fee_growth_inside_last: {
        x: number(0),
        y: number(0),
      },
      liquidity: number(150),
      lower_tick_index: number(-10),
      upper_tick_index: number(10),
      owner: accounts.alice.pkh,
    };
    const cumulativesSnapshot = {
      tick_cumulative_inside: number(0),
      seconds_per_liquidity_inside: Math2.bitShift(number(50), -128)
        .dividedBy(number(100))
        .decimalPlaces(0),
      seconds_inside: number(0),
    };
    const incentive: Incentive = {
      reward_token: { fa12: accounts.bob.pkh },
      start_time: NOW - 1000,
      end_time: NOW - 100,
      claim_deadline: NOW + 2000,
      total_reward: number(100 * DECIMALS),
      total_reward_unclaimed: number(100 * DECIMALS),
      total_seconds_claimed: number(0),
      n_stakes: 1,
      refundee: accounts.alice.pkh,
    };

    storage.incentives.set(1, incentive);
    storage.stakes.set(
      { 0: 1, 1: 1 },
      {
        seconds_per_liquidity_inside_last: Math2.bitShift(number(10), -128)
          .dividedBy(number(100))
          .decimalPlaces(0),
        liquidity: number(100),
      }
    );
    storage.deposits.set(1, {
      owner: accounts.alice.pkh,
      n_stakes: 1,
      tick_range: { 2: -10, 3: 10 },
    });

    const core = await tezos.deployContract("dummyPool", {
      position,
      cumulatives_inside_snapshot: cumulativesSnapshot,
    });

    storage.cfmm_address = core.address;

    const farm = await tezos.deployContract("farm", storage);

    const options: StakeOptions = { incentiveId: 1, tokenId: 1 };

    // When alice tries to stake on ended incentive
    await expect(
      tezos.sendBatchOp([{ kind: OpKind.TRANSACTION, ...StakeManager.stake(farm, options) }])
    ).rejects.toThrow("412");
  });

  // This test is a valid check for all EPs since tez rejection is placed before paramater
  // pattern match starts
  it("fails if tez is sent to the EP", async () => {
    const farm = await tezos.deployContract("farm", storage);

    const options: StakeOptions = { incentiveId: 1, tokenId: 1 };

    // When alice send tez to the EP, txn fails
    await expect(
      tezos.sendBatchOp([
        {
          kind: OpKind.TRANSACTION,
          ...farm.methodsObject
            .stake({
              0: options.tokenId,
              1: options.incentiveId,
            })
            .toTransferParams({ amount: 1 }),
        },
      ])
    ).rejects.toThrow("410");
  });
});
