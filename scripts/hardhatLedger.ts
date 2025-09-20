import chalk from 'chalk';

import { extendEnvironment } from 'hardhat/config';
import type { HardhatRuntimeEnvironment } from 'hardhat/types';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';

import { generateLedgerDerivationPath, getLedgerSigner } from '../src/HardwareWallets/ledger';

declare module 'hardhat/types/runtime' {
  interface HardhatRuntimeEnvironment {
    getLedgerSigner: () => Promise<HardhatEthersSigner>;
    // flip this to control behavior per run
    useLedger: boolean;
    useHardwareWalletAccountIndex: number;

    // dont touch this
    useLedger_initizialized: boolean;
  }
}

const makeLedgerSigner = async (hre: HardhatRuntimeEnvironment, index: number) => {
  return getLedgerSigner(hre.ethers.provider, generateLedgerDerivationPath(index));
};

extendEnvironment((hre: HardhatRuntimeEnvironment) => {
  // enable/disable globally via env var or manually
  hre.useLedger = process.env.USE_LEDGER === '1';
  hre.useHardwareWalletAccountIndex = process.env.HARDHAT_HARDWARE_WALLET_ACCOUNT_INDEX
    ? parseInt(process.env.HARDHAT_HARDWARE_WALLET_ACCOUNT_INDEX)
    : 0;

  // check init
  hre.useLedger_initizialized = false;

  hre.getLedgerSigner = async () => {
    try {
      if (!hre.useLedger_initizialized) console.log(chalk.blue('Try to connect to [Ledger]'));

      // create signer
      const signer = (await makeLedgerSigner(hre, hre.useHardwareWalletAccountIndex)) as any as HardhatEthersSigner;

      // try to get address
      const addr = await signer.getAddress();

      if (!hre.useLedger_initizialized) {
        console.log(chalk.green(`Connected to [Ledger] with address [${addr}]`));
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
  type GetCF = typeof hre.ethers.getContractFactory;
  const origGetCF = hre.ethers.getContractFactory.bind(hre.ethers) as GetCF;
  hre.ethers.getContractFactory = (async (...args: any[]) => {
    if (!hre.useLedger) return await (origGetCF as any)(...args);

    const ledger = await hre.getLedgerSigner();

    // Overloads:
    if (args.length === 1) {
      // 1) (name)
      return await origGetCF(args[0] as string, ledger);
    } else if (args.length === 2) {
      const [a, b] = args as [any, any];
      if (b && typeof b === 'object' && 'provider' in b && 'getAddress' in b) {
        // 2) (name, signer) so "opt-out"
        return await origGetCF(a, b);
      } else {
        // 3) (abi, bytecode), so call with signer
        return await origGetCF(a, b, ledger);
      }
    } else if (args.length >= 3) {
      // 4) (abi, bytecode, signer)
      const [a, b, c, ...rest] = args as [any, any, any, ...any[]];
      if (c && typeof c === 'object' && 'provider' in c && 'getAddress' in c) {
        // signer alread provided
        return (origGetCF as any)(a as any, b as any, c as any, ...rest);
      } else {
        // call with signer
        return (origGetCF as any)(a as any, b as any, ledger, ...rest);
      }
    }

    // CF
    const cf = await (origGetCF as any)(...args);
    return cf.connect(ledger);
  }) as GetCF;

  // (Optional) Patch getContractAt as well:
  const origGetCA = hre.ethers.getContractAt.bind(hre.ethers);
  hre.ethers.getContractAt = (async (...args: any[]) => {
    const contract = await (origGetCA as any)(...args);
    if (!hre.useLedger) return contract;
    const ledger = await hre.getLedgerSigner();
    return contract.connect(ledger);
  }) as typeof hre.ethers.getContractAt;
});
