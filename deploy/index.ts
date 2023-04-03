import fs from "fs";
import { MichelsonMap, TezosToolkit } from "@taquito/taquito";
import { InMemorySigner } from "@taquito/signer";

const tezos = new TezosToolkit("https://ghostnet.smartpy.io");

tezos.setProvider({
  signer: new InMemorySigner(process.env.PRIVATE_KEY as string),
});

(async () => {
  try {
    console.log("> Deploying segmented CFMM factory...");

    // Load code
    const code = fs.readFileSync(`${__dirname}/../src/michelson/factory.tz`).toString();

    // Initial storage
    const storage = {
      admin: "tz1ZczbHu1iLWRa88n9CUiCKDGex5ticp19S",
      proposed_admin: null,
      pools: MichelsonMap.fromLiteral({}),
      fee_tiers: MichelsonMap.fromLiteral({
        1: 1,
        10: 10,
        30: 60,
        100: 200,
      }),
      dev: "tz1eUzpKnk5gKLYw4HWs2sWsynfbT7ypGxNM",
      protocol_share_bps: 0,
      dev_share_bps: 2000,
      voter: "KT1Xa92Nf6evFcEbxMXencfGPmS4urNyn5wd",
    };

    // Deploy
    const op = await tezos.contract.originate({ code, storage });
    await op.confirmation(1);

    console.log(`>> Deployed at: ${op.contractAddress}`);
  } catch (err) {
    console.error(err);
  }
})();
