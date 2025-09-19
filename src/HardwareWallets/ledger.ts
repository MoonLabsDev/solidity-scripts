import { LedgerSigner } from '@ethersproject/hardware-wallets';
import { Provider } from 'ethers';

export const enum DerivationPathPurpose {
  Bitcoin = '44',
  Segwit = '84',
}

export const enum DerivationPathCoinType {
  Bitcoin = '0',
  Ethereum = '60',
}

export const enum DerivationPathChange {
  External = '0',
  Internal = '1',
}

export const generateDerivationPath = (
  purpose: DerivationPathPurpose = DerivationPathPurpose.Bitcoin,
  coinType: DerivationPathCoinType = DerivationPathCoinType.Ethereum,
  accountIndex: number = 0,
  change: DerivationPathChange = DerivationPathChange.External,
  addressIndex: number = 0
) => {
  return `${purpose}'/${coinType}'/${accountIndex}'/${change}/${addressIndex}`;
};

export const generateLedgerDerivationPath = (index: number) => {
  return generateDerivationPath(
    DerivationPathPurpose.Bitcoin,
    DerivationPathCoinType.Ethereum,
    index,
    DerivationPathChange.External,
    0
  );
};

export const getLedgerSigner = (provider: Provider, path?: string) => {
  return new LedgerSigner(provider as any, 'hid', path ?? generateLedgerDerivationPath(0));
};
