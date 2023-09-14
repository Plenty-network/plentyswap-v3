import { MichelsonMap, OpKind } from "@taquito/taquito";

import Tezos from "../../../tezos";
import { number } from "../../../helpers/math";
import { config } from "../../../helpers/config";
import { accounts } from "../../../helpers/accounts";
import { CoreStorage, Position } from "../../../types";
import { getDefaultCoreStorage } from "../../../helpers/default";

describe("core.balance_of", () => {
  let tezos: Tezos;
  let storage: CoreStorage;

  beforeEach(async () => {
    tezos = new Tezos(config.rpcURL);
    await tezos.setSigner(accounts.alice.sk);

    const ledger = new MichelsonMap<number, string>();

    ledger.set(1, accounts.alice.pkh);
    ledger.set(2, accounts.alice.pkh);
    ledger.set(3, accounts.alice.pkh);
    ledger.set(4, accounts.alice.pkh);

    storage = {
      ...getDefaultCoreStorage(),
      ledger,
    };
  });

  it("correctly returns the balances of the accounts", async () => {
    const core = await tezos.deployContract("core", storage);
    const caller = await tezos.deployContract("dummyCaller", []);

    // When core balance_of is called through the caller
    await tezos.sendBatchOp([
      {
        kind: OpKind.TRANSACTION,
        ...caller.methodsObject
          .call({
            0: core.address,
            1: [
              { owner: accounts.alice.pkh, token_id: 1 },
              { owner: accounts.alice.pkh, token_id: 2 },
              { owner: accounts.bob.pkh, token_id: 3 },
              { owner: accounts.alice.pkh, token_id: 4 },
            ],
          })
          .toTransferParams(),
      },
    ]);

    const callerStorage = await tezos.getStorage(caller);

    // Correct balances are returned
    expect(callerStorage).toEqual([number(1), number(1), number(0), number(1)]);
  });
});

export default test;
