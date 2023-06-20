import BigNumber from "bignumber.js";
import { InMemorySigner } from "@taquito/signer";
import { DefaultContractType, ParamsWithKind, TezosToolkit } from "@taquito/taquito";

import { getContractCode } from "./helpers/files";

export default class Tezos {
  private _tezos: TezosToolkit;

  constructor(rpcURL: string) {
    this._tezos = new TezosToolkit(rpcURL);
  }

  async getTezBalance(address: string): Promise<BigNumber> {
    return await this._tezos.tz.getBalance(address);
  }

  async deployContract(alias: string, storage: any): Promise<DefaultContractType> {
    try {
      const code = getContractCode(alias);
      const op = await this._tezos.contract.originate({ code, storage });
      await op.confirmation();
      return await op.contract();
    } catch (err: any) {
      throw err;
    }
  }

  async getStorage(contract: DefaultContractType | string): Promise<any> {
    try {
      if (typeof contract === "string") {
        const instance = await this._tezos.contract.at(contract);
        return await instance.storage();
      } else {
        return await contract.storage();
      }
    } catch (err: any) {
      throw err;
    }
  }

  async sendBatchOp(batch: ParamsWithKind[]) {
    const op = await this._tezos.contract.batch(batch).send();
    await op.confirmation();
    return op;
  }

  async setSigner(signer: string) {
    this._tezos.setProvider({
      signer: new InMemorySigner(signer),
    });
  }

  async sign(payload: string) {
    try {
      return await this._tezos.signer.sign(payload);
    } catch (err: any) {
      throw err;
    }
  }
}
