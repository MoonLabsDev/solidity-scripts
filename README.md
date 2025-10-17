# Install

If you want to use Ledger as HardwareWallet in Hardhat, you need to install:

```
"@ethers-ext/signer-ledger": "^6.0.0-beta.1",
"@ledgerhq/hw-transport-node-hid": "^6.29.11"
```

# Usage

## multicall

this offers a lightweight wrapper arround ethers and MulticallV3. You can either use a `rawCall`, `call` or `callWithReference`.

### callWithReference

The result struct is defined like this (topic is optional, otherwise all results will be always listed with index):

```
interface ICallWithReferenceResult {
  [reference: string]: {
    [topic: string]: any;
    [resultIndex: number]: any;
  };
}
```

```
import { Multicall } from '@moonlabs/solidity-scripts/multicall';
import { Contract, JsonRpcProvider } from 'ethers';

const test = async (provider: JsonRpcProvider) => {
  // init contract
  const myERC20_ETH = new Contract(<CONTRACT ADDRESS>, <CONTRACT ABI>);
  const myERC20_USDC = new Contract(<CONTRACT ADDRESS 2>, <CONTRACT ABI>);

  // init multicall v3
  const multicall = new Multicall(provider, <MULTICALL V3 ADDRESS>);

  // example map
  const myMap: Record<string, Contract> = {
    ETH: myERC20_ETH,
    USDC: myERC20_USDC
  };

  // make reference calls (example with ERC20)
  const refCalls = Object.entries(myMap).map((key, contract) =>
    Multicall.createReference(key, [
      Multicall.createTopicCall('decimals', contract, 'decimals()', []),
      Multicall.createTopicCall('symbol', contract, 'symbol()', [])
      Multicall.createTopicCall('balance', contract, 'balanceOf(address)', [<USER ADDRESS>])
    ])
  );

  // multicall
  const result = await multicall.callWithReference(refCalls, true);

  // read example (result has the references as keys)
  console.log(`ETH decimals: ${result.ETH.decimals} | userBalance: ${result.ETH.balance}`); // via topic
  console.log(`USDC decimals: ${result.USDC[0]} | userBalance: ${result.USDC[2]}`); // via index
}
```

### batchIterate

A useful helper to ensure a mximum batch size. Useful for larger queries.

```
import { Multicall } from '@moonlabs/solidity-scripts/multicall';
import { Contract, JsonRpcProvider } from 'ethers';

const test = async (provider: JsonRpcProvider) => {
  // init contract
  const myERC20_ETH = new Contract(<CONTRACT ADDRESS>, <CONTRACT ABI>);
  const myERC20_USDC = new Contract(<CONTRACT ADDRESS 2>, <CONTRACT ABI>);

  // init multicall v3
  const multicall = new Multicall(provider, <MULTICALL V3 ADDRESS>);

  // example map (assume this has hundreds of entries)
  const myMap: Record<string, Contract> = {
    ETH: myERC20_ETH,
    USDC: myERC20_USDC
  };
  const myKeys = Object.keys(myMap);

  // process
  await Multicall.batchIterate(
    multicall,
    mapEntries.lengh,
    100, // batch size
    myKeys, // references
    true,
    async (r, i) => r[myKeys[i]].calls = [
      Multicall.createTopicCall('symbol', myMap[myKeys[i]], 'symbol()', [])
      Multicall.createTopicCall('balance', myMap[myKeys[i]], 'balanceOf(address)', [<USER ADDRESS>])
    ], // function to make the calls
    async (r, i) => {
      const val = r[myKeys[i]];
      console.log(`${val.symbol} balance = ${val.balance}`)
    }, // function to execute for each chunk
    async (start, end) => console.log(`loaded ${end - start} chunks`)
  );
}
```

## hardhatLedger

in your hardhat.config.ts, just add this line:

```
import '@moonlabs/solidity-scripts/hardhatLedger';
```

to then use Ledger Hardware wallet, just call the following code (before ensure, that you imported `hre`)

```
hre.useLedger = true;
hre.useHardwareWalletAccountIndex = 0; // select account index
```

or use DeployHelper:

```
const deploy = new DeployHelper({
  walletProvider: 'ledger',
  hardwareWalletAccountIndex: 0, //select account index
});
```

## flatten

Make a new file like this:

```
const { batchFlatten } = require('@moonlabs/solidity-scripts/flatten.js');

const args = [
  {
    file: './contracts/Test1.sol',
    out: './flat/Test1',
  },
  {
    file: './contracts/ABC.sol',
    out: './flat/ChosenOutputPath',
  }
];

batchFlatten(args);
```

and in `package.json` add a script:

```
"flatten": "node ./utils/flatten.ts",
```

## deployHelpers

### General

The `<UNIQUE ID>` fields are used to check progress, continue, and skip already executed code.
State will be stored per chain in `/deploy/deployments/<CHAIN ID>/info.json`

### Hardhat Tasks

create a Hardhat Task like this:

```
import '@nomicfoundation/hardhat-toolbox';

require('dotenv').config(); // load .env

task('myTask', 'Test Task')
  .setAction(async (taskArgs: any) => {
    // deploy helper
    const { DeployHelper } = require('@moonlabs/solidity-scripts/deployHelpers');
    const deploy = new DeployHelper({
      walletProvider: process.env.DEPLOYHELPER_USE_LEDGER === 'true' ? 'ledger' : undefined,
      hardwareWalletAccountIndex: process.env.DEPLOYHELPER_ACCOUNT_INDEX
        ? parseInt(process.env.DEPLOYHELPER_ACCOUNT_INDEX)
        : undefined,
      silent: false // set to true, to prevent log output (for example for automated tests)
    });
    await deploy.init();
  });
```

If you want you can also use a Ledger Hardware wallet, if you also use **hardhatLedger**.

### Contracts

Deploy contracts via

```
const contract = await deploy.deploy(
  '<UNIQUE DEPLOY ID>',
  '<CONTRACT NAME>',
  async () => await (await ethers.getContractFactory('<CONTRACT NAME>')).deploy(<PARAMETERS>)
);
```

Load previously deployed contracts via `await deploy.load('<UNIQUE DEPLOY ID>', '<CONTRACT NAME>');`.

### Send

To send & sign transactions use

```
await deploy.send(
  `<UNIQUE SEND ID>`,
  `<LOG OUTPUT>`,
  async () => await contract.myFunction(<PARAMTERS>)
);
```

### Call

To call view functions use

```
await deploy.call(
  `<UNIQUE CALL ID>`,
  `<LOG OUTPUT>`,
  async () => await contract.myFunction(<PARAMTERS>)
);
```

### Additional State files

By default you only have the `info.json` state file. It will always get loaded. You can load other state files that are merged, by using `deploy.useAlternativeInfoFileID(<STATE FILE ID>);`
When called without parameter, it reverts back to `info.json` otherwise all new state changes will be written to `/deploy/deployments/<CHAIN ID>/<STATE FILE ID>.json`.
This is very useful for maintainance scripts. First you load the deployment data from `info.json`, then switch to another state file and execute your script logic. To reset the state, just delete the state file.

### Logging

For Categories you have `deploy.openCategory('<NAME>');` and `deploy.closeCategory();`
Besides that you can call `deploy.log`, `deploy.warn`, `deploy.error` which all handle tab intend from categories
