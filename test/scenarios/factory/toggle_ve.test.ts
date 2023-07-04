import { MichelsonMap, OpKind } from "@taquito/taquito";

import Tezos from "../../tezos";
import { number } from "../../helpers/math";
import { config } from "../../helpers/config";
import { accounts } from "../../helpers/accounts";
import { Fa2, Fa12, Token, FactoryStorage } from "../../types";
import { getDefaultFactoryStorage } from "../../helpers/default";

describe("factory.toggle_ve", () => {
  let tezos: Tezos;
  let storage: FactoryStorage;

  beforeEach(async () => {
    tezos = new Tezos(config.rpcURL);
    await tezos.setSigner(accounts.alice.sk);

    const defaultFactoryStorage = getDefaultFactoryStorage();

    storage = {
      ...defaultFactoryStorage,
    };
  });

  it("correctly toggles the ve attachment for a pool", async () => {
    // Doesn't make sense to have bob as a token, but it works for the purpose of this test
    const tokenX: Fa12 = { fa12: accounts.bob.pkh };
    const tokenY: Fa2 = { fa2: { address: accounts.bob.pkh, token_id: number(1) } };

    const pool = await tezos.deployContract("dummyPool", null);

    // Add the pool in storage
    const pools = new MichelsonMap<{ 0: Token; 1: Token; 2: number }, string>();
    pools.set({ 0: tokenX, 1: tokenY, 2: 1 }, pool.address);

    storage.pools = pools;

    const factory = await tezos.deployContract("factory", storage);

    // When alice (the admin) toggle ve for the pool
    await tezos.sendBatchOp([
      {
        kind: OpKind.TRANSACTION,
        ...factory.methodsObject.toggle_ve({ 0: tokenX, 1: tokenY, 2: 1 }).toTransferParams(),
      },
    ]);

    const poolStorage = await tezos.getStorage(pool.address);

    // The pool contract is called correctly
    expect(poolStorage).toEqual(true);
  });

  it("fails if not called by the admin", async () => {
    storage.admin = accounts.bob.pkh; // Change the admin to bob

    // Doesn't make sense to have bob as a token, but it works for the purpose of this test
    const tokenX: Fa12 = { fa12: accounts.bob.pkh };
    const tokenY: Fa2 = { fa2: { address: accounts.bob.pkh, token_id: number(1) } };

    const factory = await tezos.deployContract("factory", storage);

    // When alice (not the admin) calls toggle_ve, txn fails
    await expect(
      tezos.sendBatchOp([
        {
          kind: OpKind.TRANSACTION,
          ...factory.methodsObject.toggle_ve({ 0: tokenX, 1: tokenY, 2: 1 }).toTransferParams(),
        },
      ])
    ).rejects.toThrow("401");
  });

  it("fails if pool does not exist", async () => {
    // Doesn't make sense to have bob as a token, but it works for the purpose of this test
    const tokenX: Fa12 = { fa12: accounts.bob.pkh };
    const tokenY: Fa2 = { fa2: { address: accounts.bob.pkh, token_id: number(1) } };

    const factory = await tezos.deployContract("factory", storage);

    // When alice calls toggle_ve for a non existent pool, txn fails
    await expect(
      tezos.sendBatchOp([
        {
          // pool bps does not exist
          kind: OpKind.TRANSACTION,
          ...factory.methodsObject.toggle_ve({ 0: tokenX, 1: tokenY, 2: 5 }).toTransferParams(),
        },
      ])
    ).rejects.toThrow("402");
  });
});
