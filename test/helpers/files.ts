import fs from "fs";

const aliasToDirectory: { [key: string]: string } = {
  core: `${__dirname}/../../src/michelson/core.tz`,
  farm: `${__dirname}/../../src/michelson/swap/farm.tz`,
  factory: `${__dirname}/../../src/michelson/swap/factory.tz`,
  fa12: `${__dirname}/../dummy/fa12.tz`,
  fa2: `${__dirname}/../dummy/fa2.tz`,
};

export const getContractCode = (alias: string) => {
  return fs.readFileSync(aliasToDirectory[alias]).toString();
};
