import BigNumber from "bignumber.js";

// Explicit BigNumber convertor to support comparison with storage fetched using Taquito, where
// all `nat` and `int`types are returned as a BigNumber
export const number = (num: number | string | BigNumber) => {
  BigNumber.config({ EXPONENTIAL_AT: 540 });
  return new BigNumber(num);
};

export const dateToTimestamp = (date: string) => {
  return Math.floor(new Date(date).getTime() / 1000);
};
