import { OpKind } from "@taquito/taquito";
import { StakeManager } from "@plenty-labs/v3-sdk";

import Tezos from "../../tezos";
import { FarmStorage } from "../../types";
import { number } from "../../helpers/math";
import { config } from "../../helpers/config";
import { accounts } from "../../helpers/accounts";
import { getDefaultFarmStorage } from "../../helpers/default";

describe("farm.withdraw", () => {
  let tezos: Tezos;
  let storage: FarmStorage;

  beforeEach(async () => {
    tezos = new Tezos(config.rpcURL);
    await tezos.setSigner(accounts.alice.sk);

    const defaultFarmStorage = getDefaultFarmStorage();

    storage = {
      ...defaultFarmStorage,
    };
  });

  it("withdraws a deposited position", async () => {
    storage.deposits.set(1, {
      owner: accounts.alice.pkh,
      n_stakes: 0,
      tick_range: { 2: -10, 3: 10 },
    });

    const pool = await tezos.deployContract("dummyPool", {});

    storage.cfmm_address = pool.address;

    const farm = await tezos.deployContract("farm", storage);

    // When alice withdraw a position
    await tezos.sendBatchOp([{ kind: OpKind.TRANSACTION, ...StakeManager.withdraw(farm, 1) }]);

    const updatedStorage = await tezos.getStorage(farm);
    const poolStorage = await tezos.getStorage(pool);

    const deposit = await updatedStorage.deposits.get(1);

    expect(deposit).toEqual(undefined);

    // Transfer is called correctly
    expect(poolStorage.transfer_params).toEqual([
      {
        from_: farm.address,
        txs: [{ to_: accounts.alice.pkh, token_id: number(1), amount: number(1) }],
      },
    ]);
  });

  it("fails if the deposit does not exist", async () => {
    storage.deposits.set(1, {
      owner: accounts.alice.pkh,
      n_stakes: 0,
      tick_range: { 2: -10, 3: 10 },
    });

    const pool = await tezos.deployContract("dummyPool", {});

    storage.cfmm_address = pool.address;

    const farm = await tezos.deployContract("farm", storage);

    // When alice withdraws deposit 2, txn fails
    await expect(
      tezos.sendBatchOp([{ kind: OpKind.TRANSACTION, ...StakeManager.withdraw(farm, 2) }])
    ).rejects.toThrow("411");
  });

  it("fails if the deposit has stakes", async () => {
    storage.deposits.set(1, {
      owner: accounts.alice.pkh,
      n_stakes: 1,
      tick_range: { 2: -10, 3: 10 },
    });

    const pool = await tezos.deployContract("dummyPool", {});

    storage.cfmm_address = pool.address;

    const farm = await tezos.deployContract("farm", storage);

    // When alice withdraws deposit that has stakes, txn fails
    await expect(
      tezos.sendBatchOp([{ kind: OpKind.TRANSACTION, ...StakeManager.withdraw(farm, 1) }])
    ).rejects.toThrow("413");
  });

  it("fails if the sender is not the deposit owner", async () => {
    storage.deposits.set(1, {
      owner: accounts.bob.pkh,
      n_stakes: 0,
      tick_range: { 2: -10, 3: 10 },
    });

    const pool = await tezos.deployContract("dummyPool", {});

    storage.cfmm_address = pool.address;

    const farm = await tezos.deployContract("farm", storage);

    // When alice withdraws bob's deposit, txn fails
    await expect(
      tezos.sendBatchOp([{ kind: OpKind.TRANSACTION, ...StakeManager.withdraw(farm, 1) }])
    ).rejects.toThrow("401");
  });
});
