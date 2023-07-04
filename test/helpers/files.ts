import fs from "fs";

const aliasToDirectory: { [key: string]: string } = {
  core: `${__dirname}/../../src/michelson/core.tz`,
  farm: `${__dirname}/../../src/michelson/farm.tz`,
  factory: `${__dirname}/../../src/michelson/factory.tz`,
  fa12: `${__dirname}/../dummy/fa12.tz`,
  fa2: `${__dirname}/../dummy/fa2.tz`,
  dummyFactory: `${__dirname}/../dummy/factory.tz`,
  dummyFeeDistributor: `${__dirname}/../dummy/fee_distributor.tz`,
  dummyCaller: `${__dirname}/../dummy/caller.tz`,
  dummyPool: `${__dirname}/../dummy/pool.tz`,
};

export const getContractCode = (alias: string) => {
  return fs.readFileSync(aliasToDirectory[alias]).toString();
};
