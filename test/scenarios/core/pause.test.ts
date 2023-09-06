import { OpKind } from "@taquito/taquito";

import Tezos from "../../tezos";
import { CoreStorage } from "../../types";
import { config } from "../../helpers/config";
import { accounts } from "../../helpers/accounts";
import { getDefaultCoreStorage } from "../../helpers/default";

describe("core.pause", () => {
  let tezos: Tezos;
  let storage: CoreStorage;

  beforeEach(async () => {
    tezos = new Tezos(config.rpcURL);
    await tezos.setSigner(accounts.alice.sk);

    const defaultCoreStorage = getDefaultCoreStorage();

    storage = {
      ...defaultCoreStorage,
      constants: { ...defaultCoreStorage.constants, factory: accounts.alice.pkh },
    };
  });

  it("sets the paused functionalities correctly", async () => {
    const core = await tezos.deployContract("core", storage);

    // When alice calls pause
    await tezos.sendBatchOp([
      {
        kind: OpKind.TRANSACTION,
        ...core.methodsObject
          .pause({ swap: true, add_liquidity: false, remove_liquidity: true })
          .toTransferParams(),
      },
    ]);

    // Storage is updated correctly
    let updatedStorage = await tezos.getStorage(core);

    expect(updatedStorage.paused).toEqual({
      swap: true,
      add_liquidity: false,
      remove_liquidity: true,
    });
  });

  it("fails if not called by the factory", async () => {
    storage.constants.factory = accounts.bob.pkh;

    const core = await tezos.deployContract("core", storage);

    // When alice (not the factory) calls pause, txn fails
    await expect(
      tezos.sendBatchOp([
        {
          kind: OpKind.TRANSACTION,
          ...core.methodsObject
            .pause({ swap: true, add_liquidity: false, remove_liquidity: true })
            .toTransferParams(),
        },
      ])
    ).rejects.toThrow("401");
  });
});
