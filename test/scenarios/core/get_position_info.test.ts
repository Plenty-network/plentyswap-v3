import { MichelsonMap } from "@taquito/taquito";

import Tezos from "../../tezos";
import { number } from "../../helpers/math";
import { config } from "../../helpers/config";
import { accounts } from "../../helpers/accounts";
import { CoreStorage, Position } from "../../types";
import { getDefaultCoreStorage } from "../../helpers/default";

describe("core.get_position_info", () => {
  let tezos: Tezos;
  let storage: CoreStorage;

  beforeEach(async () => {
    tezos = new Tezos(config.rpcURL);
    await tezos.setSigner(accounts.alice.sk);

    const positions = new MichelsonMap<number, Position>();
    positions.set(1, {
      owner: accounts.alice.pkh,
      lower_tick_index: number(-100),
      upper_tick_index: number(100),
      liquidity: number(1000),
      fee_growth_inside_last: { x: number(0), y: number(0) },
    });

    const defaultCoreStorage = getDefaultCoreStorage();

    storage = {
      ...defaultCoreStorage,
      positions,
    };
  });

  it("returns the correct position", async () => {
    const core = await tezos.deployContract("core", storage);

    // When the view is called
    const result = await core.contractViews
      .get_position_info(1)
      .executeView({ viewCaller: accounts.alice.pkh });

    // Correct value is returned
    expect(result).toEqual({
      owner: accounts.alice.pkh,
      lower_tick_index: number(-100),
      upper_tick_index: number(100),
      liquidity: number(1000),
    });
  });

  it("fails if the position does not exist", async () => {
    const core = await tezos.deployContract("core", storage);

    // When the view is called to get position 2, txn fails
    await expect(
      core.contractViews.get_position_info(2).executeView({ viewCaller: accounts.alice.pkh })
    ).rejects.toThrow("FA2_TOKEN_UNDEFINED");
  });
});
