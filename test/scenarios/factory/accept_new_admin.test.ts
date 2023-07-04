import { OpKind } from "@taquito/taquito";

import Tezos from "../../tezos";
import { FactoryStorage } from "../../types";
import { config } from "../../helpers/config";
import { accounts } from "../../helpers/accounts";
import { getDefaultFactoryStorage } from "../../helpers/default";

describe("factory.accept_new_admin", () => {
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
    storage.admin = accounts.bob.pkh;
    storage.proposed_admin = accounts.alice.pkh;

    const factory = await tezos.deployContract("factory", storage);

    // When alice (the proposed admin) calls accept_new_admin
    await tezos.sendBatchOp([
      {
        kind: OpKind.TRANSACTION,
        ...factory.methods.accept_new_admin().toTransferParams(),
      },
    ]);

    const factoryStorage = await tezos.getStorage(factory.address);

    // The storage is updated correctly
    expect(factoryStorage.admin).toEqual(accounts.alice.pkh);
  });

  it("fails if not called by the proposed admin", async () => {
    storage.proposed_admin = accounts.bob.pkh; // Change the proposed admin to bob

    const factory = await tezos.deployContract("factory", storage);

    // When alice (not the proposed admin) calls accept new admin, txn fails
    await expect(
      tezos.sendBatchOp([
        {
          kind: OpKind.TRANSACTION,
          ...factory.methods.accept_new_admin().toTransferParams(),
        },
      ])
    ).rejects.toThrow("401");
  });
});
