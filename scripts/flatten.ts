import chalk from 'chalk';
import fs from 'fs';

import { getArg } from './cmdUtils';

export interface ConfigDependency {
  [key: string]: string;
}

export interface ResolveConfig {
  isYarn: boolean;
  deps: {
    dependencies: ConfigDependency | undefined;
    devDependencies: ConfigDependency | undefined;
  };
  nodeModulesPath: string;
}

export interface FileImport {
  content: string;
  meta: string;
  imports: string[];
  inherits: string[];
}

export interface ResolvedImportInfo {
  path: string;
  file: string;
  content: string | null;
  meta: string | null;
  requires: string[];
  inherits: string[];
}

export interface ImportInfo extends ResolvedImportInfo {
  level: number;
}

export interface FlatJSONSource {
  [key: string]: { content: string };
}

export interface FlatJSON {
  language: 'Solidity';
  sources: FlatJSONSource;
  settings: {
    optimizer: {
      enabled: boolean;
      runs: number;
    };
    evmVersion: string;
  };
}

export interface FlattenArgs {
  file: string | null | undefined;
  out: string | null | undefined;
  outAuto: string | null | undefined;
  evmVersion: string | null | undefined;
}

export type SolidityEVMVersion =
  | 'petersburg'
  | 'istanbul'
  | 'berlin'
  | 'london'
  | 'paris'
  | 'shanghai'
  | 'cancun'
  | 'prague';

const getArgs = (_args: string[]): FlattenArgs => {
  return {
    file: getArg(_args, '--file'),
    out: getArg(_args, '--out'),
    outAuto: getArg(_args, '--outAuto'),
    evmVersion: getArg(_args, '--evmVersion'),
  };
};

const lb = '\r\n';

const flattenConfig = {
  disableLog: true,
  silentResolve: true,
};

export const flatten = (_silent = true, _isYarn = true) => {
  flattenFile(getArgs(process.argv.slice(2)), _silent, _isYarn);
  process.exit(0);
};

export const batchFlatten = (
  _args: FlattenArgs[],
  _evmVersion: SolidityEVMVersion = 'paris',
  _silent = true,
  _isYarn = true
) => {
  for (let a of _args) flattenFile({ ...a, evmVersion: _evmVersion }, _silent, _isYarn);
  process.exit(0);
};

const flattenFile = (args: FlattenArgs, _silent = true, _isYarn = true) => {
  flattenConfig.disableLog = _silent;

  //start
  log(chalk.blue(`============================================================`));

  //load args
  log(`- Loading args`);
  log(args);

  //checking args
  if (!args.file) {
    log(chalk.red('ERROR: Missing --file'));
    return;
  }
  if (!args.out && !args.outAuto) {
    log(chalk.red('ERROR: Missing --out or --outAuto'));
    return;
  }

  //get resolve config
  log(chalk.yellow('- Get config'));
  const resolveCfg = getResolveConfig();
  log(chalk.white(`   - Is ${resolveCfg.isYarn ? 'Yarn' : 'NPM'}`));

  //resolve imports
  const dict: ImportInfo[] = [];
  log(chalk.yellow('- Resolving'));
  const fc_dl_before = flattenConfig.disableLog;
  flattenConfig.disableLog = flattenConfig.silentResolve;
  const d = resolveFileImports(resolveCfg, args.file, dict);
  flattenConfig.disableLog = fc_dl_before;

  //dependency list
  log(chalk.yellow('- Dependency'));
  makeDependencyList(dict);

  //flatten
  if (!args.out && args.outAuto) {
    const sub = typeof args.outAuto === 'string' ? args.outAuto : '';
    args.out = `./flat/${sub}/${d.file.replace('.sol', '')}`;
  }
  if (args.out) {
    //get name
    const fOut = args.out.replaceAll('\\', '/');
    const out = fOut.indexOf('/') === -1 ? '' : fOut.substring(0, fOut.lastIndexOf('/'));
    const outName = getFileName(fOut);
    if (!fs.existsSync(out)) {
      fs.mkdirSync(out, { recursive: true });
    }
    const fullPath = `${fs.realpathSync(out).replaceAll('\\', '/')}/${outName}`;
    const fullOut = `${fullPath}/${outName}`;
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }

    //info
    log(chalk.yellow(`- Info to [${fullOut}.info.json]`));
    fs.writeFileSync(
      fullOut + '.info.json',
      JSON.stringify(
        dict.map(d => {
          return { path: d.path, level: d.level };
        }),
        undefined,
        '\t'
      )
    );

    //flat
    log(chalk.yellow(`- Flattening to [${fullOut}.sol]`));
    makeFlatFile(fullOut + '.sol', d, dict);

    //json
    log(chalk.yellow(`- Standard-Json-Input to [${fullOut}.json]`));
    makeJsonFile(fullOut + '.json', !args.evmVersion ? 'paris' : (args.evmVersion as SolidityEVMVersion), d, dict);

    //minimal output when silent
    if (flattenConfig.disableLog) console.log(chalk.yellow(`- flattened [${args.file}]`));
  }

  //end
  log(chalk.blue(`============================================================`));
};

const log = (_text: any) => {
  if (!flattenConfig.disableLog) console.log(_text);
};

const getResolveConfig = (): ResolveConfig => {
  //check for YARN
  let isYarn = false;
  let nodeModulesPath = fs.existsSync('./node_modules/')
    ? fs.realpathSync('./node_modules/').replaceAll('\\', '/')
    : '';
  {
    //find .yarnrc.yml
    let path = fs.realpathSync('./').replaceAll('\\', '/');
    let cfgPath = null;
    do {
      const p = `${path}/.yarnrc.yml`;
      if (fs.existsSync(p)) {
        cfgPath = fs.realpathSync(path).replaceAll('\\', '/');
        break;
      }
      path = fs.realpathSync(`${path}/../`).replaceAll('\\', '/');
    } while (path.indexOf('/') !== -1);

    //make yarn path
    let yarnModules = 'node_modules';
    nodeModulesPath = fs.realpathSync(`${cfgPath}/${yarnModules}/`).replaceAll('\\', '/');
    isYarn = true;
  }

  //read package
  const packageCfg = JSON.parse(fs.readFileSync(fs.realpathSync('./package.json')).toString());
  const deps = {
    ...(packageCfg.dependencies ? packageCfg.dependencies : {}),
    ...(packageCfg.devDependencies ? packageCfg.devDependencies : {}),
  };

  return {
    isYarn,
    deps,
    nodeModulesPath,
  };
};

const getFileName = (_path: string) => {
  return _path.replaceAll('\\', '/').substring(_path.lastIndexOf('/') === -1 ? 0 : _path.lastIndexOf('/') + 1);
};

const makeShortImports = (_data: ResolvedImportInfo) => {
  return _data.requires.map(r => `import "${getFileName(r)}"`).join(lb);
};

//docs: https://docs.soliditylang.org/en/latest/using-the-compiler.html#input-description
const makeJsonFile = (
  _target: string,
  _evmVersion: SolidityEVMVersion,
  _data: ResolvedImportInfo,
  _importDictionary: ImportInfo[]
) => {
  //make default
  const json: FlatJSON = {
    language: 'Solidity',
    sources: {
      /* ... */
    },
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      evmVersion: _evmVersion,
    },
  };

  //load compiler_config
  try {
    const settings = JSON.parse(fs.readFileSync('./compiler_config.json').toString())?.settings;
    json.settings = settings ?? json.settings;
  } catch (e) {}

  //sources
  json.sources[_data.file] = { content: `${_data.meta}${lb}${lb}${makeShortImports(_data)}${lb}${lb}${_data.content}` };
  _importDictionary.forEach(
    i => (json.sources[i.file] = { content: `${i.meta}${lb}${lb}${makeShortImports(i)}${lb}${lb}${i.content}` })
  );

  //write
  if (_target) {
    fs.writeFileSync(_target, JSON.stringify(json, undefined, '\t'));
  }

  return json;
};

const makeFlatFile = (_target: string, _data: ResolvedImportInfo, _importDictionary: ImportInfo[]) => {
  //highest level first
  _importDictionary.sort((a, b) => b.level - a.level);

  //flatten
  const flatImports = _importDictionary.reduce((p, c) => {
    return p + `//File: [${c.file}]${lb}${lb}${c.content}${lb}${lb}`;
  }, '');
  const flat = _data.meta + lb + lb + flatImports + _data.content;

  //write
  if (_target) {
    fs.writeFileSync(_target, flat);
  }

  return flat;
};

const removeDependency = (_importDictionary: ImportInfo[], _dependency: string) => {
  _importDictionary.forEach(i => {
    if (i.requires.includes(_dependency)) i.requires.splice(i.requires.indexOf(_dependency), 1);
  });
};

const makeDependencyList = (_importDictionary: ImportInfo[]) => {
  const deps: ImportInfo[] = [];
  let round = 0;
  while (_importDictionary.length > 0) {
    log(chalk.blue(`   - Round [${round}]`));

    //find without dependency
    let noDeps = _importDictionary.filter(i => i.requires.length === 0);
    noDeps.forEach(d => log(chalk.yellow(`      - NoDeps [${d.file}]`)));
    if (noDeps.length === 0) {
      //check inherits
      noDeps = _importDictionary.filter(i => i.inherits.length === 0);
      if (noDeps.length === 0) {
        log('ERROR:');
        log(
          _importDictionary.map(i => ({
            id: i.file,
            dependency: i.requires,
            inherits: i.inherits,
          }))
        );
        throw false;
      }
      noDeps.forEach(d => log(chalk.red(`      - NoInherit [${d.file}]`)));
    }

    noDeps.forEach(d => deps.push(d));

    //remove from list
    noDeps.forEach(d => _importDictionary.splice(_importDictionary.indexOf(d), 1));
    noDeps.forEach(d => removeDependency(_importDictionary, d.path));

    round += 1;
  }

  for (let n = 0; n < deps.length; n++) {
    deps[n].level = deps.length - n;
  }
  deps.sort((a, b) => a.level - b.level);
  deps.forEach(d => _importDictionary.push(d));
  return deps;
};

const resolveFileImports = (
  _resolveCfg: ResolveConfig,
  _file: string,
  _importDictionary: ImportInfo[] = [],
  _level: number = 0,
  _parentImports: ImportInfo[] = []
): ResolvedImportInfo => {
  const fPath = fs.realpathSync(_file).replaceAll('\\', '/');
  log(chalk.yellow(`   - Resolving [${fPath}]`));
  log(chalk.blue(`      - reading`));
  const data = getFileImports(_resolveCfg, fPath);
  log(chalk.green(`         - complete`));
  const resolve: string[] = [];
  const myImports: ImportInfo[] = [];

  //check level/resolve
  log(chalk.blue(`      - import levels`));
  data.imports.forEach(i => {
    const match = _importDictionary.find(m => m.path === i);
    if (match) {
      //check level
      match.level = Math.max(match.level, _level);
    } else {
      //resolve file
      resolve.push(i);
    }
  });
  log(chalk.green(`         - complete`));

  //resolve unresolved
  if (resolve.length > 0) {
    log(chalk.blue(`      - resolve children: [${_level}]`));
    resolve.forEach(r => {
      const i = {
        path: r,
        file: getFileName(r),
        content: null,
        meta: null,
        level: _level,
        requires: [],
        inherits: [],
      };
      myImports.push(i);
      _importDictionary.push(i);
    });
    myImports.forEach(i => {
      const d = resolveFileImports(_resolveCfg, i.path, _importDictionary, _level + 1);
      i.content = d.content;
      i.meta = d.meta;
      i.requires = d.requires;
      i.inherits = d.inherits;
    });
    log(chalk.green(`         - complete`));
  }

  _importDictionary.sort((a, b) => a.level - b.level);
  return {
    path: fPath,
    file: getFileName(fPath),
    content: data.content,
    meta: data.meta,
    requires: data.imports,
    inherits: data.inherits,
  };
};

const getFileImports = (_resolveCfg: ResolveConfig, _file: string): FileImport => {
  const read = fs.readFileSync(_file);
  const lines = read.toString().replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
  const imports: string[] = [];
  const content: string[] = [];
  const meta = [];
  const fPath = _file.replaceAll('\\', '//');
  const path = fPath.indexOf('/') === -1 ? '' : fPath.substring(0, fPath.lastIndexOf('/'));

  //collect imports
  for (let n = 0; n < lines.length; n++) {
    const l = lines[n];
    if (l.indexOf('import') === 0) {
      let importLine = l;

      //gather import lines
      while (!importLine.includes(';')) {
        n += 1;
        importLine += lines[n];
      }

      //import
      importLine = importLine.replaceAll("'", '"');
      const iStart = importLine.indexOf('"');
      const iEnd = importLine.indexOf('"', iStart + 1);
      const iPath = importLine.substring(iStart + 1, iEnd).replaceAll('\\', '/');
      if (iPath[0] === '@') {
        //node_modules
        const rPath = fs.realpathSync(_resolveCfg.nodeModulesPath + '/' + iPath);
        imports.push(rPath.replaceAll('\\', '/'));
      } else if (iPath[0] === '.' && iPath[1] === '/') {
        //resolve relative
        const rPath = fs.realpathSync(path + '/' + iPath.substring(2));
        imports.push(rPath.replaceAll('\\', '/'));
      } else {
        //resolve relative
        const rPath = fs.realpathSync(path + '/' + iPath);
        imports.push(rPath.replaceAll('\\', '/'));
      }
    } else {
      //content
      if (l.includes('SPDX-License')) {
        //license
        meta.push(l);
      } else if (l.includes('pragma solidity')) {
        //pragma
        meta.push(l);
      } else {
        //content
        content.push(l);
      }
    }
  }

  //trim content
  while (content.length > 0 && content[0] === '') {
    content.splice(0, 1);
  }
  while (content.length > 0 && content[content.length - 1] === '') {
    content.splice(content.length - 1, 1);
  }

  //remove multiple entries
  const uniqueImports: string[] = [];
  for (let n = 0; n < imports.length; n++) {
    if (!uniqueImports.includes(imports[n])) uniqueImports.push(imports[n]);
  }

  //return
  return {
    content: content.join('\r\n'),
    meta: meta.join('\r\n'),
    imports: uniqueImports,
    inherits: findInheritance(read.toString()),
  };
};

const findInheritance = (_content: string): string[] => {
  const lines = _content.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
  let firstFound = false;
  let inheritStr = '';
  let iStart = 0;
  let bStart = 0;
  let endFound = false;
  for (let n = 0; n < lines.length; n++) {
    const l = lines[n];

    //check
    let cStart = 0;
    if (!firstFound) {
      if (l.indexOf('library ') === 0) {
        break;
      } else if (l.indexOf('import ') !== 0 && l.indexOf('contract') !== -1) {
        firstFound = true;
        cStart = l.indexOf('contract ') + 8;
      }
    }
    if (!firstFound) {
      continue;
    }

    //find
    iStart = l.indexOf(' is', cStart);
    bStart = l.indexOf('{', cStart);
    if (iStart === -1 && bStart === -1) {
      inheritStr += l.substring(cStart);
      continue;
    }
    if (!endFound && (bStart !== -1 || iStart !== -1)) {
      endFound = true;
      if (bStart > iStart) {
        return [];
      }
    }
    inheritStr += l.substring(iStart === -1 ? 0 : iStart + 3, bStart === -1 ? undefined : bStart);

    if (endFound) {
      break;
    }
  }

  //get inheritance list
  const inheritsList = inheritStr
    .substring(iStart + 3, bStart)
    .replaceAll(' ', '')
    .replaceAll('\t', '')
    .replaceAll('\r', '')
    .replaceAll('\n', '');
  if (inheritsList === '') {
    return [];
  }
  const inherits = inheritsList.split(',');
  log(inherits);

  return inherits;
};

export default flatten;
