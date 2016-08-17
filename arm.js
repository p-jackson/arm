#!/usr/local/bin/node
'uses strict';

const program = require('commander');
const chalk = require('chalk');
const fs = require('fs');
const childProcess = require('child_process');
const path = require('path');

const armConfigFilename = 'arm.json'; // stored in nest directory
const armRootFilename = '.arm-root.json'; // stored in root directory

let gRecognisedCommand = false; // Seems there should be a tidier way...

const my = {
  errorColour: (text) => chalk.red(text),
  commandColour: (text) => chalk.blue(text),
};


function terminate(message) {
  console.log(my.errorColour(`Error: ${message}`));
  process.exit(1);
}


function fileExistsSync(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch (err) {
    if (err.code === 'ENOENT') {
      return false;
    }
    throw err;
  }
}


function dirExistsSync(filePath) {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch (err) {
    if (err.code === 'ENOENT') {
      return false;
    }
    throw err;
  }
}


// Do the command handling ourselves so user can see command output as it occurs
// for the possibly long running commands.

function runCommandChain(commandList, tailCallback) {
  if (commandList.length === 0) return;

  const command = commandList.shift();
  if (command.args === undefined) command.args = [];
  let cwdDisplay = `${command.cwd}: `;
  if (command.cwd === undefined) {
    cwdDisplay = '';
    command.cwd = '.';
  }

  console.log(chalk.blue(`${cwdDisplay}${command.cmd} ${command.args.join(' ')}`));

  const child = childProcess.spawn(command.cmd, command.args, { cwd: command.cwd });
  // Using process.stdout.write to avoid getting extra line feeds.
  child.stdout.on('data', (buffer) => { process.stdout.write(buffer.toString()); });
  child.stderr.on('data', (buffer) => { process.stdout.write(buffer.toString()); });
  child.on('close', (code) => { // eslint-disable-line no-unused-vars, passed code
    console.log(''); // blank line after command output
    if (commandList.length > 0) {
      runCommandChain(commandList, tailCallback);
    } else if (tailCallback !== undefined) {
      tailCallback();
    }
  });
}


// function execCommand(cmd, args) {
//   childProcess.execFile(cmd, args, (error, stdout, stderr) => {
//     console.log(my.commandColour(`${cmd} ${args.join(' ')}`));
//     if (error) {
//       console.log(my.errorColour(stderr));
//     } else {
//       console.log(stdout);
//     }
//   });
// }


// function execCommandSync(cmd, args) {
//   console.log(my.commandColour(`${cmd} ${args.join(' ')}`));
//   const commandOutput = childProcess.execFileSync(cmd, args).toString().trim();
//   console.log(commandOutput);
// }


function readConfigDirPath() {
  const armRootPath = path.resolve(armRootFilename);
  const data = fs.readFileSync(armRootPath);
  let rootObject;
  try {
    rootObject = JSON.parse(data);
  } catch (err) {
    terminate(`problem parsing ${armRootPath}\n${err}`);
  }
  if (rootObject.configurationDirectory === undefined) {
    terminate(`problem parsing: ${armRootPath}\nmissing field 'configurationDirectory'`);
  }
  return rootObject.configurationDirectory;
}


function cdRootDirectory() {
  const startedInConfigDirectory = fileExistsSync(armConfigFilename);

  let tryParent = true;
  do {
    if (fileExistsSync(armRootFilename)) {
      readConfigDirPath(); // Sanity check
      return;
    }

    // NB: chdir('..') from '/' silently does nothing on Mac,so check we moved
    const cwd = process.cwd();
    process.chdir('..');
    tryParent = (cwd !== process.cwd());
  } while (tryParent);

  if (startedInConfigDirectory) {
    terminate('root of forest not found. (Do you need to call "arm init"?)');
  } else {
    terminate('root of forest not found. ');
  }
}


function readConfigDependencies(addMaster) {
  // Assuming already called cd to root directory
  const masterDirectoryName = readConfigDirPath();
  const configPath = path.resolve(masterDirectoryName, armConfigFilename);

  let data;
  try {
    data = fs.readFileSync(configPath);
  } catch (err) {
    terminate(`problem opening ${configPath}\n${err}`);
  }

  let configObject;
  try {
    configObject = JSON.parse(data);
  } catch (err) {
    terminate(`problem parsing ${configPath}\n${err}`);
  }
  if (configObject.dependencies === undefined) {
    terminate(`problem parsing: ${configPath}\nmissing field 'dependencies'`);
  }
  if (addMaster) configObject.dependencies[masterDirectoryName] = masterDirectoryName;

  return configObject.dependencies;
}


function doStatus() {
  const dependencies = readConfigDependencies(true);

  const commandList = [];
  Object.keys(dependencies).forEach((repoPath) => {
    if (dirExistsSync(path.join(repoPath, '.hg'))) {
      commandList.push({
        cmd: 'hg', args: ['status'], cwd: repoPath,
      });
    } else {
      commandList.push({
        cmd: 'git', args: ['status', '--short'], cwd: repoPath,
      });
    }
  });
  runCommandChain(commandList);
}


function doOutgoing() {
  const dependencies = readConfigDependencies(true);

  const commandList = [];
  Object.keys(dependencies).forEach((repoPath) => {
    if (dirExistsSync(path.join(repoPath, '.hg'))) {
      commandList.push({
        cmd: 'hg', args: ['outgoing'], cwd: repoPath,
      });
    } else {
      commandList.push({
        cmd: 'git', args: ['log', '@{u}..'], cwd: repoPath,
      });
    }
  });
  runCommandChain(commandList);
}


function isGitRemote(origin) {
  // Hardcore: git ls-remote ${origin}

  // Check local path for .git directory
  if (origin.indexOf(':') === -1) {
    return dirExistsSync(path.resolve(origin, '.git'));
  }

  // KISS
  if (origin.indexOf('git') !== -1) {
    return true;
  }

  return false;
}


function isHgRemote(origin) {
  // Hardcore: hg id ${origin}

  // Check local path for .hg directory
  if (origin.indexOf(':') === -1) {
    return dirExistsSync(path.resolve(origin, '.hg'));
  }

  // KISS unless proves inadequate.
  if (origin.indexOf('hg') !== -1) {
    return true;
  }

  return false;
}


function doInstall() {
  const dependencies = readConfigDependencies(false);

  const commandList = [];
  Object.keys(dependencies).forEach((repoPath) => {
    const origin = dependencies[repoPath];
    if (dirExistsSync(repoPath)) {
      console.log(`Skipping already present dependency: ${repoPath}`);
    } else if (isGitRemote(origin)) {
      commandList.push({
        cmd: 'git', args: ['clone', origin, repoPath],
      });
    } else if (isHgRemote(origin)) {
      commandList.push({
        cmd: 'hg', args: ['clone', origin, repoPath],
      });
    } else {
      console.error(`Skipping unknown remote repository type: ${origin}`);
    }
  });
  runCommandChain(commandList);
}


function findRepositories(startingDirectory, callback) {
  const itemList = fs.readdirSync(startingDirectory);
  itemList.forEach((item) => {
    const itemPath = path.join(startingDirectory, item);
    if (dirExistsSync(itemPath)) {
      if (dirExistsSync(path.join(itemPath, '.git'))) {
        const origin = childProcess.execFileSync(
          'git', ['-C', itemPath, 'config', '--get', 'remote.origin.url']
        ).toString().trim();
        callback(itemPath, origin);
      } else if (dirExistsSync(path.join(itemPath, '.hg'))) {
        const origin = childProcess.execFileSync(
          'hg', ['-R', itemPath, 'config', 'paths.default']
        ).toString().trim();
        callback(itemPath, origin);
      }

      // Keep searching in case of nested repos, sometimes used.
      findRepositories(itemPath, callback);
    }
  });
}


function doInit(rootDirParam) {
  const nestAbsolutePath = process.cwd();
  const rootAbsolutePath = (rootDirParam === undefined)
    ? process.cwd()
    : path.resolve(rootDirParam);
  process.chdir(rootAbsolutePath);
  const nestFromRoot = path.relative(rootAbsolutePath, nestAbsolutePath);
  const rootFromNest = path.relative(nestAbsolutePath, rootAbsolutePath);

  // Dependencies
  const configPath = path.join(nestAbsolutePath, armConfigFilename);
  if (fileExistsSync(configPath)) {
    console.log(`Skipping init, already have ${armConfigFilename}`);
  } else {
    const dependencies = {};
    findRepositories('.', (directory, origin) => {
      dependencies[directory] = origin;
    });
    delete dependencies[nestFromRoot];
    const config = { dependencies, rootDirectory: rootFromNest };
    const prettyConfig = JSON.stringify(config, null, '  ');

    fs.writeFileSync(configPath, prettyConfig);
    console.log(`Initialised dependencies in ${armConfigFilename}`);

    // Root placeholder file. Safer to overwrite as low content.
    const rootFilePath = path.resolve(armRootFilename);
    let initialisedWord = 'Initialised';
    if (fileExistsSync(armRootFilename)) initialisedWord = 'Reinitialised';
    const rootObject = { configurationDirectory: nestFromRoot };
    const prettyRootObject = JSON.stringify(rootObject, null, '  ');
    fs.writeFileSync(rootFilePath, prettyRootObject);
    console.log(`${initialisedWord} marker file at root of forest: ${rootFilePath}`);
  }
}


function doClone(sourceURL, destGroupDirParam) {
  // Put together wrapper dir and dest repo
  const masterDirName = path.basename(sourceURL, '.git');
  let rootDir = destGroupDirParam;
  if (rootDir === undefined) rootDir = `${masterDirName}Group`;
  fs.mkdirSync(rootDir);
  const destPath = path.join(rootDir, masterDirName);

  // Clone master.
  const commandList = [];
  if (isGitRemote(sourceURL)) {
    commandList.push({
      cmd: 'git', args: ['clone', sourceURL, destPath],
    });
  } else if (isHgRemote(sourceURL)) {
    commandList.push({
      cmd: 'hg', args: ['clone', sourceURL, destPath],
    });
  } else {
    console.error(`Unknown repository type: ${sourceURL}`);
  }
  runCommandChain(commandList, () => {
    // After cloning master...
    process.chdir(rootDir);
    if (!fileExistsSync(path.join(masterDirName, armConfigFilename))) {
      console.log(my.errorColour(`Warning: stopping after clone, missing ${armConfigFilename}`));
    } else {
      const rootObject = { configDirectory: masterDirName };
      const prettyRootObject = JSON.stringify(rootObject, null, '  ');
      fs.writeFileSync(armRootFilename, prettyRootObject);
      doInstall();
    }
  });
}


//------------------------------------------------------------------------------
// Command line processing

program
  .version('0.0.1');

// Extra help
program.on('--help', () => {
  console.log('  Files:');
  console.log(
    `    ${armConfigFilename} configuration file for forest, especially dependencies`);
  console.log(`    ${armRootFilename} marks root of forest`);
  console.log('');
  console.log("  See also 'arm <command> --help' if there are options on a subcommand.");
  console.log('');
});

program
  .command('clone <source-URL> [group-dir]')
  .description('clone source-URL and and installing its dependencies')
  .action((sourceURL, destGroupPath) => {
    gRecognisedCommand = true;
    doClone(sourceURL, destGroupPath);
  });

program
  .command('init')
  .option('--root <dir>', 'root directory of forest')
  .description('add config file in dest directory, and marker file at root of forest')
  .action((options) => {
    gRecognisedCommand = true;
    // Sort out root directory in doInit
    doInit(options.root);
  });

program
  .command('install')
  .description('clone missing (new) dependent repositories')
  .action(() => {
    gRecognisedCommand = true;
    cdRootDirectory();
    doInstall();
  });

program
  .command('outgoing')
  .description('show changesets not in the default push location')
  .action(() => {
    gRecognisedCommand = true;
    cdRootDirectory();
    doOutgoing();
  });

program
  .command('root')
  .description('show the root directory of the forest')
  .action(() => {
    gRecognisedCommand = true;
    cdRootDirectory();
    console.log(process.cwd());
  });

program
  .command('status')
  .description('show the status of each repo in the forest')
  .action(() => {
    gRecognisedCommand = true;
    cdRootDirectory();
    doStatus();
  });

program
  .command('_test')
  .description('testing testing testing')
  .action(() => {
    gRecognisedCommand = true;
    const commandList = [];
    commandList.push({ cmd: 'ls', args: ['-ls'] });
    commandList.push({ cmd: './slow.sh' });
    // const list = ['./slow.sh', 'date', 'who', 'ls'];
    runCommandChain(commandList, () => console.log('finished'));
  });

program.parse(process.argv);

// Show help if no command specified.
if (process.argv.length === 2) {
  program.help();
}

// Error in the same style as command uses for unknown option
if (!gRecognisedCommand) {
  console.log('');
  console.log(`  error: unknown command \`${process.argv[2]}'`);
  console.log('');
  process.exit(1);
}
