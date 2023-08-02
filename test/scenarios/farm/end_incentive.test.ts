import { DefaultContractType, MichelsonMap, OpKind } from "@taquito/taquito";

import Tezos from "../../tezos";
import { number } from "../../helpers/math";
import { config } from "../../helpers/config";
import { accounts } from "../../helpers/accounts";
import { FarmStorage, FA12Storage, Incentive } from "../../types";
import { DECIMALS, getDefaultFarmStorage } from "../../helpers/default";

describe("farm.end_incentive", () => {
  let tezos: Tezos;
  let storage: FarmStorage;
  let token: DefaultContractType;

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

    // Set initial balance for Alice
    fa12Storage.balances.set(accounts.alice.pkh, {
      balance: number(100 * DECIMALS),
      approvals: new MichelsonMap(),
    });

    // Deploy the token
    token = await tezos.deployContract("fa12", fa12Storage);

    const defaultFarmStorage = getDefaultFarmStorage();

    storage = {
      ...defaultFarmStorage,
    };
  });

  it("correctly ends an incentive and refunds left over reward", async () => {
    const incentives = new MichelsonMap<number, Incentive>();
    incentives.set(1, {
      start_time: NOW - 3000,
      end_time: NOW - 2000,
      claim_deadline: NOW - 1000,
      reward_token: { fa12: token.address },
      total_reward: number(100 * DECIMALS),
      total_reward_unclaimed: number(100 * DECIMALS),
      total_seconds_claimed: number(0),
      n_stakes: 0,
      refundee: accounts.bob.pkh,
    });

    storage.incentives = incentives;

    const farm = await tezos.deployContract("farm", storage);

    // Transfer tokens to farm
    await tezos.sendBatchOp([
      {
        kind: OpKind.TRANSACTION,
        ...token.methodsObject
          .transfer({
            from: accounts.alice.pkh,
            to: farm.address,
            value: number(100 * DECIMALS),
          })
          .toTransferParams(),
      },
    ]);

    // When alice ends an incentive
    await tezos.sendBatchOp([
      {
        kind: OpKind.TRANSACTION,
        ...farm.methodsObject.end_incentive(1).toTransferParams(),
      },
    ]);

    const updatedStorage = await tezos.getStorage(farm);
    const tokenStorage = await tezos.getStorage(token);
    const incentive = await updatedStorage.incentives.get(1);

    // the storage is updated correctly
    expect(incentive).toEqual({
      start_time: new Date((NOW - 3000) * 1000).toISOString(),
      end_time: new Date((NOW - 2000) * 1000).toISOString(),
      claim_deadline: new Date((NOW - 1000) * 1000).toISOString(),
      reward_token: { fa12: token.address },
      total_reward: number(100 * DECIMALS),
      total_reward_unclaimed: number(0),
      total_seconds_claimed: number(0),
      n_stakes: number(0),
      refundee: accounts.bob.pkh,
    });

    // Tokens are transferred to the refundee
    expect((await tokenStorage.balances.get(accounts.bob.pkh)).balance).toEqual(
      number(100 * DECIMALS)
    );
  });

  it("fails when called with invalid id", async () => {
    const incentives = new MichelsonMap<number, Incentive>();
    incentives.set(1, {
      start_time: NOW - 3000,
      end_time: NOW - 2000,
      claim_deadline: NOW - 1000,
      reward_token: { fa12: token.address },
      total_reward: number(100 * DECIMALS),
      total_reward_unclaimed: number(100 * DECIMALS),
      total_seconds_claimed: number(0),
      n_stakes: 0,
      refundee: accounts.bob.pkh,
    });

    storage.incentives = incentives;

    const farm = await tezos.deployContract("farm", storage);

    // When alice ends incentive 2, txn fails
    await expect(
      tezos.sendBatchOp([
        {
          kind: OpKind.TRANSACTION,
          ...farm.methodsObject.end_incentive(2).toTransferParams(),
        },
      ])
    ).rejects.toThrow("411");
  });

  it("fails when not called by the admin", async () => {
    storage.admin = accounts.bob.pkh;

    const incentives = new MichelsonMap<number, Incentive>();
    incentives.set(1, {
      start_time: NOW - 3000,
      end_time: NOW - 2000,
      claim_deadline: NOW - 1000,
      reward_token: { fa12: token.address },
      total_reward: number(100 * DECIMALS),
      total_reward_unclaimed: number(100 * DECIMALS),
      total_seconds_claimed: number(0),
      n_stakes: 0,
      refundee: accounts.bob.pkh,
    });

    storage.incentives = incentives;

    const farm = await tezos.deployContract("farm", storage);

    // When alice (not admin) ends incentive, txn fails
    await expect(
      tezos.sendBatchOp([
        {
          kind: OpKind.TRANSACTION,
          ...farm.methodsObject.end_incentive(1).toTransferParams(),
        },
      ])
    ).rejects.toThrow("401");
  });

  it("fails if deadline has not been reached", async () => {
    const incentives = new MichelsonMap<number, Incentive>();
    incentives.set(1, {
      start_time: NOW - 3000,
      end_time: NOW - 2000,
      claim_deadline: NOW + 1000, // In the future
      reward_token: { fa12: token.address },
      total_reward: number(100 * DECIMALS),
      total_reward_unclaimed: number(100 * DECIMALS),
      total_seconds_claimed: number(0),
      n_stakes: 0,
      refundee: accounts.bob.pkh,
    });

    storage.incentives = incentives;

    const farm = await tezos.deployContract("farm", storage);

    // When alice ends incentive before deadline, txn fails
    await expect(
      tezos.sendBatchOp([
        {
          kind: OpKind.TRANSACTION,
          ...farm.methodsObject.end_incentive(1).toTransferParams(),
        },
      ])
    ).rejects.toThrow("420");
  });
});
