import { OpKind } from "@taquito/taquito";
import { Math2, Stake, StakeManager, UnstakeOptions } from "@plenty-labs/v3-sdk";

import Tezos from "../../tezos";
import { number } from "../../helpers/math";
import { config } from "../../helpers/config";
import { accounts } from "../../helpers/accounts";
import { Incentive, FarmStorage, Position, PositionInfo } from "../../types";
import { DECIMALS, getDefaultFarmStorage } from "../../helpers/default";

describe("farm.unstake", () => {
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

  it("correctly unstakes and records the reward before incentive is over", async () => {
    // Arbitrary values for testing the farm logic
    const position: PositionInfo = {
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
    storage.rewards.set(
      {
        0: { fa12: accounts.bob.pkh },
        1: accounts.alice.pkh,
      },
      number(2 * DECIMALS)
    );

    const core = await tezos.deployContract("dummyPool", {
      position,
      cumulatives_inside_snapshot: cumulativesSnapshot,
    });

    storage.cfmm_address = core.address;

    const farm = await tezos.deployContract("farm", storage);

    const options: UnstakeOptions = { incentiveId: 1, tokenId: 1 };

    // When alice unstakes a position
    await tezos.sendBatchOp([{ kind: OpKind.TRANSACTION, ...StakeManager.unstake(farm, options) }]);

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
    expect(updatedStake).toEqual(undefined);
    expect(deposit).toEqual({
      owner: accounts.alice.pkh,
      n_stakes: number(0),
      tick_range: { 2: number(-10), 3: number(10) },
    });
    expect(reward).toEqual(estimatedReward.plus(2 * DECIMALS)); // Existing reward gets added up
    expect(updatedIncentive.total_reward_unclaimed).toEqual(
      number(100 * DECIMALS).minus(estimatedReward)
    );
    expect(updatedIncentive.total_seconds_claimed).toEqual(estimatedSecondsClaimed);
    expect(updatedIncentive.n_stakes).toEqual(number(0));
  });

  it("correctly unstakes and records the reward after incentive is over", async () => {
    // Arbitrary values for testing the farm logic
    const position: PositionInfo = {
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
      end_time: NOW - 100, // Incentive is over in the past
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

    const options: UnstakeOptions = { incentiveId: 1, tokenId: 1 };

    // When alice unstakes a position
    await tezos.sendBatchOp([{ kind: OpKind.TRANSACTION, ...StakeManager.unstake(farm, options) }]);

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
    expect(updatedStake).toEqual(undefined);
    expect(deposit).toEqual({
      owner: accounts.alice.pkh,
      n_stakes: number(0),
      tick_range: { 2: number(-10), 3: number(10) },
    });
    expect(reward).toEqual(estimatedReward);
    expect(updatedIncentive.total_reward_unclaimed).toEqual(
      number(100 * DECIMALS).minus(estimatedReward)
    );
    expect(updatedIncentive.total_seconds_claimed).toEqual(estimatedSecondsClaimed);
    expect(updatedIncentive.n_stakes).toEqual(number(0));
  });

  it("fails for invalid incentive", async () => {
    const incentive: Incentive = {
      reward_token: { fa12: accounts.bob.pkh },
      start_time: NOW - 1000,
      end_time: NOW - 100, // Incentive is over in the past
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

    const farm = await tezos.deployContract("farm", storage);

    const options: UnstakeOptions = { incentiveId: 2, tokenId: 1 };

    // When alice unstakes a position for incentive id 2, txn fails
    await expect(
      tezos.sendBatchOp([{ kind: OpKind.TRANSACTION, ...StakeManager.unstake(farm, options) }])
    ).rejects.toThrow("411");
  });

  it("fails for invalid deposit", async () => {
    const incentive: Incentive = {
      reward_token: { fa12: accounts.bob.pkh },
      start_time: NOW - 1000,
      end_time: NOW - 100, // Incentive is over in the past
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

    const farm = await tezos.deployContract("farm", storage);

    const options: UnstakeOptions = { incentiveId: 1, tokenId: 2 };

    // When alice unstakes a position for deposit of token id 2, txn fails
    await expect(
      tezos.sendBatchOp([{ kind: OpKind.TRANSACTION, ...StakeManager.unstake(farm, options) }])
    ).rejects.toThrow("415");
  });

  it("fails for invalid stake", async () => {
    const incentive: Incentive = {
      reward_token: { fa12: accounts.bob.pkh },
      start_time: NOW - 1000,
      end_time: NOW - 100, // Incentive is over in the past
      claim_deadline: NOW + 2000,
      total_reward: number(100 * DECIMALS),
      total_reward_unclaimed: number(100 * DECIMALS),
      total_seconds_claimed: number(0),
      n_stakes: 1,
      refundee: accounts.alice.pkh,
    };

    storage.incentives.set(1, incentive);
    storage.deposits.set(1, {
      owner: accounts.alice.pkh,
      n_stakes: 1,
      tick_range: { 2: -10, 3: 10 },
    });

    const farm = await tezos.deployContract("farm", storage);

    const options: UnstakeOptions = { incentiveId: 1, tokenId: 1 };

    // When alice unstakes a position for stake on incentive 1 with token 1, txn fails
    await expect(
      tezos.sendBatchOp([{ kind: OpKind.TRANSACTION, ...StakeManager.unstake(farm, options) }])
    ).rejects.toThrow("416");
  });

  it("fails when not called by owner", async () => {
    const incentive: Incentive = {
      reward_token: { fa12: accounts.bob.pkh },
      start_time: NOW - 1000,
      end_time: NOW - 100, // Incentive is over in the past
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
      owner: accounts.bob.pkh, // change owner
      n_stakes: 1,
      tick_range: { 2: -10, 3: 10 },
    });

    const farm = await tezos.deployContract("farm", storage);

    const options: UnstakeOptions = { incentiveId: 1, tokenId: 1 };

    // When alice unstakes a position for bob, the txn fails
    await expect(
      tezos.sendBatchOp([{ kind: OpKind.TRANSACTION, ...StakeManager.unstake(farm, options) }])
    ).rejects.toThrow("401");
  });
});
