// Note:
// - For simplicity of calculations, decimals for both token x and y are kept same (6) throughout the tests.
// - The default starting real price Y / X is 1 i.e tick = 0

import setPosition from "./scenarios/core/set_position";
import updatePosition from "./scenarios/core/update_position";
import xToY from "./scenarios/core/x_to_y";
import yToX from "./scenarios/core/y_to_x";
import UpdateTimedCumulatives from "./scenarios/core/update_timed_cumulatives";
import IncreaseObservationCount from "./scenarios/core/increase_observation_count";
import ForwardFee from "./scenarios/core/forwardFee";
import ToggleVe from "./scenarios/core/toggle_ve";
import RetrieveDevShare from "./scenarios/core/retrieve_dev_share";
import Transfer from "./scenarios/core/fa2/transfer";
import UpdateOperators from "./scenarios/core/fa2/update_operators";
import BalanceOf from "./scenarios/core/fa2/balance_of";
import Observe from "./scenarios/core/observe";
import GetPositionInfo from "./scenarios/core/get_position_info";
import SnapshotCumuInside from "./scenarios/core/snapshot_cumulatives_inside";

// Library configuration for running test
import BigNumber from "bignumber.js";
BigNumber.config({ ROUNDING_MODE: BigNumber.ROUND_DOWN });
jest.setTimeout(30000);

// This apparently makes the tests run much faster compared to a jest serialisation hook
describe("unit", () => {
  // setPosition();
  // updatePosition();
  // xToY();
  // yToX();
  // UpdateTimedCumulatives();
  // IncreaseObservationCount();
  // ForwardFee();
  // ToggleVe();
  // RetrieveDevShare();
  // Transfer();
  // UpdateOperators();
  // BalanceOf();
  // Observe();
  // GetPositionInfo();
  SnapshotCumuInside();
});
