import chalk from 'chalk';
import fs from 'fs';

import { getArg } from './cmdUtils';

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

export interface SubgraphArgs {
  contracts: string | null | undefined;
  template: string | null | undefined;
  target: string | null | undefined;
  chainId: string | null | undefined;
  chainName: string | null | undefined;
  startBlock: string | null | undefined;
}

const getArgs = (_args: string[]): SubgraphArgs => {
  return {
    contracts: getArg(_args, '--contracts'),
    template: getArg(_args, '--template'),
    target: getArg(_args, '--target'),
    chainId: getArg(_args, '--chainId'),
    chainName: getArg(_args, '--chainName'),
    startBlock: getArg(_args, '--startBlock'),
  };
};

export const generateSubgraphFileFromTemplate = (_silent: boolean = false) => {
  const args = getArgs(process.argv.slice(2));
  return generateSubgraphFileFromTemplateWithConfig(args.contracts!, args.template!, args.target!, _silent);
};

export const generateSubgraphFileFromTemplateWithConfig = (
  _contractsFolder: string,
  _subgraphTemplate: string,
  _subgraphTarget: string,
  _silent: boolean = false
) => {
  // get args
  const args = getArgs(process.argv.slice(2));
  args.contracts = _contractsFolder;
  args.template = _subgraphTemplate;
  args.target = _subgraphTarget;

  run(args, _silent);
  process.exit(0);
};

const run = (_args: SubgraphArgs, _silent: boolean) => {
  // check args
  if (!_args.contracts) {
    console.log(chalk.red('ERROR: Missing --contracts'));
    return;
  }
  if (!_args.template) {
    console.log(chalk.red('ERROR: Missing --template'));
    return;
  }
  if (!_args.target) {
    console.log(chalk.red('ERROR: Missing --target'));
    return;
  }
  if (!_args.chainId) {
    console.log(chalk.red('ERROR: Missing --chainId'));
    return;
  }
  if (!_args.chainName) {
    console.log(chalk.red('ERROR: Missing --chainName'));
    return;
  }
  if (!_args.startBlock) {
    console.log(chalk.red('ERROR: Missing --startBlock'));
    return;
  }

  // execute
  const dh2s = new SubgraphHelper(_args.contracts!, _args.template!, _args.target!);
  dh2s.silent = _silent;
  dh2s.run(parseInt(_args.chainId!), _args.chainName, !_args.startBlock ? undefined : parseInt(_args.startBlock));

  process.exit(0);
};

export class SubgraphHelper {
  private contractsFolder: string;
  private subgraphTemplate: string;
  private subgraphTarget: string;
  private level: number;
  private tab: string;
  public silent: boolean;

  public constructor(_contractsFolder: string, _subgraphTemplate: string, _subgraphTarget: string) {
    this.contractsFolder = _contractsFolder;
    this.subgraphTemplate = _subgraphTemplate;
    this.subgraphTarget = _subgraphTarget;
    this.level = 0;
    this.tab = '  ';
    this.silent = false;
  }

  public run(_chainId: number, _chainName: string, _startBlock: number = 0) {
    this.log(chalk.yellow(`- Write deployment info to subgraph template`));
    this.increaseTabLevel();

    // open subgraph template
    let subgraphData: string = '';
    this.log(chalk.blue(`- loading [${chalk.white('Subgraph Template')}]`));
    try {
      subgraphData = fs.readFileSync(this.subgraphTemplate).toString();
    } catch {
      this.log(chalk.red(`  - No subgraph template found`));
      throw 'No subgraph template found';
    }
    this.log(chalk.blue(`  - loaded [${chalk.white('Subgraph Template')}]`));

    // open deployment
    let deploymentData: ContractDeploymentState;
    this.log(chalk.blue(`- loading [${chalk.white('Deployment Info')}]`));
    try {
      const file = fs.readFileSync(`${this.contractsFolder}/deploy/deployments/${_chainId}/info.json`).toString();
      deploymentData = JSON.parse(file);
    } catch {
      this.log(chalk.red(`  - No deployment found`));
      throw 'No deployment found';
    }
    this.log(chalk.blue(`  - loaded [${chalk.white('Deployment Info')}]`));

    // replace
    this.log(chalk.blue(`- Replacing`));
    {
      // network
      this.log(chalk.blue(`  - Network => [${chalk.white(_chainName)}]`));
      subgraphData = subgraphData.replaceAll('%network%', _chainName);

      // start block
      this.log(chalk.blue(`  - Start Block => [${chalk.white(_startBlock.toFixed(0))}]`));
      subgraphData = subgraphData.replaceAll('%startBlock%', _startBlock.toFixed(0));

      // contracts
      this.log(chalk.blue(`  - Contracts`));
      for (const d of deploymentData.deployments) {
        if (!d.address) continue;
        this.log(chalk.blue(`     - [${d.id}] => [${chalk.white(d.address!)}]`));
        subgraphData = subgraphData.replaceAll(`%${d.id}%`, `'${d.address!}'`);
      }
    }

    // save file
    this.log(chalk.blue(`- Save file`));
    fs.writeFileSync(this.subgraphTarget, subgraphData);
    this.log(chalk.blue(`  - Saved`));
  }

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
}
