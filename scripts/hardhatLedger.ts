import chalk from 'chalk';

import { extendEnvironment } from 'hardhat/config';
import type { HardhatRuntimeEnvironment } from 'hardhat/types';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';

import { getLedgerSigner } from '../src/HardwareWallets/ledger';

declare module 'hardhat/types/runtime' {
  interface HardhatRuntimeEnvironment {
    getLedgerSigner: (path?: string) => Promise<HardhatEthersSigner>;
    // flip this to control behavior per run
    useLedger: boolean;

    useLedger_initizialized: boolean;
  }
}

function makeLedgerSigner(hre: HardhatRuntimeEnvironment, path?: string) {
  return getLedgerSigner(hre.ethers.provider, path);
}

extendEnvironment((hre: HardhatRuntimeEnvironment) => {
  // enable/disable globally via env var or manually
  hre.useLedger = process.env.USE_LEDGER === '1';

  // check init
  hre.useLedger_initizialized = false;

  hre.getLedgerSigner = async (path?: string) => {
    try {
      if (!hre.useLedger_initizialized) console.log(chalk.blue('Try to connect to [Ledger]'));

      // create signer
      const signer = makeLedgerSigner(hre, path) as any as HardhatEthersSigner;

      // try to get address
      await signer.getAddress();

      if (!hre.useLedger_initizialized) {
        console.log(chalk.green('Connected to [Ledger]'));
        hre.useLedger_initizialized = true;
      }

      return signer;
    } catch (error) {
      console.error('Error getting address from Ledger', error);
      throw error;
    }
  };

  // --- Patch ethers.getSigners to return Ledger (index 0) when enabled ---
  const origGetSigners = hre.ethers.getSigners.bind(hre.ethers);
  hre.ethers.getSigners = async () => {
    return !hre.useLedger ? origGetSigners() : [await hre.getLedgerSigner()];
  };

  // --- Patch ethers.getSigner to return Ledger for index 0 when enabled ---
  const origGetSigner = hre.ethers.getSigner.bind(hre.ethers);
  hre.ethers.getSigner = async (address: string) => {
    if (!hre.useLedger) return origGetSigner(address);
    else if (address === undefined) return hre.getLedgerSigner();
    else return origGetSigner(address);
  };

  // --- Patch ethers.getContractFactory to auto-connect to Ledger when enabled ---
  const origGetCF = hre.ethers.getContractFactory.bind(hre.ethers);
  hre.ethers.getContractFactory = (async (...args: any[]) => {
    const cf = await (origGetCF as any)(...args);
    if (!hre.useLedger) return cf;
    const ledger = await hre.getLedgerSigner();
    return cf.connect(ledger);
  }) as typeof hre.ethers.getContractFactory;

  // (Optional) Patch getContractAt as well:
  const origGetCA = hre.ethers.getContractAt.bind(hre.ethers);
  hre.ethers.getContractAt = (async (...args: any[]) => {
    const contract = await (origGetCA as any)(...args);
    if (!hre.useLedger) return contract;
    const ledger = await hre.getLedgerSigner();
    return contract.connect(ledger);
  }) as typeof hre.ethers.getContractAt;
});
