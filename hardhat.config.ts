import '@nomicfoundation/hardhat-ethers';
import '@nomicfoundation/hardhat-verify';
import '@nomicfoundation/hardhat-toolbox';
import '@nomicfoundation/hardhat-network-helpers';
import 'hardhat-deploy';
import 'hardhat-abi-exporter';
import 'hardhat-contract-sizer';
import { HardhatUserConfig } from 'hardhat/config';

const config: HardhatUserConfig = {
    paths: {
        sources: './contracts',
        tests: './tests',
        cache: './cache',
        artifacts: './artifacts'
    },
    solidity: {
        compilers: [
            {
                version: '0.8.20',
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 200,
                    },
                    evmVersion: 'paris',
                },
            },
        ],
    },
    networks: {
        hardhat: {
            gas: 10000000, // tx gas limit
            blockGasLimit: 15000000,
            gasPrice: 1000000000, //1 GWEI
            initialBaseFeePerGas: 0,
            throwOnTransactionFailures: true,
            throwOnCallFailures: true,
            allowUnlimitedContractSize: true,
        }
    },
    mocha: { timeout: 12000000 },
    contractSizer: {
        alphaSort: true,
        disambiguatePaths: false,
        runOnCompile: false,
        strict: true,
    },
    abiExporter: {
        path: './abi',
        clear: true,
        runOnCompile: true,
        flat: true,
        spacing: 4,
        pretty: false,
    },
    typechain: {
        outDir: './typechain',
        target: 'ethers-v6',
    },
};

export default config;
