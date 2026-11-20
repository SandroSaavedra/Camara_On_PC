// Smoke test: starts the real server on free ports with a temp data dir,
// then checks the generated certificate and the main routes.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'iphone-cam.js');
const READY_MARKER = 'Ctrl+C';
const START_TIMEOUT_MS = 30000;

let child;
let output = '';
let dataDir;
let httpsPort;
let httpPort;

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function waitForOutput(marker) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Timed out waiting for "' + marker + '". Output:\n' + output));
    }, START_TIMEOUT_MS);
    const check = () => {
      if (output.includes(marker)) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on('data', check);
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error('Server exited early with code ' + code + '. Output:\n' + output));
    });
    check();
  });
}

function get(client, url) {
  return new Promise((resolve, reject) => {
    const req = client.get(url, { rejectUnauthorized: false }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
  });
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iphone-cam-test-'));
  httpsPort = await freePort();
  httpPort = await freePort();
  child = spawn(process.execPath, [SCRIPT, String(httpsPort), String(httpPort)], {
    env: Object.assign({}, process.env, { IPHONE_CAM_DATA_DIR: dataDir }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  await waitForOutput(READY_MARKER);
});

after(() => {
  if (child && child.exitCode === null) child.kill();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

test('generates key and certificate in the data dir', () => {
  const certPath = path.join(dataDir, 'cert.pem');
  assert.ok(fs.existsSync(path.join(dataDir, 'key.pem')), 'key.pem missing');
  assert.ok(fs.existsSync(certPath), 'cert.pem missing');

  const cert = new crypto.X509Certificate(fs.readFileSync(certPath));
  assert.match(cert.subject, /CN=iphone-cam/);
  assert.match(cert.subjectAltName || '', /DNS:localhost/);
  assert.equal(cert.publicKey.asymmetricKeyDetails.modulusLength, 2048);

  const days = (Date.parse(cert.validTo) - Date.parse(cert.validFrom)) / 864e5;
  assert.ok(days >= 824 && days <= 826, 'validity is ' + days + ' days');
});

test('serves the viewer and camera pages over HTTPS', async () => {
  assert.equal(await get(https, 'https://localhost:' + httpsPort + '/'), 200);
  assert.equal(await get(https, 'https://localhost:' + httpsPort + '/cam'), 200);
});

test('serves the OBS page over plain HTTP on localhost', async () => {
  assert.equal(await get(http, 'http://127.0.0.1:' + httpPort + '/obs'), 200);
});
