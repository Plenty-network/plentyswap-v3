import { Approvals } from "@plenty-labs/v3-sdk";
import { DefaultContractType, MichelsonMap, OpKind } from "@taquito/taquito";

import Tezos from "../../tezos";
import { number } from "../../helpers/math";
import { config } from "../../helpers/config";
import { accounts } from "../../helpers/accounts";
import { FarmStorage, FA12Storage } from "../../types";
import { DECIMALS, getDefaultFarmStorage } from "../../helpers/default";

describe("farm.start_incentive", () => {
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

  it("correctly starts a new incentive", async () => {
    const farm = await tezos.deployContract("farm", storage);

    // When alice starts a new incentive
    await tezos.sendBatchOp([
      {
        kind: OpKind.TRANSACTION,
        ...Approvals.approveFA12(token, { spender: farm.address, value: number(100 * DECIMALS) }),
      },
      {
        kind: OpKind.TRANSACTION,
        ...farm.methodsObject
          .start_incentive({
            start_time: NOW + 1000,
            end_time: NOW + 2000,
            claim_deadline: NOW + 3000,
            reward_token: { fa12: token.address },
            reward_amount: number(100 * DECIMALS),
            refundee: accounts.alice.pkh,
          })
          .toTransferParams(),
      },
    ]);

    const updatedStorage = await tezos.getStorage(farm);
    const tokenStorage = await tezos.getStorage(token);
    const incentive = await updatedStorage.incentives.get(1);

    // the storage is updated correctly
    expect(incentive).toEqual({
      start_time: new Date((NOW + 1000) * 1000).toISOString(),
      end_time: new Date((NOW + 2000) * 1000).toISOString(),
      claim_deadline: new Date((NOW + 3000) * 1000).toISOString(),
      reward_token: { fa12: token.address },
      total_reward: number(100 * DECIMALS),
      total_reward_unclaimed: number(100 * DECIMALS),
      total_seconds_claimed: number(0),
      n_stakes: number(0),
      refundee: accounts.alice.pkh,
    });
    expect(updatedStorage.last_incentive_id).toEqual(number(1));

    // Tokens are transferred to the farm
    expect((await tokenStorage.balances.get(farm.address)).balance).toEqual(number(100 * DECIMALS));
  });

  it("fails if not called by the admin", async () => {
    storage.admin = accounts.bob.pkh; // change the admin to bob

    const farm = await tezos.deployContract("farm", storage);

    // When alice (not admin) starts a new incentive, the txn fails
    await expect(
      tezos.sendBatchOp([
        {
          kind: OpKind.TRANSACTION,
          ...Approvals.approveFA12(token, { spender: farm.address, value: number(100 * DECIMALS) }),
        },
        {
          kind: OpKind.TRANSACTION,
          ...farm.methodsObject
            .start_incentive({
              start_time: NOW + 1000,
              end_time: NOW + 2000,
              claim_deadline: NOW + 3000,
              reward_token: { fa12: token.address },
              reward_amount: number(100 * DECIMALS),
              refundee: accounts.alice.pkh,
            })
            .toTransferParams(),
        },
      ])
    ).rejects.toThrow("401");
  });

  it("fails if the invalid time period is provided", async () => {
    const farm = await tezos.deployContract("farm", storage);

    // When alice starts a new incentive with end time <= start time, the txn fails
    await expect(
      tezos.sendBatchOp([
        {
          kind: OpKind.TRANSACTION,
          ...Approvals.approveFA12(token, { spender: farm.address, value: number(100 * DECIMALS) }),
        },
        {
          kind: OpKind.TRANSACTION,
          ...farm.methodsObject
            .start_incentive({
              start_time: NOW + 1000,
              end_time: NOW + 1000, // invalid
              claim_deadline: NOW + 3000,
              reward_token: { fa12: token.address },
              reward_amount: number(100 * DECIMALS),
              refundee: accounts.alice.pkh,
            })
            .toTransferParams(),
        },
      ])
    ).rejects.toThrow("414");

    // When alice starts a new incentive with starting is the past, the txn fails
    await expect(
      tezos.sendBatchOp([
        {
          kind: OpKind.TRANSACTION,
          ...Approvals.approveFA12(token, { spender: farm.address, value: number(100 * DECIMALS) }),
        },
        {
          kind: OpKind.TRANSACTION,
          ...farm.methodsObject
            .start_incentive({
              start_time: NOW - 1000, // invalid
              end_time: NOW + 1000,
              claim_deadline: NOW + 3000,
              reward_token: { fa12: token.address },
              reward_amount: number(100 * DECIMALS),
              refundee: accounts.alice.pkh,
            })
            .toTransferParams(),
        },
      ])
    ).rejects.toThrow("414");
  });

  it("fails if the cliam deadline is in the past", async () => {
    const farm = await tezos.deployContract("farm", storage);

    // When alice starts a new incentive with claim deadline < end, txn fails
    await expect(
      tezos.sendBatchOp([
        {
          kind: OpKind.TRANSACTION,
          ...Approvals.approveFA12(token, { spender: farm.address, value: number(100 * DECIMALS) }),
        },
        {
          kind: OpKind.TRANSACTION,
          ...farm.methodsObject
            .start_incentive({
              start_time: NOW + 1000,
              end_time: NOW + 2000,
              claim_deadline: NOW + 1500, // invalid
              reward_token: { fa12: token.address },
              reward_amount: number(100 * DECIMALS),
              refundee: accounts.alice.pkh,
            })
            .toTransferParams(),
        },
      ])
    ).rejects.toThrow("415");
  });
});
