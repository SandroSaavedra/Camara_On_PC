#!/usr/bin/env node
/*
 * iPhone Cam - visor de camara tipo DroidCam.
 *
 * Uso (tras npm install):
 *   node iphone-cam.js              (puertos 8443 y 8080 por defecto)
 *   node iphone-cam.js 9443 9080    (otros puertos: HTTPS y OBS)
 *
 * En el PC abre   https://localhost:8443/
 * En el iPhone    https://<IP-del-PC>:8443/cam   (Safari, misma red WiFi)
 *
 * El video viaja directo iPhone -> PC por WebRTC dentro de tu red local.
 * Este servidor solo sirve las paginas y hace la senalizacion.
 */
const https = require('https');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const selfsigned = require('selfsigned');

const PORT = parseInt(process.argv[2], 10) || 8443;
// Plain HTTP on localhost only, for the OBS browser source (its CEF rejects self-signed certs).
const OBS_PORT = parseInt(process.argv[3], 10) || 8080;
// Where key.pem/cert.pem live. IPHONE_CAM_DATA_DIR lets tests keep them out of the repo.
const DATA_DIR = process.env.IPHONE_CAM_DATA_DIR || __dirname;
const KEY = path.join(DATA_DIR, 'key.pem');
const CERT = path.join(DATA_DIR, 'cert.pem');
// Apple rejects TLS server certificates valid for more than 825 days.
const CERT_DAYS = 825;

// ---------- Certificado autofirmado (iOS exige HTTPS para usar la camara) ----------
// Generated in pure JS (WebCrypto via selfsigned), so openssl is not required.
async function ensureCertificate() {
  if (fs.existsSync(KEY) && fs.existsSync(CERT)) return;
  console.log('Generando certificado autofirmado...');
  const notBeforeDate = new Date();
  const notAfterDate = new Date(notBeforeDate.getTime() + CERT_DAYS * 24 * 60 * 60 * 1000);
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'iphone-cam' }], {
    keyType: 'rsa',
    keySize: 2048,
    algorithm: 'sha256',
    notBeforeDate,
    notAfterDate,
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }] },
    ],
  });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(KEY, pems.private, { mode: 0o600 });
  fs.writeFileSync(CERT, pems.cert);
}

// ---------- Senalizacion: un canal SSE por rol ----------
const clients = { cam: null, viewer: null };

function send(role, msg) {
  const res = clients[role];
  if (res) res.write('data: ' + JSON.stringify(msg) + '\n\n');
}

function other(role) {
  return role === 'cam' ? 'viewer' : 'cam';
}

// ---------- Paginas ----------
const STYLE = `
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: #0b0d10; color: #e8eaed;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  body { display: flex; flex-direction: column; }
  .bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
    padding: 10px 12px; background: #15181d; border-bottom: 1px solid #262a31; }
  .bar h1 { font-size: 15px; margin: 0 8px 0 0; font-weight: 600; }
  button, select { font: inherit; font-size: 14px; color: #e8eaed; background: #262a31;
    border: 1px solid #3a3f48; border-radius: 8px; padding: 8px 12px; }
  button.primary { background: #2f6feb; border-color: #2f6feb; }
  button:disabled { opacity: .5; }
  #status { margin-left: auto; font-size: 13px; color: #9aa0a6; }
  #status.ok { color: #57d38c; } #status.bad { color: #ff7b72; }
  .stage { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; }
  video { width: 100%; height: 100%; object-fit: contain; background: #000; }
  #stats { font-size: 12px; color: #9aa0a6; font-variant-numeric: tabular-nums; }
  video.mirror { transform: scaleX(-1); }
`;

const CAM_HTML = `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>iPhone Cam - Camara</title><style>${STYLE}</style></head>
<body>
<div class="bar">
  <h1>Camara</h1>
  <button id="start" class="primary">Iniciar camara</button>
  <select id="facing">
    <option value="environment">Trasera</option>
    <option value="user">Frontal</option>
  </select>
  <select id="res">
    <option value="1920x1080" selected>1080p</option>
    <option value="1280x720">720p</option>
    <option value="640x480">480p</option>
    <option value="3840x2160">4K (experimental)</option>
  </select>
  <span id="status">Sin iniciar</span>
  <span id="stats" style="width:100%"></span>
</div>
<div class="stage"><video id="v" autoplay muted playsinline></video></div>
<script>
var v = document.getElementById('v'), statusEl = document.getElementById('status');
var facing = document.getElementById('facing'), res = document.getElementById('res');
var statsEl = document.getElementById('stats');
var stream = null, pc = null, viewerReady = false, wakeLock = null;

// Bitrate per requested height; a LAN can sustain these comfortably.
var BITRATES = { 2160: 20000000, 1080: 10000000, 720: 5000000, 480: 2500000 };

function setStatus(t, cls) { statusEl.textContent = t; statusEl.className = cls || ''; }
function signal(msg) {
  return fetch('/signal?from=cam', { method: 'POST', body: JSON.stringify(msg) });
}

async function getStream() {
  var wh = res.value.split('x');
  if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: facing.value, width: { ideal: +wh[0] }, height: { ideal: +wh[1] },
             frameRate: { ideal: 30 } }
  });
  var track = stream.getVideoTracks()[0];
  // Hint the encoder to preserve resolution (sharpness) over motion smoothness.
  try { track.contentHint = 'detail'; } catch (e) {}
  v.srcObject = stream;
  v.className = facing.value === 'user' ? 'mirror' : '';
  return stream;
}

async function applyEncoding(sender) {
  var height = +res.value.split('x')[1];
  var p = sender.getParameters();
  if (!p.encodings || !p.encodings.length) p.encodings = [{}];
  p.encodings[0].maxBitrate = BITRATES[height] || 10000000;
  p.encodings[0].scaleResolutionDownBy = 1;
  try { await sender.setParameters(p); } catch (e) {}
  // Separate attempt: some browsers reject degradationPreference and would drop the bitrate change.
  try {
    p = sender.getParameters();
    p.degradationPreference = 'maintain-resolution';
    await sender.setParameters(p);
  } catch (e) {}
}

// libwebrtc reads x-google-* fmtp params from the remote SDP: start the bandwidth
// estimate high and keep a floor, instead of ramping up from ~300 kbps.
function boostSdp(sdp) {
  var kbps = (BITRATES[+res.value.split('x')[1]] || 10000000) / 1000;
  var params = 'x-google-start-bitrate=' + Math.round(kbps / 2) +
    ';x-google-min-bitrate=' + Math.round(kbps / 4) + ';x-google-max-bitrate=' + kbps;
  var lines = sdp.split('\\r\\n'), inVideo = false, pt = null;
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].indexOf('m=') === 0) {
      inVideo = lines[i].indexOf('m=video') === 0;
      pt = inVideo ? lines[i].split(' ')[3] : null; // first payload type = negotiated codec
    } else if (inVideo && pt && lines[i].indexOf('a=fmtp:' + pt + ' ') === 0) {
      lines[i] += ';' + params; pt = null;
    } else if (inVideo && pt && lines[i].indexOf('a=rtpmap:' + pt + ' ') === 0 &&
               sdp.indexOf('a=fmtp:' + pt + ' ') === -1) {
      lines.splice(i + 1, 0, 'a=fmtp:' + pt + ' ' + params); pt = null;
    }
  }
  return lines.join('\\r\\n');
}

// Show what the camera captures vs. what WebRTC actually sends.
setInterval(async function () {
  if (!stream) return;
  var s = stream.getVideoTracks()[0].getSettings();
  var text = 'Captura ' + s.width + 'x' + s.height + ' @' + Math.round(s.frameRate || 0) + 'fps';
  if (pc && pc.connectionState === 'connected') {
    var report = await pc.getStats();
    report.forEach(function (r) {
      if (r.type === 'outbound-rtp' && r.kind === 'video' && r.frameWidth)
        text += '  |  Enviando ' + r.frameWidth + 'x' + r.frameHeight + ' @' + Math.round(r.framesPerSecond || 0) + 'fps' +
          (r.qualityLimitationReason && r.qualityLimitationReason !== 'none' ? ' (limitado: ' + r.qualityLimitationReason + ')' : '');
    });
  }
  statsEl.textContent = text;
}, 2000);

async function call() {
  if (!stream || !viewerReady) return;
  if (pc) pc.close();
  pc = new RTCPeerConnection({ iceServers: [] });
  var sender = pc.addTrack(stream.getVideoTracks()[0], stream);
  pc.onicecandidate = function (e) { if (e.candidate) signal({ type: 'ice', candidate: e.candidate }); };
  pc.onconnectionstatechange = function () {
    var s = pc.connectionState;
    if (s === 'connected') setStatus('Transmitiendo al PC', 'ok');
    else if (s === 'failed' || s === 'disconnected') setStatus('Conexion perdida', 'bad');
  };
  var offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await signal({ type: 'offer', sdp: pc.localDescription });
  await applyEncoding(sender);
}

async function start() {
  try {
    await getStream();
    document.getElementById('start').textContent = 'Camara activa';
    document.getElementById('start').disabled = true;
    setStatus(viewerReady ? 'Conectando...' : 'Esperando al visor en el PC');
    try { if (navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {}
    call();
  } catch (e) {
    setStatus('Error: ' + e.message, 'bad');
  }
}

async function changeSource() {
  if (!stream) return;
  try {
    await getStream();
    var track = stream.getVideoTracks()[0];
    var sender = pc && pc.getSenders().find(function (s) { return s.track && s.track.kind === 'video'; });
    if (sender) { await sender.replaceTrack(track); await applyEncoding(sender); } else call();
  } catch (e) { setStatus('Error: ' + e.message, 'bad'); }
}

document.getElementById('start').onclick = start;
facing.onchange = changeSource;
res.onchange = changeSource;
document.addEventListener('visibilitychange', async function () {
  if (document.visibilityState === 'visible' && stream && navigator.wakeLock) {
    try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {}
  }
});

var es = new EventSource('/events?role=cam');
es.onmessage = async function (ev) {
  var m = JSON.parse(ev.data);
  if (m.type === 'replaced') {
    es.close(); if (pc) pc.close();
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    setStatus('Otra pestaña tomo la camara. Recarga para volver.', 'bad');
  }
  else if (m.type === 'ready') { viewerReady = true; call(); }
  else if (m.type === 'gone') { viewerReady = false; if (stream) setStatus('Esperando al visor en el PC'); }
  else if (m.type === 'answer' && pc) {
    try { await pc.setRemoteDescription({ type: 'answer', sdp: boostSdp(m.sdp.sdp) }); }
    catch (e) { await pc.setRemoteDescription(m.sdp); } // fall back to the untouched SDP
  }
  else if (m.type === 'ice' && pc) { try { await pc.addIceCandidate(m.candidate); } catch (e) {} }
};
</script></body></html>`;

const VIEWER_HTML = `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>iPhone Cam - Visor</title><style>${STYLE}</style></head>
<body>
<div class="bar">
  <h1>iPhone Cam</h1>
  <button id="mirror">Espejo</button>
  <button id="rotate">Rotar</button>
  <button id="full">Pantalla completa</button>
  <button id="pip">Ventana flotante</button>
  <button id="clean" title="Oculta la barra. Presiona H o doble clic para volver">Modo captura</button>
  <span id="stats"></span>
  <span id="status">Esperando al iPhone...</span>
</div>
<div class="stage"><video id="v" autoplay muted playsinline></video></div>
<script>
var v = document.getElementById('v'), statusEl = document.getElementById('status');
var statsEl = document.getElementById('stats'), bar = document.querySelector('.bar');
var pc = null, mirror = false, rot = 0, lastBytes = 0, lastTs = 0, obsMode = false;

function setStatus(t, cls) {
  statusEl.textContent = t; statusEl.className = cls || '';
  // In OBS the bar is hidden: show status as an overlay only until video flows.
  if (obsMode) statusEl.style.display = cls === 'ok' ? 'none' : '';
}
function signal(msg) {
  return fetch('/signal?from=viewer', { method: 'POST', body: JSON.stringify(msg) });
}
function applyTransform() {
  v.style.transform = 'rotate(' + rot + 'deg)' + (mirror ? ' scaleX(-1)' : '');
}
document.getElementById('mirror').onclick = function () { mirror = !mirror; applyTransform(); };
document.getElementById('rotate').onclick = function () { rot = (rot + 90) % 360; applyTransform(); };
document.getElementById('full').onclick = function () { v.requestFullscreen && v.requestFullscreen(); };
document.getElementById('pip').onclick = function () {
  if (document.pictureInPictureElement) document.exitPictureInPicture();
  else if (v.requestPictureInPicture) v.requestPictureInPicture();
};
function toggleBar() { bar.style.display = bar.style.display === 'none' ? '' : 'none'; }
document.getElementById('clean').onclick = toggleBar;
v.ondblclick = toggleBar;
document.addEventListener('keydown', function (e) { if (e.key === 'h' || e.key === 'H') toggleBar(); });
// /obs: video only, for an OBS browser source.
// Transparent background so OBS shows the scene behind any letterbox area.
// ?fit=cover fills the whole source instead (crops the edges).
if (location.pathname === '/obs') {
  toggleBar();
  document.documentElement.style.background = document.body.style.background = v.style.background = 'transparent';
  v.style.objectFit = new URLSearchParams(location.search).get('fit') === 'cover' ? 'cover' : 'contain';
  obsMode = true;
  statusEl.style.cssText = 'position:fixed;top:40px;left:40px;margin:0;font-size:48px;' +
    'background:rgba(0,0,0,.7);color:#fff;padding:16px 24px;border-radius:14px';
  document.body.appendChild(statusEl);
}

// Received quality: resolution, fps, bitrate, packet loss and codec.
setInterval(async function () {
  if (!pc || pc.connectionState !== 'connected') return;
  var report = await pc.getStats();
  report.forEach(function (r) {
    if (r.type !== 'inbound-rtp' || r.kind !== 'video') return;
    var mbps = lastTs ? ((r.bytesReceived - lastBytes) * 8 / ((r.timestamp - lastTs) / 1000) / 1e6).toFixed(1) : '-';
    lastBytes = r.bytesReceived; lastTs = r.timestamp;
    var codec = r.codecId && report.get(r.codecId) ? report.get(r.codecId).mimeType.replace('video/', '') : '';
    statsEl.textContent = (r.frameWidth || 0) + 'x' + (r.frameHeight || 0) + ' @' + Math.round(r.framesPerSecond || 0) +
      'fps  ' + mbps + ' Mbps  perdidos ' + (r.packetsLost || 0) + (codec ? '  ' + codec : '');
  });
}, 1000);

var es = new EventSource('/events?role=viewer');
es.onmessage = async function (ev) {
  var m = JSON.parse(ev.data);
  if (m.type === 'replaced') {
    es.close(); if (pc) { pc.close(); pc = null; }
    v.srcObject = null; statsEl.textContent = '';
    bar.style.display = '';
    setStatus('Otro visor (OBS u otra pestaña) tomo el video. Recarga para volver.', 'bad');
  } else if (m.type === 'offer') {
    if (pc) pc.close();
    pc = new RTCPeerConnection({ iceServers: [] });
    pc.ontrack = function (e) { v.srcObject = e.streams[0]; };
    pc.onicecandidate = function (e) { if (e.candidate) signal({ type: 'ice', candidate: e.candidate }); };
    pc.onconnectionstatechange = function () {
      var s = pc.connectionState;
      if (s === 'connected') setStatus('Conectado', 'ok');
      else if (s === 'connecting') setStatus('Conectando...');
      else if (s === 'failed' || s === 'disconnected') setStatus('Conexion perdida', 'bad');
    };
    await pc.setRemoteDescription(m.sdp);
    var answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    signal({ type: 'answer', sdp: pc.localDescription });
  } else if (m.type === 'ice' && pc) {
    try { await pc.addIceCandidate(m.candidate); } catch (e) {}
  } else if (m.type === 'gone') {
    setStatus('Esperando al iPhone...');
    statsEl.textContent = ''; lastBytes = 0; lastTs = 0;
  }
};
</script></body></html>`;

// ---------- Servidor ----------
function handler(req, res) {
    const url = new URL(req.url, 'https://x');

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/obs')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(VIEWER_HTML);
    }
    if (req.method === 'GET' && url.pathname === '/cam') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(CAM_HTML);
    }

    if (req.method === 'GET' && url.pathname === '/events') {
      const role = url.searchParams.get('role');
      if (role !== 'cam' && role !== 'viewer') { res.writeHead(400); return res.end(); }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(': ok\n\n');
      // One session per role. Tell the old one it was replaced so it stops
      // auto-reconnecting (otherwise two tabs kick each other forever).
      if (clients[role]) {
        clients[role].write('data: ' + JSON.stringify({ type: 'replaced' }) + '\n\n');
        clients[role].end();
      }
      clients[role] = res;
      console.log('[+] ' + role + ' conectado (' + req.socket.remoteAddress + ')');
      // La camara inicia la llamada cuando sabe que hay un visor
      if (clients.cam && clients.viewer) send('cam', { type: 'ready' });
      const ping = setInterval(() => res.write(': ping\n\n'), 20000);
      req.on('close', () => {
        clearInterval(ping);
        if (clients[role] === res) {
          clients[role] = null;
          console.log('[-] ' + role + ' desconectado');
          send(other(role), { type: 'gone' });
        }
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/signal') {
      const from = url.searchParams.get('from');
      if (from !== 'cam' && from !== 'viewer') { res.writeHead(400); return res.end(); }
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
      req.on('end', () => {
        try { send(other(from), JSON.parse(body)); res.writeHead(204); }
        catch (e) { res.writeHead(400); }
        res.end();
      });
      return;
    }

    res.writeHead(404);
    res.end('No encontrado');
}

function onListenError(port) {
  return (e) => {
    if (e.code !== 'EADDRINUSE') throw e;
    console.error('\nEl puerto ' + port + ' ya esta en uso (¿quedo otra ventana con iphone-cam abierta?).\n' +
      'Cierrala o usa otros puertos:  node iphone-cam.js 9443 9080\n');
    process.exit(1);
  };
}

function printBanner() {
  const ips = [];
  for (const list of Object.values(os.networkInterfaces()))
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) ips.push(i.address);
  console.log('\niPhone Cam en marcha\n');
  console.log('  Visor (en este PC):   https://localhost:' + PORT + '/');
  ips.forEach((ip) => console.log('  Camara (en el iPhone): https://' + ip + ':' + PORT + '/cam'));
  console.log('  OBS (Fuente de navegador, 1080x1920): http://localhost:' + OBS_PORT + '/obs');
  console.log('\nAmbos navegadores mostraran un aviso de certificado: acepta y continua.');
  console.log('Ctrl+C para detener.\n');
}

async function main() {
  try {
    await ensureCertificate();
  } catch (e) {
    console.error('\nNo se pudo generar el certificado en ' + DATA_DIR + ': ' + e.message + '\n');
    process.exit(1);
  }

  http.createServer(handler).on('error', onListenError(OBS_PORT)).listen(OBS_PORT, '127.0.0.1');

  const server = https.createServer({ key: fs.readFileSync(KEY), cert: fs.readFileSync(CERT) }, handler);
  server.on('error', onListenError(PORT));
  server.listen(PORT, '0.0.0.0', printBanner);
}

main();
