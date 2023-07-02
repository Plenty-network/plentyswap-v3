import { OpKind } from "@taquito/taquito";

import Tezos from "../../tezos";
import { CoreStorage } from "../../types";
import { config } from "../../helpers/config";
import { accounts } from "../../helpers/accounts";
import { getDefaultCoreStorage } from "../../helpers/default";

const test = () => {
  describe("core.toggle_ve", () => {
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

    it("flips the ve system connection when called", async () => {
      const core = await tezos.deployContract("core", storage);

      // When alice calls toggle_ve, the ve system is connected
      await tezos.sendBatchOp([
        {
          kind: OpKind.TRANSACTION,
          ...core.methodsObject.toggle_ve().toTransferParams(),
        },
      ]);

      let updatedStorage = await tezos.getStorage(core);
      expect(updatedStorage.is_ve).toEqual(true);

      // When alice calls toggle_ve again, the ve system is disconnected
      await tezos.sendBatchOp([
        {
          kind: OpKind.TRANSACTION,
          ...core.methodsObject.toggle_ve().toTransferParams(),
        },
      ]);

      updatedStorage = await tezos.getStorage(core);
      expect(updatedStorage.is_ve).toEqual(false);
    });

    it("fails if not called by the factory", async () => {
      storage.constants.factory = accounts.bob.pkh;

      const core = await tezos.deployContract("core", storage);

      // When alice (not the factory) calls toggle_ve, txn fails
      await expect(
        tezos.sendBatchOp([
          {
            kind: OpKind.TRANSACTION,
            ...core.methodsObject.toggle_ve().toTransferParams(),
          },
        ])
      ).rejects.toThrow("401");
    });
  });
};

export default test;
