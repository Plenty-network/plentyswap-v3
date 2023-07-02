import { OpKind } from "@taquito/taquito";

import Tezos from "../../../tezos";
import { CoreStorage } from "../../../types";
import { number } from "../../../helpers/math";
import { config } from "../../../helpers/config";
import { accounts } from "../../../helpers/accounts";
import { getDefaultCoreStorage } from "../../../helpers/default";

const test = () => {
  describe("core.update_operators", () => {
    let tezos: Tezos;
    let storage: CoreStorage;

    beforeEach(async () => {
      tezos = new Tezos(config.rpcURL);
      await tezos.setSigner(accounts.alice.sk);

      storage = {
        ...getDefaultCoreStorage(),
      };
    });

    it("adds and removes an operator", async () => {
      const core = await tezos.deployContract("core", storage);

      // When alice adds the operators for her token 1
      await tezos.sendBatchOp([
        {
          kind: OpKind.TRANSACTION,
          ...core.methodsObject
            .update_operators([
              {
                add_operator: {
                  owner: accounts.alice.pkh,
                  token_id: number(1),
                  operator: accounts.bob.pkh,
                },
              },
            ])
            .toTransferParams(),
        },
      ]);

      let updatedStorage = await tezos.getStorage(core);

      let operator = await updatedStorage.operators.get({
        owner: accounts.alice.pkh,
        token_id: number(1),
        operator: accounts.bob.pkh,
      });

      // Operator is correctly added
      expect(operator).toBeDefined();

      // When alice removes the previously added operator
      await tezos.sendBatchOp([
        {
          kind: OpKind.TRANSACTION,
          ...core.methodsObject
            .update_operators([
              {
                remove_operator: {
                  owner: accounts.alice.pkh,
                  token_id: number(1),
                  operator: accounts.bob.pkh,
                },
              },
            ])
            .toTransferParams(),
        },
      ]);

      updatedStorage = await tezos.getStorage(core);

      operator = await updatedStorage.operators.get({
        owner: accounts.alice.pkh,
        token_id: number(1),
        operator: accounts.bob.pkh,
      });

      // Operator is correctly remvoed
      expect(operator).toBeUndefined();
    });

    it("fails if the sender is not the owner", async () => {
      const core = await tezos.deployContract("core", storage);

      // When alice tries to add operator for bob, txn fails
      await expect(
        tezos.sendBatchOp([
          {
            kind: OpKind.TRANSACTION,
            ...core.methodsObject
              .update_operators([
                {
                  add_operator: {
                    owner: accounts.bob.pkh,
                    token_id: number(1),
                    operator: accounts.alice.pkh,
                  },
                },
              ])
              .toTransferParams(),
          },
        ])
      ).rejects.toThrow("FA2_NOT_OWNER");
    });
  });
};

export default test;
