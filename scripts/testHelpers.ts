import { ContractTransactionResponse } from 'ethers';

export interface ITxGasInfo {
  used: bigint;
  price: bigint;
  gas: bigint;
}

const gasUsed = async (tx: ContractTransactionResponse) => {
  const receipt = await tx.wait();
  return BigInt(receipt?.cumulativeGasUsed ?? 0) * BigInt(receipt?.gasPrice ?? 0);
};

const getGas = async (tx: ContractTransactionResponse): Promise<ITxGasInfo> => {
  const g = await gasUsed(tx);
  return { used: g, price: tx.gasPrice, gas: g / tx.gasPrice };
};
