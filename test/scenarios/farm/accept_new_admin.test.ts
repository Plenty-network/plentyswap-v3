import { OpKind } from "@taquito/taquito";

import Tezos from "../../tezos";
import { FarmStorage } from "../../types";
import { config } from "../../helpers/config";
import { accounts } from "../../helpers/accounts";
import { getDefaultFarmStorage } from "../../helpers/default";

describe("farm.accept_new_admin", () => {
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

  it("correctly proposes a new admin", async () => {
    storage.admin = accounts.bob.pkh;
    storage.proposed_admin = accounts.alice.pkh;

    const farm = await tezos.deployContract("farm", storage);

    // When alice (the proposed admin) calls accept_new_admin
    await tezos.sendBatchOp([
      {
        kind: OpKind.TRANSACTION,
        ...farm.methods.accept_new_admin().toTransferParams(),
      },
    ]);

    const farmStorage = await tezos.getStorage(farm.address);

    // The storage is updated correctly
    expect(farmStorage.admin).toEqual(accounts.alice.pkh);
  });

  it("fails if not called by the proposed admin", async () => {
    storage.proposed_admin = accounts.bob.pkh; // Change the proposed admin to bob

    const farm = await tezos.deployContract("farm", storage);

    // When alice (not the proposed admin) calls accept new admin, txn fails
    await expect(
      tezos.sendBatchOp([
        {
          kind: OpKind.TRANSACTION,
          ...farm.methods.accept_new_admin().toTransferParams(),
        },
      ])
    ).rejects.toThrow("401");
  });
});
