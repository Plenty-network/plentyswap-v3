import { MichelsonMap, OpKind, UnitValue } from "@taquito/taquito";

import Tezos from "../../../tezos";
import { number } from "../../../helpers/math";
import { config } from "../../../helpers/config";
import { accounts } from "../../../helpers/accounts";
import { CoreStorage, Position } from "../../../types";
import { getDefaultCoreStorage } from "../../../helpers/default";

describe("core.transfer", () => {
  let tezos: Tezos;
  let storage: CoreStorage;

  beforeEach(async () => {
    tezos = new Tezos(config.rpcURL);
    await tezos.setSigner(accounts.alice.sk);

    const ledger = new MichelsonMap<number, string>();

    ledger.set(1, accounts.alice.pkh);

    storage = {
      ...getDefaultCoreStorage(),
      ledger,
    };
  });

  it("transfers a position", async () => {
    const core = await tezos.deployContract("core", storage);

    // When alice transfers a position to bob
    const op = await tezos.sendBatchOp([
      {
        kind: OpKind.TRANSACTION,
        ...core.methodsObject
          .transfer([
            {
              from_: accounts.alice.pkh,
              txs: [
                {
                  to_: accounts.bob.pkh,
                  token_id: number(1),
                  amount: number(1),
                },
              ],
            },
          ])
          .toTransferParams(),
      },
    ]);

    const updatedStorage = await tezos.getStorage(core);

    const owner = await updatedStorage.ledger.get(1);

    // The owner is now bob
    expect(owner).toEqual(accounts.bob.pkh);
  });

  it("allows a zero amount transfer", async () => {
    const core = await tezos.deployContract("core", storage);

    // When alice makes zero transfer to bob
    const op = await tezos.sendBatchOp([
      {
        kind: OpKind.TRANSACTION,
        ...core.methodsObject
          .transfer([
            {
              from_: accounts.alice.pkh,
              txs: [
                {
                  to_: accounts.bob.pkh,
                  token_id: number(1),
                  amount: number(0),
                },
              ],
            },
          ])
          .toTransferParams(),
      },
    ]);

    const updatedStorage = await tezos.getStorage(core);

    const owner = await updatedStorage.ledger.get(1);

    // The owner remains the same
    expect(owner).toEqual(accounts.alice.pkh);
  });

  it("allows an operator to make a transfer", async () => {
    // Bob is an operator for alice
    storage.operators.set(
      { owner: accounts.alice.pkh, operator: accounts.bob.pkh, token_id: number(1) },
      UnitValue
    );

    const core = await tezos.deployContract("core", storage);

    // Make bob the sender
    tezos.setSigner(accounts.bob.sk);

    // When bob transfers alice's position to himself
    const op = await tezos.sendBatchOp([
      {
        kind: OpKind.TRANSACTION,
        ...core.methodsObject
          .transfer([
            {
              from_: accounts.alice.pkh,
              txs: [
                {
                  to_: accounts.bob.pkh,
                  token_id: number(1),
                  amount: number(1),
                },
              ],
            },
          ])
          .toTransferParams(),
      },
    ]);

    const updatedStorage = await tezos.getStorage(core);

    const owner = await updatedStorage.ledger.get(1);

    // The owner is changed to bob
    expect(owner).toEqual(accounts.bob.pkh);
  });

  it("fails if the sender is not an operator or owner", async () => {
    const core = await tezos.deployContract("core", storage);

    // When alice (not operator) makes a transfer from bob's account, txn fails
    await expect(
      tezos.sendBatchOp([
        {
          kind: OpKind.TRANSACTION,
          ...core.methodsObject
            .transfer([
              {
                from_: accounts.bob.pkh,
                txs: [
                  {
                    to_: accounts.bob.pkh,
                    token_id: number(1),
                    amount: number(0),
                  },
                ],
              },
            ])
            .toTransferParams(),
        },
      ])
    ).rejects.toThrow("FA2_NOT_OPERATOR");
  });

  it("fails if more than available balance is transfered", async () => {
    const core = await tezos.deployContract("core", storage);

    // When alice  makes a transfer of 2 tokens of id 1, txn fails
    await expect(
      tezos.sendBatchOp([
        {
          kind: OpKind.TRANSACTION,
          ...core.methodsObject
            .transfer([
              {
                from_: accounts.alice.pkh,
                txs: [
                  {
                    to_: accounts.bob.pkh,
                    token_id: number(1),
                    amount: number(2),
                  },
                ],
              },
            ])
            .toTransferParams(),
        },
      ])
    ).rejects.toThrow("FA2_INSUFFICIENT_BALANCE");
  });

  it("fails if token does not exist", async () => {
    const core = await tezos.deployContract("core", storage);

    // When alice tries to transfer position 2 (does not exist), txn fails
    await expect(
      tezos.sendBatchOp([
        {
          kind: OpKind.TRANSACTION,
          ...core.methodsObject
            .transfer([
              {
                from_: accounts.alice.pkh,
                txs: [
                  {
                    to_: accounts.bob.pkh,
                    token_id: number(2),
                    amount: number(1),
                  },
                ],
              },
            ])
            .toTransferParams(),
        },
      ])
    ).rejects.toThrow("FA2_TOKEN_UNDEFINED");
  });
});
