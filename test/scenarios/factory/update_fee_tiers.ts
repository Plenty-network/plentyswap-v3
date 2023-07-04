import { OpKind } from "@taquito/taquito";

import Tezos from "../../tezos";
import { number } from "../../helpers/math";
import { FactoryStorage } from "../../types";
import { config } from "../../helpers/config";
import { accounts } from "../../helpers/accounts";
import { getDefaultFactoryStorage } from "../../helpers/default";

const test = () => {
  describe("factory.update_fee_tiers", () => {
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

    it("correctly updates the fee tiers", async () => {
      const factory = await tezos.deployContract("factory", storage);

      // When alice (the admin) changes the fee tiers
      await tezos.sendBatchOp([
        {
          kind: OpKind.TRANSACTION,
          ...factory.methods.update_fee_tiers({ 10: 5, 100: 50 }).toTransferParams(),
        },
      ]);

      const factoryStorage = await tezos.getStorage(factory.address);

      // The storage is updated correctly
      expect(factoryStorage.fee_tiers.get("10")).toEqual(number(5));
      expect(factoryStorage.fee_tiers.get("100")).toEqual(number(50));
    });

    it("fails if not called by the admin", async () => {
      storage.admin = accounts.bob.pkh; // Change the admin to bob

      const factory = await tezos.deployContract("factory", storage);

      // When alice (not the admin) changes the fee tiers, txn fails
      await expect(
        tezos.sendBatchOp([
          {
            kind: OpKind.TRANSACTION,
            ...factory.methods.update_fee_tiers({ 10: 5, 100: 50 }).toTransferParams(),
          },
        ])
      ).rejects.toThrow("401");
    });
  });
};

export default test;
