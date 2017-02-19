/* eslint-env jasmine */

'use strict';

const mute = require('mute');
const tmp = require('tmp');
const childProcess = require('child_process');
// Mine
const core = require('../lib/core');
const fsX = require('../lib/fsExtra');


function quietDoInit(options) {
  // Classic use of mute, suppress output from (our own) module that does not support it!
  const unmute = mute();
  try {
    core.doInit(options);
    unmute();
  } catch (err) {
    unmute();
    throw err;
  }
}


describe('core init:', () => {
  let tempFolder;

  beforeEach(() => {
    tempFolder = tmp.dirSync({ unsafeCleanup: true });
    process.chdir(tempFolder.name);
  });

  it('empty git repo', () => {
    childProcess.execFileSync('git', ['init']);
    expect(fsX.dirExistsSync('.git')).toBe(true);

    quietDoInit({});
    expect(fsX.fileExistsSync(core.fabRootFilename)).toBe(true);
    expect(fsX.fileExistsSync(core.manifestPath({}))).toBe(true);

    // Can use readRootObject and readManifest?
    pending('check root contents');
    pending('check manifest');
  });

  // nested
  // sibling
  // pinned
  // locked
});