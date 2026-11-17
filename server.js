#!/usr/bin/env node
'use strict';
// Sanctuary Lights: a small lighting controller for churches.
// Run:  node server.js   then open http://localhost:8080
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Engine, demoShow } = require('./lib/engine');
const { Output } = require('./lib/output');
const { MidiIn } = require('./lib/midi');
const { readMvr } = require('./lib/mvr');

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.LIGHTS_DATA || path.join(os.homedir(), 'SanctuaryLights');
const SHOW_FILE = path.join(DATA_DIR, 'show.json');
const RUNTIME_FILE = path.join(DATA_DIR, 'runtime.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const PUBLIC = path.join(__dirname, 'public');
const ASSETS = path.join(DATA_DIR, 'assets');

// ----- persistence ---------------------------------------------------------
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}
function writeJsonAtomic(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
  fs.renameSync(tmp, file);
}
function backupShow() {
  if (!fs.existsSync(SHOW_FILE)) return;
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  fs.copyFileSync(SHOW_FILE, path.join(BACKUP_DIR, `show-${stamp}.json`));
  const old = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.json')).sort();
  for (const f of old.slice(0, Math.max(0, old.length - 30))) fs.unlinkSync(path.join(BACKUP_DIR, f));
}

fs.mkdirSync(DATA_DIR, { recursive: true });
backupShow();
const engine = new Engine(readJson(SHOW_FILE) || demoShow(), readJson(RUNTIME_FILE) || {});
engine.on('log', (m) => console.warn(m));

let showTimer = null;
let runtimeTimer = null;
function saveShowSoon() {
  clearTimeout(showTimer);
  showTimer = setTimeout(() => {
    try {
      writeJsonAtomic(SHOW_FILE, engine.show);
    } catch (e) {
      console.error('Could not save show:', e.message);
    }
  }, 400);
}
function saveRuntimeSoon() {
  clearTimeout(runtimeTimer);
  runtimeTimer = setTimeout(() => {
    try {
      writeJsonAtomic(RUNTIME_FILE, engine.persistentRuntime());
    } catch (e) {
      console.error('Could not save runtime:', e.message);
    }
  }, 1000);
}
saveShowSoon();

// ----- output loop ---------------------------------------------------------
const output = new Output(console);
output.configure(engine.show.settings);
let lastUniverses = new Map();
let latestLook = engine.computeLook();
let loopTimer = null;
function startLoop() {
  clearInterval(loopTimer);
  loopTimer = setInterval(() => {
    try {
      latestLook = engine.computeLook();
      lastUniverses = engine.render(latestLook);
      output.send(lastUniverses);
    } catch (e) {
      console.error('Engine error:', e);
    }
  }, Math.round(1000 / engine.show.settings.fps));
}
startLoop();

// ----- live updates (Server-Sent Events) -----------------------------------
const clients = new Set();
function send(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
function fullState() {
  return {
    show: engine.show,
    profiles: engine.profileList(),
    runtime: engine.runtimeState(),
    outputError: output.lastError,
    midi: midi.status(),
  };
}
function broadcast(event, data) {
  for (const res of clients) send(res, event, data);
}
let lastLive = '';
setInterval(() => {
  if (!clients.size) return;
  const live = JSON.stringify(engine.liveState(latestLook));
  if (live === lastLive) return;
  lastLive = live;
  for (const res of clients) res.write(`event: live\ndata: ${live}\n\n`);
}, 80);
setInterval(() => {
  for (const res of clients) res.write(': ping\n\n');
}, 15000);

// ----- actions ---------------------------------------------------------------
function runAction(action) {
  const before = { fps: engine.show.settings.fps, midiInput: engine.show.settings.midiInput };
  const changed = engine.dispatch(action); // throws on bad input
  if (changed.show) {
    saveShowSoon();
    output.configure(engine.show.settings);
    if (engine.show.settings.fps !== before.fps) startLoop();
    if (engine.show.settings.midiInput !== before.midiInput) midi.configure(engine.show.settings.midiInput);
  }
  if (!changed.show && !changed.runtime) return;
  saveRuntimeSoon();
  latestLook = engine.computeLook();
  broadcast(changed.show ? 'state' : 'runtime', changed.show ? fullState() : engine.runtimeState());
}

// ----- MIDI in ---------------------------------------------------------------
const midi = new MidiIn(console);
midi.on('message', (data) => {
  try {
    runAction({ type: 'midi.message', data });
  } catch (e) {
    console.warn('MIDI:', e.message);
  }
});
midi.on('ports', () => broadcast('state', fullState()));
midi.on('beat', (bpm) => {
  try {
    runAction({ type: 'tempo.beat', bpm });
  } catch {}
});
midi.on('clockStop', () => runAction({ type: 'tempo.clockStop' }));
midi.configure(engine.show.settings.midiInput);

// ----- HTTP ----------------------------------------------------------------
const MIME = { '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.obj': 'text/plain', '.3ds': 'application/octet-stream', '.bin': 'application/octet-stream', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.mtl': 'text/plain',
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error(`File is too large (limit ${Math.round(limit / 1e6)} MB)`));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
const safeName = (n) => path.basename(String(n || 'file')).replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '') || 'file';
function saveAsset(rel, data) {
  const file = path.normalize(path.join(ASSETS, rel));
  if (!file.startsWith(ASSETS + path.sep)) throw new Error('Bad file name');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
}

function readBody(req, limit = 5e6) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Request too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
function interfaces() {
  const list = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) if (a.family === 'IPv4' && !a.internal) list.push({ name, address: a.address, netmask: a.netmask });
  }
  return list;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write('retry: 1500\n\n');
      send(res, 'state', fullState());
      send(res, 'live', engine.liveState(latestLook));
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (url.pathname === '/api/action' && req.method === 'POST') {
      const action = JSON.parse(await readBody(req));
      try {
        runAction(action);
      } catch (e) {
        return json(res, 400, { ok: false, error: e.message });
      }
      if (action.type === 'mvr.apply') return json(res, 200, { ok: true, skipped: engine.lastImportSkipped || [] });
      if (action.type === 'effect.save') return json(res, 200, { ok: true, id: engine.lastSavedEffect });
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/upload/model' && req.method === 'POST') {
      const name = safeName(url.searchParams.get('name'));
      if (!/\.(glb|gltf|obj|3ds)$/i.test(name)) return json(res, 400, { ok: false, error: 'Use a .glb, .gltf, .obj or .3ds file (GLB works best)' });
      const data = await readRaw(req, 300e6);
      const rel = `models/${Date.now().toString(36)}-${name}`;
      saveAsset(rel, data);
      return json(res, 200, { ok: true, file: rel, name });
    }
    if (url.pathname === '/api/upload/mvr' && req.method === 'POST') {
      const data = await readRaw(req, 500e6);
      let mvr;
      try {
        mvr = readMvr(data);
      } catch (e) {
        return json(res, 400, { ok: false, error: e.message });
      }
      const dir = `mvr-${Date.now().toString(36)}`;
      for (const [name, buf] of mvr.files) saveAsset(`${dir}/${name}`, buf);
      const models = mvr.models.map((m) => ({ ...m, file: `${dir}/${m.file}` }));
      return json(res, 200, { ok: true, fixtures: mvr.fixtures, types: mvr.types, models });
    }
    if (url.pathname.startsWith('/assets/')) {
      const file = path.normalize(path.join(ASSETS, decodeURIComponent(url.pathname.slice(8))));
      if (!file.startsWith(ASSETS + path.sep)) return json(res, 403, { error: 'Forbidden' });
      return fs.readFile(file, (err, data) => {
        if (err) return json(res, 404, { error: 'Not found' });
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'max-age=3600' });
        res.end(data);
      });
    }
    if (url.pathname === '/api/dmx') {
      const u = Number(url.searchParams.get('u')) || 1;
      const data = lastUniverses.get(u);
      return json(res, 200, { universe: u, data: data ? Array.from(data) : new Array(512).fill(0), universes: [...lastUniverses.keys()].sort((a, b) => a - b) });
    }
    if (url.pathname === '/api/info') {
      return json(res, 200, { interfaces: interfaces(), dataDir: DATA_DIR, port: PORT, platform: process.platform, outputError: output.lastError, midi: midi.status() });
    }
    if (url.pathname === '/api/export') {
      const name = (engine.show.name || 'show').replace(/[^a-z0-9-_ ]/gi, '').trim() || 'show';
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${name}.json"` });
      return res.end(JSON.stringify(engine.show, null, 1));
    }
    if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
    // Static files
    let file = path.normalize(path.join(PUBLIC, decodeURIComponent(url.pathname)));
    if (!file.startsWith(PUBLIC)) return json(res, 403, { error: 'Forbidden' });
    if (url.pathname === '/' || !path.extname(file)) file = path.join(PUBLIC, 'index.html');
    fs.readFile(file, (err, data) => {
      if (err) return json(res, 404, { error: 'Not found' });
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  } catch (e) {
    json(res, 500, { ok: false, error: e.message });
  }
});

// When embedded in the desktop app, the app waits on this promise instead of the process exiting.
let readyResolve, readyReject;
module.exports.ready = new Promise((res, rej) => { readyResolve = res; readyReject = rej; });
module.exports.ready.catch(() => {});
server.on('error', (e) => {
  const msg = e.code === 'EADDRINUSE' ? `Port ${PORT} is already in use. Is Sanctuary Lights already running? (Set PORT=8081 to use another port.)` : String(e);
  console.error(msg);
  if (process.env.SL_EMBEDDED) return readyReject(new Error(msg));
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  readyResolve({ port: PORT });
  console.log('\n  Sanctuary Lights is running.\n');
  console.log(`  On this computer:   http://localhost:${PORT}`);
  for (const i of interfaces()) console.log(`  On iPad/phone:      http://${i.address}:${PORT}   (${i.name})`);
  console.log(`\n  Show file: ${SHOW_FILE}`);
  console.log('  Press Ctrl+C to stop.\n');
});

function shutdown() {
  try {
    writeJsonAtomic(SHOW_FILE, engine.show);
    writeJsonAtomic(RUNTIME_FILE, engine.persistentRuntime());
  } catch {}
  output.close();
  midi.close();
  process.exit(0);
}
module.exports.shutdown = () => {
  try {
    writeJsonAtomic(SHOW_FILE, engine.show);
    writeJsonAtomic(RUNTIME_FILE, engine.persistentRuntime());
  } catch {}
  output.close();
  midi.close();
};
if (!process.env.SL_EMBEDDED) {
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
