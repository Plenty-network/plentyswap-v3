import fs from "fs";
import * as dotenv from "dotenv";
import { InMemorySigner } from "@taquito/signer";
import { MichelsonMap, TezosToolkit } from "@taquito/taquito";

dotenv.config();

const tezos = new TezosToolkit("https://mainnet.smartpy.io");

tezos.setProvider({
  signer: new InMemorySigner(process.env.PRIVATE_KEY as string),
});

(async () => {
  try {
    //=========
    // Factory
    //=========

    console.log("> Deploying segmented CFMM factory...");

    // Load factory code
    const factoryCode = fs.readFileSync(`${__dirname}/../src/michelson/factory.tz`).toString();

    // Initial storage
    const factoryStorage = {
      admin: "tz1Y8cACwiwQYwLNzzHnBvLQBendT6DUR3Rn",
      proposed_admin: null,
      pools: MichelsonMap.fromLiteral({}),
      fee_tiers: MichelsonMap.fromLiteral({
        1: 1,
        5: 10,
        30: 60,
        100: 200,
      }),
      dev: "tz1Y8cACwiwQYwLNzzHnBvLQBendT6DUR3Rn",
      protocol_share_bps: 0,
      dev_share_bps: 2000,
      voter: "KT1Xa92Nf6evFcEbxMXencfGPmS4urNyn5wd",
    };

    // Deploy
    const op1 = await tezos.contract.originate({ code: factoryCode, storage: factoryStorage });
    await op1.confirmation(1);

    console.log(`>> Deployed at: ${op1.contractAddress}`);

    //================
    // Metadata Store
    //================

    // console.log("> Deploying Metadata Store...");

    // // Load metadata store code
    // const metadataStoreCode = fs
    //   .readFileSync(`${__dirname}/../src/michelson/metadata_store.tz`)
    //   .toString();

    // // Initial storage
    // const metadataStoreStorage = {
    //   admins: ["tz1Y8cACwiwQYwLNzzHnBvLQBendT6DUR3Rn", "tz1er6iTDLBC9hBeWNme7oR8VvAAhWqzkz9C"],
    //   tokens: MichelsonMap.fromLiteral({}),
    // };

    // // Deploy
    // const op2 = await tezos.contract.originate({
    //   code: metadataStoreCode,
    //   storage: metadataStoreStorage,
    // });
    // await op2.confirmation(1);

    // console.log(`>> Deployed at: ${op2.contractAddress}`);
  } catch (err) {
    console.error(err);
  }
})();
