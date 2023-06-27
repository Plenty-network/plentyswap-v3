// Note:
// - For simplicity of calculations, decimals for both token x and y are kept same (6) throughout the tests.
// - The default starting real price Y / X is 1 i.e tick = 0

import setPosition from "./scenarios/core/set_position";
import updatePosition from "./scenarios/core/update_position";
import xToY from "./scenarios/core/x_to_y";

// Library configuration for running test
import BigNumber from "bignumber.js";
BigNumber.config({ ROUNDING_MODE: BigNumber.ROUND_DOWN });
jest.setTimeout(30000);

// This apparently makes the tests run much faster compared to a jest serialisation hook
describe("unit", () => {
  // setPosition();
  // updatePosition();
  xToY();
});
