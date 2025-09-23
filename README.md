# Install

If you want to use Ledger as HardwareWallet in Hardhat, you need to install:

```
"@ethers-ext/signer-ledger": "^6.0.0-beta.1",
"@ledgerhq/hw-transport-node-hid": "^6.29.11"
```

# Usage

## hardhatLedger

in your hardhat.config.ts, just add this line:

```
import '@moonlabs/solidity-scripts/hardhatLedger';
```

to then use Ledger Hardware wallet, just call the following code (before ensure, that you imported `hre`)

```
hre.useLedger = true;
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
