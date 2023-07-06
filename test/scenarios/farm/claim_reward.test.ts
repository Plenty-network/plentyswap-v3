import BigNumber from "bignumber.js";
import { DefaultContractType, MichelsonMap, OpKind } from "@taquito/taquito";

import Tezos from "../../tezos";
import { number } from "../../helpers/math";
import { config } from "../../helpers/config";
import { accounts } from "../../helpers/accounts";
import { DECIMALS, getDefaultFarmStorage } from "../../helpers/default";
import { FA12Storage, Token, FA2Storage, FarmStorage } from "../../types";

describe("farm.claim_reward", () => {
  let tezos: Tezos;
  let storage: FarmStorage;
  let tokenX: DefaultContractType;
  let tokenY: DefaultContractType;

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

    const defaultFarmStorage = getDefaultFarmStorage();

    const rewards = new MichelsonMap<{ 0: Token; 1: string }, BigNumber>();
    rewards.set({ 0: { fa12: tokenX.address }, 1: accounts.alice.pkh }, number(50 * DECIMALS));
    rewards.set(
      { 0: { fa2: { address: tokenY.address, token_id: number(0) } }, 1: accounts.alice.pkh },
      number(50 * DECIMALS)
    );

    storage = {
      ...defaultFarmStorage,
      rewards,
    };
  });

  it("claims all token rewards", async () => {
    const farm = await tezos.deployContract("farm", storage);

    // Transfer tokens to farm
    await tezos.sendBatchOp([
      {
        kind: OpKind.TRANSACTION,
        ...tokenX.methodsObject
          .transfer({
            from: accounts.alice.pkh,
            to: farm.address,
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
              txs: [{ to_: farm.address, token_id: 0, amount: number(100 * DECIMALS) }],
            },
          ])
          .toTransferParams(),
      },
    ]);

    // When alice claims her reward
    await tezos.sendBatchOp([
      {
        kind: OpKind.TRANSACTION,
        ...farm.methodsObject
          .claim_reward([
            { fa12: tokenX.address },
            { fa2: { address: tokenY.address, token_id: number(0) } },
          ])
          .toTransferParams(),
      },
    ]);

    const updatedStorage = await tezos.getStorage(farm);
    const tokenXStorage = await tezos.getStorage(tokenX);
    const tokenYStorage = await tezos.getStorage(tokenY);

    const rewardX = await updatedStorage.rewards.get({
      0: { fa12: tokenX.address },
      1: accounts.alice.pkh,
    });
    const rewardY = await updatedStorage.rewards.get({
      0: {
        fa2: { address: tokenY.address, token_id: number(0) },
      },
      1: accounts.alice.pkh,
    });

    expect(rewardX).toEqual(undefined);
    expect(rewardY).toEqual(undefined);

    // Tokens are transferred to alice
    expect((await tokenXStorage.balances.get(accounts.alice.pkh)).balance).toEqual(
      number(50 * DECIMALS)
    );
    expect(await tokenYStorage.ledger.get({ 0: accounts.alice.pkh, 1: 0 })).toEqual(
      number(50 * DECIMALS)
    );
  });

  it("skips all zero and unavailable rewards", async () => {
    const rewards = new MichelsonMap<{ 0: Token; 1: string }, BigNumber>();

    // We set the token to an invalid contract to prove that the call is never made
    rewards.set({ 0: { fa12: accounts.alice.pkh }, 1: accounts.alice.pkh }, number(0)); // zero reward

    storage.rewards = rewards;

    const farm = await tezos.deployContract("farm", storage);

    // When alice claims her reward, no errors are raised
    await tezos.sendBatchOp([
      {
        kind: OpKind.TRANSACTION,
        ...farm.methodsObject
          .claim_reward([
            { fa12: accounts.alice.pkh }, // zero
            { fa2: { address: accounts.bob.pkh, token_id: number(0) } }, // Does not exist in map
          ])
          .toTransferParams(),
      },
    ]);

    // Reached only if the above txn passes
    expect(true);
  });
});
