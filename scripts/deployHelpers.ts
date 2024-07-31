import hre, { ethers } from 'hardhat';
import { TransactionResponse, ContractTransactionResponse, BaseContract, resolveAddress } from 'ethers';
import chalk from 'chalk';
import fs from 'fs';

interface ContractDeploymentInfo {
    id: string;
    txHash: string;
    address?: string;
}

interface ContractCallInfo {
    id: string;
    result: any;
}

interface ContractSendInfo {
    id: string;
    txHash: string;
    success: boolean;
}

interface ContractDeploymentState {
    deployments: ContractDeploymentInfo[];
    calls: ContractCallInfo[];
    sends: ContractSendInfo[];
}

export class DeployHelper {
    public chainId: number;
    private state: ContractDeploymentState;
    private level: number;
    private tab: string;
    public silent: boolean;
    public throwOnRevert: boolean;

    public constructor() {
        this.level = 0;
        this.tab = '  ';
        this.silent = false;
        this.throwOnRevert = true;
        this.chainId = hre.network.config.chainId as number;
        this.state = {
            deployments: [],
            calls: [],
            sends: [],
        };
    }

    public init = async () => {
        //check
        if (this.chainId === undefined) throw 'Invalid Network';

        //load
        await this.load();
    };

    public deploy = async <T>(
        _id: string,
        _name: string,
        _callback: () => T &
            BaseContract & {
                deploymentTransaction(): ContractTransactionResponse;
            }
    ): Promise<T> => {
        //check if id exist
        let d = this.findDeployment(_id);
        if (d !== null) {
            //check for address / mined tx
            if (d.address === undefined) {
                const tx = await ethers.provider.getTransaction(d.txHash);
                const r = await tx!.wait();
                this.setDeploymentAddress(r!.contractAddress!);
                d = this.findDeployment(_id)!;
            }

            //check if it was deployed
            if (d.address !== undefined) {
                //load deployed
                this.log(chalk.blue(`- loading [${chalk.white(_name)}]`));
                const c = await ethers.getContractAt(_name, d.address);
                this.log(chalk.blue(`  - loaded @ [${chalk.white(d.address)}]`));
                return c as T;
            }
        }

        //deploy
        this.log(chalk.blue(`- deploying [${chalk.white(_name)}]`));
        const tx = await _callback();
        this.setDeploymentHash(_id, tx.deploymentTransaction()?.hash!);

        //wait until deployed
        const c = await tx.waitForDeployment();
        this.setDeploymentAddress(_id, await resolveAddress(c.target));
        this.log(chalk.blue(`  - deployed @ [${chalk.white(await resolveAddress(c.target))}]`));

        return c;
    };

    public call = async <T>(_id: string, _name: string, _callback: () => Promise<T>): Promise<T> => {
        //check if id exist
        let c = this.findCall(_id);
        if (c !== null) {
            //return previous result
            this.log(chalk.blue(`- remembering [${chalk.white(_name)}]`));
            return c.result;
        }

        //call
        this.log(chalk.blue(`- calling [${chalk.white(_name)}]`));
        const r = await _callback();
        this.setCallResult(_id, r);

        return r;
    };

    public send = async (
        _id: string,
        _name: string,
        _callback: () => Promise<TransactionResponse>
    ): Promise<boolean> => {
        //check if id exist
        let s = this.findSend(_id);
        if (s !== null) {
            this.log(chalk.blue(`- already executed [${chalk.white(_name)}]`));

            //check for mined tx
            if (!s.success) {
                const tx = await ethers.provider.getTransaction(s.txHash);
                const r = await tx!.wait();
                if (r?.status !== 1) {
                    this.log(chalk.blue(`  - reverted`));
                    if (this.throwOnRevert) throw 'Tx reverted';
                    else return false;
                }
                this.setSendSuccess(_id);
            }

            return true;
        }

        //send
        this.log(chalk.blue(`- send [${chalk.white(_name)}]`));
        const tx = await _callback();
        this.setSendHash(_id, tx.hash);

        //wait until executed
        const r = await tx.wait();
        if (r?.status !== 1) {
            this.log(chalk.blue(`  - reverted`));
            if (this.throwOnRevert) throw 'Tx reverted';
            else return false;
        }
        this.log(chalk.blue(`  - executed`));
        this.setSendSuccess(_id);
        return true;
    };

    /////////////////
    // Deployment Info
    /////////////////

    private findDeployment = (_id: string): ContractDeploymentInfo | null => {
        return this.state.deployments.find(i => i.id === _id) ?? null;
    };

    private setDeploymentHash = (_id: string, _txHash: string) => {
        let i = this.findDeployment(_id);
        if (i === null) {
            i = {
                id: _id,
                txHash: _txHash,
            };
            this.state.deployments.push(i);
        }
        this.save();
        return i;
    };

    private setDeploymentAddress = (_id: string, _address?: string) => {
        let i = this.findDeployment(_id);
        if (i !== null) {
            i.address = _address;
        }
        this.save();
        return i;
    };

    /////////////////
    // Call Info
    /////////////////

    private findCall = (_id: string): ContractCallInfo | null => {
        return this.state.calls.find(i => i.id === _id) ?? null;
    };

    private setCallResult = (_id: string, _result: any) => {
        let i = this.findCall(_id);
        if (i === null) {
            i = {
                id: _id,
                result: _result,
            };
            this.state.calls.push(i);
        }
        this.save();
        return i;
    };

    /////////////////
    // Send Info
    /////////////////

    private findSend = (_id: string): ContractSendInfo | null => {
        return this.state.sends.find(i => i.id === _id) ?? null;
    };

    private setSendHash = (_id: string, _txHash: string) => {
        let i = this.findSend(_id);
        if (i === null) {
            i = {
                id: _id,
                txHash: _txHash,
                success: false,
            };
            this.state.sends.push(i);
        }
        this.save();
        return i;
    };

    private setSendSuccess = (_id: string) => {
        let i = this.findSend(_id);
        if (i !== null) {
            i.success = true;
            this.save();
        }
        return i;
    };

    /////////////////
    // Logs
    /////////////////

    public increaseTabLevel = () => (this.level += 1);
    public decreaseTabLevel = () => (this.level -= 1);

    public log = (_message: string) => {
        if (this.silent) return;

        //tabs
        let tabs = '';
        for (let n = 0; n < this.level; n++) tabs += this.tab;

        //log
        console.log(`${tabs}${_message}`);
    };

    public openCategory = (_title: string, _levels: number = 0) => {
        //levels
        while (_levels < 0) {
            _levels += 1;
            this.decreaseTabLevel();
        }
        while (_levels > 0) {
            _levels -= 1;
            this.increaseTabLevel();
        }

        //log
        this.log(chalk.yellow(`- ${_title}`));
        this.increaseTabLevel();
    };

    public closeCategory = () => {
        this.decreaseTabLevel();
    };

    /////////////////
    // Save / Load
    /////////////////

    public reset = () => {
        //reset state
        this.state = {
            deployments: [],
            calls: [],
            sends: [],
        };
    };

    public load = () => {
        this.reset();
        if (this.chainId === 31337) return; //don't load on hardhat node

        try {
            const data = fs.readFileSync(this.generateSaveFileName());
            const j = JSON.parse(data.toString());
            if (j !== undefined && j.calls !== undefined && j.sends !== undefined && j.deployments !== undefined) {
                this.state = j;
            }
        } catch {}
    };

    public save = () => {
        const data = JSON.stringify(this.state, null, 2);
        fs.mkdirSync(this.generateSaveFilePath(), { recursive: true });
        fs.writeFileSync(this.generateSaveFileName(), data);
    };

    private generateSaveFilePath = () => {
        return `./deploy/deployments/${this.chainId}`;
    };

    private generateSaveFileName = () => {
        return `${this.generateSaveFilePath()}/info.json`;
    };
}
