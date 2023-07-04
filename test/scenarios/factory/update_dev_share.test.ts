import { OpKind } from "@taquito/taquito";

import Tezos from "../../tezos";
import { number } from "../../helpers/math";
import { FactoryStorage } from "../../types";
import { config } from "../../helpers/config";
import { accounts } from "../../helpers/accounts";
import { getDefaultFactoryStorage } from "../../helpers/default";

describe("factory.update_dev_share", () => {
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

  it("correctly updates the dev share", async () => {
    const factory = await tezos.deployContract("factory", storage);

    // When alice (the admin) changes the dev share
    await tezos.sendBatchOp([
      {
        kind: OpKind.TRANSACTION,
        ...factory.methods
          .update_dev_share(2500) // 2500 bps
          .toTransferParams(),
      },
    ]);

    const factoryStorage = await tezos.getStorage(factory.address);

    // The storage is updated correctly
    expect(factoryStorage.dev_share_bps).toEqual(number(2500));
  });

  it("fails if not called by the admin", async () => {
    storage.admin = accounts.bob.pkh; // Change the admin to bob

    const factory = await tezos.deployContract("factory", storage);

    // When alice (not the admin) changes the dev share, txn fails
    await expect(
      tezos.sendBatchOp([
        {
          kind: OpKind.TRANSACTION,
          ...factory.methods
            .update_dev_share(2500) // 2500 bps
            .toTransferParams(),
        },
      ])
    ).rejects.toThrow("401");
  });

  it("fails if dev share exceeds the max limit", async () => {
    const factory = await tezos.deployContract("factory", storage);

    // When alice  changes the dev share beyond the limit, txn fails
    await expect(
      tezos.sendBatchOp([
        {
          kind: OpKind.TRANSACTION,
          ...factory.methods
            .update_dev_share(4500) // Exceeds the 4000 bps limit
            .toTransferParams(),
        },
      ])
    ).rejects.toThrow("408");
  });
});
