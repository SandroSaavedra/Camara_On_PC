#!/usr/bin/env node
/*
 * Builds a standalone executable with Node SEA (single executable application):
 *   1. bundle iphone-cam.js + dependencies into one CommonJS file (esbuild),
 *   2. turn it into a SEA blob (node --experimental-sea-config sea-config.json),
 *   3. copy the current node binary and inject the blob into it (postject).
 *
 * Output: dist/iphone-cam.exe on Windows (dist/iphone-cam elsewhere).
 * The executable embeds the Node runtime it was built with (process.execPath).
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const { inject } = require('postject');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const SEA_CONFIG = path.join(ROOT, 'sea-config.json');
const config = JSON.parse(fs.readFileSync(SEA_CONFIG, 'utf8'));
const BUNDLE = path.join(ROOT, config.main);
const BLOB = path.join(ROOT, config.output);
const EXE = path.join(DIST, process.platform === 'win32' ? 'iphone-cam.exe' : 'iphone-cam');
// Fixed sentinel the Node binary checks to know a SEA blob was injected.
const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

function step(message) {
  console.log('> ' + message);
}

// Returns true if the command ran; false if it is not installed.
function tryRun(cmd, args) {
  try {
    execFileSync(cmd, args, { stdio: 'inherit' });
    return true;
  } catch (e) {
    if (e.code === 'ENOENT') return false;
    throw e;
  }
}

async function main() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  step('Bundling iphone-cam.js with esbuild');
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'iphone-cam.js')],
    outfile: BUNDLE,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    logLevel: 'warning',
  });

  step('Generating SEA blob');
  execFileSync(process.execPath, ['--experimental-sea-config', SEA_CONFIG], { cwd: ROOT, stdio: 'inherit' });

  step('Copying node binary to ' + path.relative(ROOT, EXE));
  fs.copyFileSync(process.execPath, EXE);

  // The copied binary keeps the official Node signature, which becomes invalid after injection.
  if (process.platform === 'win32') {
    if (!tryRun('signtool', ['remove', '/s', EXE]))
      step('signtool not found: skipping signature removal (the exe still runs; SmartScreen may warn)');
  } else if (process.platform === 'darwin') {
    execFileSync('codesign', ['--remove-signature', EXE], { stdio: 'inherit' });
  }

  step('Injecting SEA blob with postject');
  await inject(EXE, 'NODE_SEA_BLOB', fs.readFileSync(BLOB), {
    sentinelFuse: SEA_FUSE,
    machoSegmentName: process.platform === 'darwin' ? 'NODE_SEA' : undefined,
  });

  if (process.platform === 'darwin') execFileSync('codesign', ['--sign', '-', EXE], { stdio: 'inherit' });

  const mb = (fs.statSync(EXE).size / 1024 / 1024).toFixed(1);
  step('Done: ' + path.relative(ROOT, EXE) + ' (' + mb + ' MB)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
