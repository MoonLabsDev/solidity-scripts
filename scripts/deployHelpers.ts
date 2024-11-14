import hre from 'hardhat';
import '@nomicfoundation/hardhat-ethers';
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

type SerializedType = boolean | number | string | SerializedStruct | SerializedTypeInfo;

interface SerializedStruct {
  [key: string]: SerializedType;
}

interface SerializedTypeInfo {
  value: string | SerializedStruct;
  $type: 'BigInt' | 'struct';
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
    await this.loadDeploymentInfo();
  };

  public load = async <T>(_id: string, _name: string): Promise<T> => {
    //check if id exist
    let d = this.findDeployment(_id);
    if (d !== null) {
      //check for address / mined tx
      if (d.address === undefined) {
        const tx = await hre.ethers.provider.getTransaction(d.txHash);
        const r = await tx!.wait();
        this.setDeploymentAddress(r!.contractAddress!);
        d = this.findDeployment(_id)!;
      }

      //check if it was deployed
      if (d.address !== undefined) {
        //load deployed
        this.log(chalk.blue(`- loading [${chalk.white(_name)}]`));
        const c = await hre.ethers.getContractAt(_name, d.address);
        this.log(chalk.blue(`  - loaded @ [${chalk.white(d.address)}]`));
        return c as T;
      }
    }

    // could not load
    this.log(chalk.red(`  - No deployment found`));
    throw 'No deployment found';
  };

  public loadWithAddress = async <T>(_address: string, _name: string): Promise<T> => {
    //load deployed
    this.log(chalk.blue(`- loading [${chalk.white(_name)}]`));
    try {
      const c = await hre.ethers.getContractAt(_name, _address);
      this.log(chalk.blue(`  - loaded @ [${chalk.white(_address)}]`));
      return c as T;
    } catch {}

    // could not load
    this.log(chalk.red(`  - Could not load contract`));
    throw 'Could not load contract';
  };

  public deploy = async <T>(
    _id: string,
    _name: string,
    _callback: () => T &
      BaseContract & {
        deploymentTransaction(): ContractTransactionResponse;
      },
    _log?: string
  ): Promise<T> => {
    //check if id exist
    let d = this.findDeployment(_id);
    if (d !== null) {
      //check for address / mined tx
      if (d.address === undefined) {
        const tx = await hre.ethers.provider.getTransaction(d.txHash);
        const r = await tx!.wait();
        this.setDeploymentAddress(r!.contractAddress!);
        d = this.findDeployment(_id)!;
      }

      //check if it was deployed
      if (d.address !== undefined) {
        //load deployed
        this.log(chalk.blue(`- loading [${chalk.white(_log ?? _name)}]`));
        const c = await hre.ethers.getContractAt(_name, d.address);
        this.log(chalk.blue(`  - loaded @ [${chalk.white(d.address)}]`));
        return c as T;
      }
    }

    //deploy
    this.log(chalk.blue(`- deploying [${chalk.white(_log ?? _name)}]`));
    const tx = await _callback();
    this.setDeploymentHash(_id, tx.deploymentTransaction()?.hash!);

    //wait until deployed
    const c = await tx.waitForDeployment();
    this.setDeploymentAddress(_id, await resolveAddress(c.target));
    this.log(chalk.blue(`  - deployed @ [${chalk.white(await resolveAddress(c.target))}]`));

    return c;
  };

  public call = async <T>(_id: string, _log: string, _callback: () => Promise<T>): Promise<T> => {
    //check if id exist
    let c = this.findCall(_id);
    if (c !== null) {
      //return previous result
      this.log(chalk.blue(`- remembering [${chalk.white(_log)}]`));
      return this.deserializeCallResult(c.result);
    }

    //call
    this.log(chalk.blue(`- calling [${chalk.white(_log)}]`));
    const r = await _callback();
    this.setCallResult(_id, r);

    return r;
  };

  public send = async (_id: string, _log: string, _callback: () => Promise<TransactionResponse>): Promise<boolean> => {
    //check if id exist
    let s = this.findSend(_id);
    let retry = false;
    if (s !== null) {
      this.log(chalk.blue(`- already executed [${chalk.white(_log)}]`));
      //check for mined tx
      if (!s.success) {
        const tx = await hre.ethers.provider.getTransaction(s.txHash);
        try {
          const r = await tx!.wait();
          if (r?.status === 1) {
            this.setSendSuccess(_id);
            return true;
          }
          throw 'Tx reverted';
        } catch {
          this.log(chalk.red(`  - reverted`));
          // try again
          retry = true;
        }
      } else return true;
    }

    //send
    this.log(chalk.blue(`- send ${retry ? '(retry) ' : ''}[${chalk.white(_log)}]`));
    const tx = await _callback();
    this.setSendHash(_id, tx.hash);

    //wait until executed
    try {
      const r = await tx!.wait();
      if (r?.status !== 1) throw 'Tx reverted';
    } catch {
      this.log(chalk.red(`  - reverted`));
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
    this.saveDeploymentInfo();
    return i;
  };

  private setDeploymentAddress = (_id: string, _address?: string) => {
    let i = this.findDeployment(_id);
    if (i !== null) {
      i.address = _address;
    }
    this.saveDeploymentInfo();
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
        result: this.serializeCallResult(_result),
      };
      this.state.calls.push(i);
    }
    this.saveDeploymentInfo();
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
    this.saveDeploymentInfo();
    return i;
  };

  private setSendSuccess = (_id: string) => {
    let i = this.findSend(_id);
    if (i !== null) {
      i.success = true;
      this.saveDeploymentInfo();
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
  // Serialize / Deserialize Calls
  /////////////////

  private serializeCallResult = (_data: any): SerializedType => {
    // value
    if (typeof _data === 'number' || typeof _data === 'string' || typeof _data === 'boolean') {
      return _data;
    } else if (_data instanceof BigInt || typeof _data === 'bigint') {
      return {
        value: _data.toString(10),
        $type: 'BigInt',
      };
    } else {
      // struct
      const keys = Object.keys(_data);
      const struct: SerializedStruct = {};
      for (let k of keys) struct[k] = this.serializeCallResult(_data[k]);
      return {
        value: struct,
        $type: 'struct',
      };
    }
  };

  private deserializeCallResult = (_data: SerializedType): any => {
    if (typeof _data === 'object') {
      // complex type
      const ct = _data as SerializedTypeInfo;
      switch (ct.$type) {
        case 'BigInt':
          return BigInt(ct.value as string);

        case 'struct': {
          const obj: SerializedStruct = {};
          const struct = ct.value as SerializedStruct;
          const keys = Object.keys(struct);
          for (let k of keys) {
            obj[k] = this.deserializeCallResult(struct[k]);
          }
          return obj;
        }
      }
      return null;
    } else {
      // simple type
      return _data;
    }
  };

  /////////////////
  // Save / Load
  /////////////////

  public resetDeploymentInfo = () => {
    //reset state
    this.state = {
      deployments: [],
      calls: [],
      sends: [],
    };
  };

  public loadDeploymentInfo = () => {
    this.resetDeploymentInfo();
    if (this.chainId === 31337) return; //don't load on hardhat node

    try {
      const data = fs.readFileSync(this.generateSaveFileName());
      const j = JSON.parse(data.toString());
      if (j !== undefined && j.calls !== undefined && j.sends !== undefined && j.deployments !== undefined) {
        this.state = j;
      }
    } catch {}
  };

  public saveDeploymentInfo = () => {
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
