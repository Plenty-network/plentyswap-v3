import { OpKind } from "@taquito/taquito";

import Tezos from "../../tezos";
import { FarmStorage } from "../../types";
import { config } from "../../helpers/config";
import { accounts } from "../../helpers/accounts";
import { getDefaultFarmStorage } from "../../helpers/default";

describe("farm.propose_new_admin", () => {
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
    const farm = await tezos.deployContract("farm", storage);

    // When alice (the admin) proposes a new admin
    await tezos.sendBatchOp([
      {
        kind: OpKind.TRANSACTION,
        ...farm.methods.propose_new_admin(accounts.bob.pkh).toTransferParams(),
      },
    ]);

    const farmStorage = await tezos.getStorage(farm.address);

    // The storage is updated correctly
    expect(farmStorage.proposed_admin).toEqual(accounts.bob.pkh);
  });

  it("fails if not called by the admin", async () => {
    storage.admin = accounts.bob.pkh; // Change the admin to bob

    const farm = await tezos.deployContract("farm", storage);

    // When alice (not the admin) changes the voter address, txn fails
    await expect(
      tezos.sendBatchOp([
        {
          kind: OpKind.TRANSACTION,
          ...farm.methods.propose_new_admin(accounts.bob.pkh).toTransferParams(),
        },
      ])
    ).rejects.toThrow("401");
  });
});
