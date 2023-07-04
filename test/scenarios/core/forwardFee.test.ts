// The ve-system's fee distributor whose dummy is being called in this test: https://github.com/Plenty-network/ve-core/blob/master/fee_distributor.py

import { DefaultContractType, MichelsonMap, OpKind } from "@taquito/taquito";

import Tezos from "../../tezos";
import { number } from "../../helpers/math";
import { config } from "../../helpers/config";
import { accounts } from "../../helpers/accounts";
import { CoreStorage, FA12Storage, FA2Storage } from "../../types";
import { DECIMALS, getDefaultCoreStorage } from "../../helpers/default";

jest.setTimeout(30000);

describe("core.forwardFee", () => {
  let tezos: Tezos;
  let storage: CoreStorage;
  let tokenX: DefaultContractType;
  let tokenY: DefaultContractType;

  beforeEach(async () => {
    tezos = new Tezos(config.rpcURL);
    await tezos.setSigner(accounts.alice.sk);

    const fa12Storage: FA12Storage = {
      administrator: accounts.alice.pkh,
      balances: new MichelsonMap(),
      metadata: new MichelsonMap(),
      paused: false,
      token_metadata: new MichelsonMap(),
      totalSupply: number(100 * DECIMALS),
    };

    const fa2Storage: FA2Storage = {
      administrator: accounts.alice.pkh,
      last_token_id: 1,
      ledger: new MichelsonMap(),
      metadata: new MichelsonMap(),
      paused: false,
      operators: new MichelsonMap(),
      token_metadata: new MichelsonMap(),
      supply: new MichelsonMap(),
    };

    // Set initial balance for Alice
    fa12Storage.balances.set(accounts.alice.pkh, {
      balance: number(100 * DECIMALS),
      approvals: new MichelsonMap(),
    });
    fa2Storage.ledger.set({ 0: accounts.alice.pkh, 1: 0 }, number(100 * DECIMALS));
    fa2Storage.token_metadata.set(0, { token_id: 0, token_info: new MichelsonMap() });

    // Deploy the tokens
    tokenX = await tezos.deployContract("fa12", fa12Storage);
    tokenY = await tezos.deployContract("fa2", fa2Storage);

    const defaultCoreStorage = getDefaultCoreStorage();

    storage = {
      ...defaultCoreStorage,
      constants: {
        ...defaultCoreStorage.constants,
        token_x: { fa12: tokenX.address },
        token_y: { fa2: { address: tokenY.address, token_id: number(0) } },
      },
    };
  });

  it("transfers the protocol fees to fee distributor and calls add_fees with correct params", async () => {
    // Deploy periphery contracts
    const factory = await tezos.deployContract("dummyFactory", {
      shares: { 1: 1500, 2: 2000 },
      address: accounts.alice.pkh,
    });
    const feeDistributor = await tezos.deployContract("dummyFeeDistributor", null);

    storage.constants.factory = factory.address;

    storage.protocol_share = { x: number(10 * DECIMALS), y: number(5 * DECIMALS) };

    const core = await tezos.deployContract("core", storage);

    // Transfer tokens to core so that it can send it to fee distributor
    await tezos.sendBatchOp([
      {
        kind: OpKind.TRANSACTION,
        ...tokenY.methodsObject
          .transfer([
            {
              from_: accounts.alice.pkh,
              txs: [{ to_: core.address, token_id: 0, amount: number(100 * DECIMALS) }],
            },
          ])
          .toTransferParams(),
      },
      {
        kind: OpKind.TRANSACTION,
        ...tokenX.methodsObject
          .transfer({
            from: accounts.alice.pkh,
            to: core.address,
            value: number(100 * DECIMALS),
          })
          .toTransferParams(),
      },
    ]);

    // When alice (set as voter address in core) calls fowardFee
    await tezos.sendBatchOp([
      {
        kind: OpKind.TRANSACTION,
        ...core.methodsObject
          .forwardFee({ feeDistributor: feeDistributor.address, epoch: 1 })
          .toTransferParams(),
      },
    ]);

    const updatedStorage = await tezos.getStorage(core);
    const tokenXStorage = await tezos.getStorage(tokenX);
    const tokenYStorage = await tezos.getStorage(tokenY);

    const feeDistributorStorage = await tezos.getStorage(feeDistributor);

    // the core storage is updated correctly
    expect(updatedStorage.protocol_share.x).toEqual(number(0));
    expect(updatedStorage.protocol_share.y).toEqual(number(0));

    // the fee distributor storage is updated correctly
    expect(feeDistributorStorage.epoch).toEqual(number(1));
    expect(feeDistributorStorage.fees.get({ fa12: tokenX.address })).toEqual(number(10 * DECIMALS));
    expect(feeDistributorStorage.fees.get({ fa2: { 1: tokenY.address, 2: "0" } })).toEqual(
      number(5 * DECIMALS)
    );

    const feeDistributorY = await tokenYStorage.ledger.get({ 0: feeDistributor.address, 1: 0 });
    const feeDistributorX = await tokenXStorage.balances.get(feeDistributor.address);

    // Fee is transferred to fee distributor
    expect(feeDistributorY).toEqual(number(5 * DECIMALS));
    expect(feeDistributorX.balance).toEqual(number(10 * DECIMALS));
  });

  it("fails if not called by the voter", async () => {
    // Deploy periphery contracts
    const factory = await tezos.deployContract("dummyFactory", {
      shares: { 1: 1500, 2: 2000 },
      address: accounts.bob.pkh, // Make bob the voter
    });

    storage.constants.factory = factory.address;

    const feeDistributor = await tezos.deployContract("dummyFeeDistributor", null);

    const core = await tezos.deployContract("core", storage);

    // When alice (not the voter) calls fowardFee, txn fails
    await expect(
      tezos.sendBatchOp([
        {
          kind: OpKind.TRANSACTION,
          ...core.methodsObject
            .forwardFee({ feeDistributor: feeDistributor.address, epoch: 1 })
            .toTransferParams(),
        },
      ])
    ).rejects.toThrow("401");
  });
});
