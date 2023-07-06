# Plentyswap V3

This is a segmented CFMM on Tezos inspired by Uniswap v3. The code in this repository has been taken and modified from the original implementation available at https://github.com/tezos-checker/segmented-cfmm.

A specificiation for the updated contract is available [here](https://github.com/Plenty-network/plentyswap-v3/blob/master/SPECIFICATION.md).

### Primary changes
- A new `token` type has been added to the core contract to allow for the same Michelson code for all possible pairs.
- The ctez burn feature has been removed.
- A dev and protocol share has been added to the trading fees.
- New entrypoints `forwardFee`, `retrieve_dev_share` and `toggle_ve` have been added.
- The callback based views have been changed to native onchain views.
- The original `liquidity_mining` contract has been renamed to `farm` and has been modified to work with the segmented CFMM's onchain views.
- Haskell tests have been moved to Typescript to cater to a wider audience. 

## Folder Structure

```
\
|- deploy // A basic script to deploy the factory contract
.
|- src
.
|--- ligo // Segmented CFMM contracts written in Cameligo [version 0.68.0]
.
|--- michelson // LIGO contracts compiled down to Michelson
.
|- test // Jest tests written for the compiled Michelson code and run via deployment on flextesa
```

## Contracts

All contracts are written in Cameligo version `0.68.0`.

- `core`: The core CFMM pool where liquidity is added and tokens can be swapped. This also natively adheres to the FA2 standard.
- `farm`: A liquidity mining contract explicitly built for the segmented CFMM's non-fungible positions.
- `factory`: A generator contract for core. 

## Testing 
Install dependencies:

```
$ npm install
```

Run flextesa sandbox:
```
$ npm run flextesa
```

Run the whole test suite:
```
$ npm run test
```

To run a specific test:
```
$ npm run test <test-file-name>
```
