import { OpKind } from "@taquito/taquito";

import Tezos from "../../tezos";
import { FactoryStorage } from "../../types";
import { config } from "../../helpers/config";
import { accounts } from "../../helpers/accounts";
import { getDefaultFactoryStorage } from "../../helpers/default";

describe("factory.propose_new_admin", () => {
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

  it("correctly proposes a new admin", async () => {
    const factory = await tezos.deployContract("factory", storage);

    // When alice (the admin) proposes a new admin
    await tezos.sendBatchOp([
      {
        kind: OpKind.TRANSACTION,
        ...factory.methods.propose_new_admin(accounts.bob.pkh).toTransferParams(),
      },
    ]);

    const factoryStorage = await tezos.getStorage(factory.address);

    // The storage is updated correctly
    expect(factoryStorage.proposed_admin).toEqual(accounts.bob.pkh);
  });

  it("fails if not called by the admin", async () => {
    storage.admin = accounts.bob.pkh; // Change the admin to bob

    const factory = await tezos.deployContract("factory", storage);

    // When alice (not the admin) changes the voter address, txn fails
    await expect(
      tezos.sendBatchOp([
        {
          kind: OpKind.TRANSACTION,
          ...factory.methods.propose_new_admin(accounts.bob.pkh).toTransferParams(),
        },
      ])
    ).rejects.toThrow("401");
  });
});
