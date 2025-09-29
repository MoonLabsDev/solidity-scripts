import chalk from 'chalk';
import fs from 'fs';

import { TransactionResponse, ContractTransactionResponse, BaseContract, resolveAddress } from 'ethers';
import hre from 'hardhat';
import '@nomicfoundation/hardhat-ethers';

export interface ContractDeploymentInfo {
  id: string;
  txHash: string;
  address?: string;
  alternativeInfoFileID?: string;
}

export interface ContractCallInfo {
  id: string;
  result: any;
  alternativeInfoFileID?: string;
}

export interface ContractSendInfo {
  id: string;
  txHash: string;
  success: boolean;
  alternativeInfoFileID?: string;
}

export interface ContractDeploymentState {
  deployments: ContractDeploymentInfo[];
  calls: ContractCallInfo[];
  sends: ContractSendInfo[];
}

type SerializedType = boolean | number | string | SerializedStruct | SerializedTypeInfo | SerializedType[];

interface SerializedStruct {
  [key: string]: SerializedType;
}

interface SerializedTypeInfo {
  value: string | SerializedStruct | SerializedType[];
  $type: 'BigInt' | 'struct' | 'array';
}

export enum DeployHelperWalletProvider {
  Seed = 'seed',
  Ledger = 'ledger',
}

export interface DeployHelperOptions {
  walletProvider?: DeployHelperWalletProvider;
  silent?: boolean;
  throwOnRevert?: boolean;
  hardwareWalletAccountIndex?: number;
}

export class DeployHelper {
  public chainId: number;
  private state: ContractDeploymentState;
  private deployedLog: string[];
  private level: number;
  private tab: string;
  public silent: boolean;
  public throwOnRevert: boolean;
  public forceLoadLocal: boolean = false;
  private walletProvider: DeployHelperWalletProvider;
  private walletProviderBefore: boolean = false;
  private hardwareWalletAccountIndex: number;
  private hardwareWalletAccountIndexBefore: number;
  private alternativeInfoFileID?: string;

  public constructor(_options?: DeployHelperOptions) {
    this.level = 0;
    this.tab = '  ';
    this.silent = _options?.silent ?? false;
    this.throwOnRevert = _options?.throwOnRevert ?? true;
    this.walletProvider = _options?.walletProvider ?? DeployHelperWalletProvider.Seed;
    this.hardwareWalletAccountIndex = _options?.hardwareWalletAccountIndex ?? 0;
    this.hardwareWalletAccountIndexBefore = this.hardwareWalletAccountIndex;
    this.chainId = hre.network.config.chainId as number;
    this.deployedLog = [];
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

  public useAlternativeInfoFileID = (_alternativeInfoFileID?: string) => {
    // check
    if (this.alternativeInfoFileID === _alternativeInfoFileID) return;
    if (_alternativeInfoFileID === 'info' || _alternativeInfoFileID === 'deployed')
      throw 'Invalid alternative info file ID';

    // set
    this.alternativeInfoFileID = _alternativeInfoFileID;
    if (this.alternativeInfoFileID !== undefined) this.loadDeploymentInfo();
  };

  private applyWalletProvider = () => {
    const hreAny = hre as any;
    this.hardwareWalletAccountIndexBefore = hreAny.useHardwareWalletAccountIndex;
    switch (this.walletProvider) {
      case DeployHelperWalletProvider.Ledger:
        this.walletProviderBefore = hreAny.useLedger;
        hreAny.useLedger = true;
        hreAny.useHardwareWalletAccountIndex = this.hardwareWalletAccountIndex;
        break;
    }
  };

  public getDeployerAddress = async () => {
    this.applyWalletProvider();
    const addr = await (await hre.ethers.getSigners())[0].getAddress();
    this.resetWalletProvider();

    return addr;
  };

  private resetWalletProvider = () => {
    const hreAny = hre as any;
    switch (this.walletProvider) {
      case DeployHelperWalletProvider.Ledger:
        hreAny.useLedger = this.walletProviderBefore;
        break;
    }
    hreAny.useHardwareWalletAccountIndex = this.hardwareWalletAccountIndexBefore;
  };

  public load = async <T>(_id: string, _name: string): Promise<T> => {
    //check if id exist
    let d = this.findDeployment(_id);
    if (d !== null) {
      //check for address / mined tx
      if (d.address === undefined) {
        const tx = await hre.ethers.provider.getTransaction(d.txHash);
        if (tx !== null) {
          const r = await tx!.wait();
          this.setDeploymentAddress(_id, null, r!.contractAddress!);
          d = this.findDeployment(_id)!;
        }
      }

      //check if it was deployed
      if (d.address !== undefined) {
        //load deployed
        this.log(chalk.blue(`- loading [${chalk.white(_name)}]`));
        this.applyWalletProvider();
        try {
          const c = await hre.ethers.getContractAt(_name, d.address);
          this.resetWalletProvider();
          this.log(chalk.blue(`  - loaded @ [${chalk.white(d.address)}]`));
          return c as T;
        } catch (e) {
          this.resetWalletProvider();
          throw e;
        }
      }
    }

    // could not load
    this.error(`  - No deployment found`);
    throw 'No deployment found';
  };

  public loadWithAddress = async <T>(_address: string, _name: string): Promise<T> => {
    //load deployed
    this.log(chalk.blue(`- loading [${chalk.white(_name)}]`));
    this.applyWalletProvider();
    try {
      const c = await hre.ethers.getContractAt(_name, _address);
      this.resetWalletProvider();
      this.log(chalk.blue(`  - loaded @ [${chalk.white(_address)}]`));
      return c as T;
    } catch (e) {
      this.error(`  - Could not load contract`);
      this.resetWalletProvider();
      throw e;
    }
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
        if (tx !== null) {
          const r = await tx!.wait();
          this.setDeploymentAddress(_id, _log ?? _name, r!.contractAddress);
          d = this.findDeployment(_id)!;
        }
      }

      //check if it was deployed
      if (d.address !== undefined) {
        //load deployed
        this.log(chalk.blue(`- loading [${chalk.white(_log ?? _name)}]`));
        this.applyWalletProvider();
        try {
          const c = await hre.ethers.getContractAt(_name, d.address);
          this.resetWalletProvider();
          this.log(chalk.blue(`  - loaded @ [${chalk.white(d.address)}]`));
          return c as T;
        } catch (e) {
          this.resetWalletProvider();
          throw e;
        }
      }
    }

    //deploy
    try {
      //deploy
      this.log(chalk.blue(`- deploying [${chalk.white(_log ?? _name)}]`));
      this.applyWalletProvider();
      const tx = await _callback();
      this.resetWalletProvider();
      this.setDeploymentHash(_id, tx.deploymentTransaction()?.hash!);

      //wait until deployed
      const c = await tx.waitForDeployment();
      this.setDeploymentAddress(_id, _log ?? _name, await resolveAddress(c.target));
      this.log(chalk.blue(`  - deployed @ [${chalk.white(await resolveAddress(c.target))}]`));

      return c;
    } catch (e) {
      this.resetWalletProvider();
      throw e;
    }
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
        if (tx !== null) {
          try {
            const r = await tx!.wait();
            if (r?.status === 1) {
              this.setSendSuccess(_id);
              return true;
            }
            throw 'Tx reverted';
          } catch {
            this.error(`  - reverted`);
            // try again
            retry = true;
          }
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
      this.error(`  - reverted`);
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
        alternativeInfoFileID: this.alternativeInfoFileID,
      };
      this.state.deployments.push(i);
    }
    this.saveDeploymentInfo();
    return i;
  };

  private setDeploymentAddress = (
    _id: string,
    _deploymentString: string | null,
    _address?: string | null
  ): ContractDeploymentInfo | null => {
    if (_address === null) return null;

    // info
    let i = this.findDeployment(_id);
    if (i !== null) i.address = _address;

    // deployed log
    if (_deploymentString !== null && _address !== undefined)
      this.deployedLog.push(`${_deploymentString} = [${_address}]`);

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
        alternativeInfoFileID: this.alternativeInfoFileID,
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
        alternativeInfoFileID: this.alternativeInfoFileID,
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

  public warn = (_message: string) => {
    this.log(chalk.yellow(_message));
  };

  public error = (_message: string) => {
    this.log(chalk.red(_message));
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
    } else if (Array.isArray(_data)) {
      return {
        value: _data.map(i => this.serializeCallResult(i)) as SerializedType[],
        $type: 'array',
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

        case 'array':
          return (ct.value as SerializedType[]).map(i => this.deserializeCallResult(i));

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
    this.deployedLog = [];
    this.state = {
      deployments: [],
      calls: [],
      sends: [],
    };
  };

  public loadDeploymentInfo = (_merge: boolean = false) => {
    if (!_merge) {
      this.resetDeploymentInfo();
      if (this.chainId === 31337 && !this.forceLoadLocal) return; //don't load on hardhat node
    }

    // info
    try {
      const data = fs.readFileSync(this.generateInfoFileName());
      const j = JSON.parse(data.toString());
      if (j !== undefined && j.calls !== undefined && j.sends !== undefined && j.deployments !== undefined) {
        // set state
        if (_merge) {
          // merge & add alternativeInfoFileID to all items
          this.state.deployments = [
            ...this.state.deployments.map(i => ({ ...i, alternativeInfoFileID: this.alternativeInfoFileID })),
            ...j.deployments,
          ];
          this.state.calls = [
            ...this.state.calls.map(i => ({ ...i, alternativeInfoFileID: this.alternativeInfoFileID })),
            ...j.calls,
          ];
          this.state.sends = [
            ...this.state.sends.map(i => ({ ...i, alternativeInfoFileID: this.alternativeInfoFileID })),
            ...j.sends,
          ];
        } else {
          this.state = j;
        }
      }
    } catch {}
  };

  public saveDeploymentInfo = () => {
    fs.mkdirSync(this.generateSaveFilePath(), { recursive: true });

    // write info file but only for current infoFile & remove alternativeInfoFileID
    fs.writeFileSync(
      this.generateInfoFileName(),
      JSON.stringify(
        {
          deployments:
            this.state.deployments
              ?.filter(i => i.alternativeInfoFileID === this.alternativeInfoFileID)
              .map(i => ({ ...i, alternativeInfoFileID: undefined })) ?? [],
          calls:
            this.state.calls
              ?.filter(i => i.alternativeInfoFileID === this.alternativeInfoFileID)
              .map(i => ({ ...i, alternativeInfoFileID: undefined })) ?? [],
          sends:
            this.state.sends
              ?.filter(i => i.alternativeInfoFileID === this.alternativeInfoFileID)
              .map(i => ({ ...i, alternativeInfoFileID: undefined })) ?? [],
        },
        null,
        2
      )
    );

    // override deploy log
    fs.writeFileSync(this.generateDeployFileName(), JSON.stringify(this.deployedLog, null, 2));
  };

  private generateSaveFilePath = () => {
    return `./deploy/deployments/${this.chainId}`;
  };

  private generateInfoFileName = () => {
    return `${this.generateSaveFilePath()}/${this.alternativeInfoFileID ?? 'info'}.json`;
  };

  private generateDeployFileName = () => {
    return `${this.generateSaveFilePath()}/deployed.json`;
  };
}
