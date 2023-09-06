import { MichelsonMap, OpKind } from "@taquito/taquito";

import Tezos from "../../tezos";
import { number } from "../../helpers/math";
import { config } from "../../helpers/config";
import { accounts } from "../../helpers/accounts";
import { Fa2, Fa12, Token, FactoryStorage } from "../../types";
import { getDefaultFactoryStorage } from "../../helpers/default";

describe("factory.pause_pool", () => {
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

  it("correctly pauses functionalities in a pool", async () => {
    // Doesn't make sense to have bob as a token, but it works for the purpose of this test
    const tokenX: Fa12 = { fa12: accounts.bob.pkh };
    const tokenY: Fa2 = { fa2: { address: accounts.bob.pkh, token_id: number(1) } };

    const pool = await tezos.deployContract("dummyPool", { ve: false });

    // Add the pool in storage
    const pools = new MichelsonMap<{ 0: Token; 1: Token; 2: number }, string>();
    pools.set({ 0: tokenX, 1: tokenY, 2: 1 }, pool.address);

    storage.pools = pools;

    const factory = await tezos.deployContract("factory", storage);

    // When alice (the admin) pauses a pool
    await tezos.sendBatchOp([
      {
        kind: OpKind.TRANSACTION,
        ...factory.methodsObject
          .pause_pool({
            pool_key: { 0: tokenX, 1: tokenY, 2: 1 },
            paused_value: { swap: true, add_liquidity: false, remove_liquidity: true },
          })
          .toTransferParams(),
      },
    ]);

    const poolStorage = await tezos.getStorage(pool.address);

    // The pool contract is called correctly
    expect(poolStorage.paused).toEqual({
      swap: true,
      add_liquidity: false,
      remove_liquidity: true,
    });
  });

  it("fails if not called by the admin", async () => {
    storage.admin = accounts.bob.pkh; // Change the admin to bob

    // Doesn't make sense to have bob as a token, but it works for the purpose of this test
    const tokenX: Fa12 = { fa12: accounts.bob.pkh };
    const tokenY: Fa2 = { fa2: { address: accounts.bob.pkh, token_id: number(1) } };

    const factory = await tezos.deployContract("factory", storage);

    // When alice (not the admin) calls pause_pool, txn fails
    await expect(
      tezos.sendBatchOp([
        {
          kind: OpKind.TRANSACTION,
          ...factory.methodsObject
            .pause_pool({
              pool_key: { 0: tokenX, 1: tokenY, 2: 1 },
              paused_value: { swap: true, add_liquidity: false, remove_liquidity: true },
            })
            .toTransferParams(),
        },
      ])
    ).rejects.toThrow("401");
  });

  it("fails if pool does not exist", async () => {
    // Doesn't make sense to have bob as a token, but it works for the purpose of this test
    const tokenX: Fa12 = { fa12: accounts.bob.pkh };
    const tokenY: Fa2 = { fa2: { address: accounts.bob.pkh, token_id: number(1) } };

    const factory = await tezos.deployContract("factory", storage);

    // When alice calls pause_pool for a non existent pool, txn fails
    await expect(
      tezos.sendBatchOp([
        {
          // pool with this bps does not exist
          kind: OpKind.TRANSACTION,
          ...factory.methodsObject
            .pause_pool({
              pool_key: { 0: tokenX, 1: tokenY, 2: 1 },
              paused_value: { swap: true, add_liquidity: false, remove_liquidity: true },
            })
            .toTransferParams(),
        },
      ])
    ).rejects.toThrow("402");
  });
});
