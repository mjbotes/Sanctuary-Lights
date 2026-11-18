'use strict';
// HTTP routes. Every request gets a role (see auth.js); actions and uploads are checked against it.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readMvr } = require('../mvr');
const { readFixtureFiles } = require('../fixtures');

const MIME = {
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.aif': 'audio/aiff', '.aiff': 'audio/aiff', '.caf': 'audio/x-caf',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.obj': 'text/plain', '.3ds': 'application/octet-stream', '.bin': 'application/octet-stream', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.mtl': 'text/plain',
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json',
  '.f32': 'application/octet-stream', '.pcm': 'application/octet-stream', '.webmanifest': 'application/manifest+json', '.md': 'text/markdown; charset=utf-8',
};

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

const json = (res, code, data) => {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
};
const safeName = (n) => path.basename(String(n || 'file')).replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '') || 'file';

function interfaces() {
  const list = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) if (a.family === 'IPv4' && !a.internal) list.push({ name, address: a.address, netmask: a.netmask });
  }
  return list;
}

function sendFile(res, file, cache) {
  fs.readFile(file, (err, data) => {
    if (err) return json(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': cache });
    res.end(data);
  });
}

function makeHandler(app) {
  const cfg = app.cfg;
  const assets = cfg.assetsDir;
  const saveAsset = (rel, data) => {
    const file = path.normalize(path.join(assets, rel));
    if (!file.startsWith(assets + path.sep)) throw new Error('Bad file name');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
  };
  const need = (role, min, res) => {
    const order = ['volunteer', 'operator', 'admin'];
    if (order.indexOf(role) >= order.indexOf(min)) return true;
    json(res, role ? 403 : 401, { ok: false, error: role ? `Your PIN (${role}) cannot do that` : 'Please enter your PIN', auth: true });
    return false;
  };

  const routes = {
    'GET /api/events': (req, res, url, role) => {
      if (!role) return json(res, 401, { ok: false, error: 'Please enter your PIN', auth: true });
      app.hub.open(req, res, role, [['state', app.fullState(role)], ['live', app.engine.liveState(app.latestLook)]]);
    },
    'POST /api/login': async (req, res) => {
      const body = JSON.parse((await readRaw(req, 1e4)).toString('utf8') || '{}');
      const r = app.auth.login(body.pin);
      if (!r) {
        await new Promise((ok) => setTimeout(ok, 600)); // slow down guessing
        return json(res, 403, { ok: false, error: 'Wrong PIN' });
      }
      return json(res, 200, { ok: true, ...r });
    },
    'GET /api/whoami': (req, res, url, role) => json(res, 200, { role, enabled: app.auth.enabled }),
    'POST /api/action': async (req, res, url, role) => {
      const action = JSON.parse((await readRaw(req, 5e6)).toString('utf8'));
      let extra;
      try {
        extra = app.run(action, role);
      } catch (e) {
        return json(res, e.message.includes('PIN') ? (role ? 403 : 401) : 400, { ok: false, error: e.message, auth: e.message.includes('PIN') || undefined });
      }
      return json(res, 200, { ok: true, ...(extra || {}) });
    },
    'POST /api/upload/model': async (req, res, url, role) => {
      if (!need(role, 'admin', res)) return;
      const name = safeName(url.searchParams.get('name'));
      if (!/\.(glb|gltf|obj|3ds)$/i.test(name)) return json(res, 400, { ok: false, error: 'Use a .glb, .gltf, .obj or .3ds file (GLB works best)' });
      const rel = `models/${Date.now().toString(36)}-${name}`;
      saveAsset(rel, await readRaw(req, 300e6));
      return json(res, 200, { ok: true, file: rel, name });
    },
    'POST /api/upload/audio': async (req, res, url, role) => {
      if (!need(role, 'operator', res)) return;
      const name = safeName(url.searchParams.get('name'));
      if (!/\.(wav|aiff?|mp3|m4a|aac|flac|ogg|caf)$/i.test(name)) return json(res, 400, { ok: false, error: 'Use WAV, AIFF, MP3, M4A, FLAC or OGG audio files' });
      const rel = `audio/${Date.now().toString(36)}-${name}`;
      saveAsset(rel, await readRaw(req, 1000e6));
      return json(res, 200, { ok: true, file: rel, name });
    },
    // Rendered key/tempo versions of stems, kept so they are not re-rendered after a restart
    'POST /api/upload/render': async (req, res, url, role) => {
      if (!need(role, 'operator', res)) return;
      const key = String(url.searchParams.get('key') || '');
      if (!/^[a-f0-9]{16,64}$/.test(key)) return json(res, 400, { ok: false, error: 'Bad key' });
      saveAsset(`rendered/${key}.pcm`, await readRaw(req, 2000e6));
      return json(res, 200, { ok: true });
    },
    'POST /api/upload/mvr': async (req, res, url, role) => {
      if (!need(role, 'admin', res)) return;
      let mvr;
      try {
        mvr = readMvr(await readRaw(req, 500e6));
      } catch (e) {
        return json(res, 400, { ok: false, error: e.message });
      }
      const dir = `mvr-${Date.now().toString(36)}`;
      for (const [name, buf] of mvr.files) saveAsset(`${dir}/${name}`, buf);
      const models = mvr.models.map((m) => ({ ...m, file: `${dir}/${m.file}` }));
      return json(res, 200, { ok: true, fixtures: mvr.fixtures, types: mvr.types, models, profiles: mvr.profiles || [] });
    },
    // ----- Planning Center Services -------------------------------------------------
    'GET /api/pco/status': (req, res, url, role) => {
      if (!need(role, 'operator', res)) return;
      json(res, 200, { ok: true, connected: app.pco.connected });
    },
    'POST /api/pco/connect': async (req, res, url, role) => {
      if (!need(role, 'admin', res)) return;
      const body = JSON.parse((await readRaw(req, 1e4)).toString('utf8') || '{}');
      try {
        await app.pco.connect(body.appId, body.secret);
        json(res, 200, { ok: true, types: await app.pco.serviceTypes() });
      } catch (e) {
        json(res, 400, { ok: false, error: e.message });
      }
    },
    'POST /api/pco/disconnect': (req, res, url, role) => {
      if (!need(role, 'admin', res)) return;
      app.pco.disconnect();
      json(res, 200, { ok: true });
    },
    'GET /api/pco/types': async (req, res, url, role) => {
      if (!need(role, 'operator', res)) return;
      try { json(res, 200, { ok: true, types: await app.pco.serviceTypes() }); } catch (e) { json(res, 400, { ok: false, error: e.message }); }
    },
    'GET /api/pco/plans': async (req, res, url, role) => {
      if (!need(role, 'operator', res)) return;
      try { json(res, 200, { ok: true, plans: await app.pco.upcomingPlans(url.searchParams.get('type') || '') }); } catch (e) { json(res, 400, { ok: false, error: e.message }); }
    },
    'POST /api/pco/import': async (req, res, url, role) => {
      if (!need(role, 'operator', res)) return;
      const body = JSON.parse((await readRaw(req, 1e4)).toString('utf8') || '{}');
      try {
        const plan = await app.pco.plan(body.type, body.plan);
        const r = app.run({ type: 'plan.import', plan, design: body.design !== false, source: 'planning-center' }, role);
        json(res, 200, { ok: true, title: plan.title, date: plan.date, ...(r || {}) });
      } catch (e) {
        json(res, 400, { ok: false, error: e.message });
      }
    },
    // GDTF / Open Fixture Library files -> fixture types (preview; the client then calls profile.import)
    'POST /api/upload/fixture': async (req, res, url, role) => {
      if (!need(role, 'admin', res)) return;
      try {
        const profiles = readFixtureFiles(safeName(url.searchParams.get('name')), await readRaw(req, 50e6));
        return json(res, 200, { ok: true, profiles });
      } catch (e) {
        return json(res, 400, { ok: false, error: e.message });
      }
    },
    'GET /api/pp/thumb': async (req, res, url) => {
      const uuid = url.searchParams.get('uuid');
      if (!uuid) return json(res, 400, { error: 'uuid needed' });
      try {
        const img = await app.devices.pp.thumbnail(uuid, Number(url.searchParams.get('index')) || 0, Math.min(1280, Number(url.searchParams.get('q')) || 320));
        res.writeHead(200, { 'Content-Type': img.type, 'Cache-Control': 'max-age=60' });
        return res.end(img.data);
      } catch (e) {
        return json(res, 502, { error: e.message });
      }
    },
    'GET /api/dmx': (req, res, url) => {
      const u = Number(url.searchParams.get('u')) || 1;
      const data = app.devices.lastUniverses.get(u);
      return json(res, 200, { universe: u, data: data ? Array.from(data) : new Array(512).fill(0), universes: [...app.devices.lastUniverses.keys()].sort((a, b) => a - b) });
    },
    'GET /api/info': (req, res) => json(res, 200, {
      interfaces: interfaces(), dataDir: cfg.dataDir, port: cfg.port, platform: process.platform, version: cfg.version,
      errors: app.errors.slice(0, 10), ...app.devices.status(),
    }),
    'GET /api/export': (req, res, url, role) => {
      if (!need(role, 'operator', res)) return;
      const name = (app.engine.show.name || 'show').replace(/[^a-z0-9-_ ]/gi, '').trim() || 'show';
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${name}.json"` });
      return res.end(JSON.stringify(app.publicShow(), null, 1));
    },
  };

  return async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const token = req.headers['x-sl-token'] || url.searchParams.get('token') || '';
    const role = app.auth.roleOf(req, token);
    try {
      const route = routes[`${req.method} ${url.pathname}`];
      if (route) return await route(req, res, url, role);
      if (url.pathname.startsWith('/assets/')) {
        const file = path.normalize(path.join(assets, decodeURIComponent(url.pathname.slice(8))));
        if (!file.startsWith(assets + path.sep)) return json(res, 403, { error: 'Forbidden' });
        return sendFile(res, file, 'max-age=3600');
      }
      if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Not found' });
      if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
      // The app itself (static files)
      const pub = cfg.publicDir;
      let file = path.normalize(path.join(pub, decodeURIComponent(url.pathname)));
      if (!file.startsWith(pub)) return json(res, 403, { error: 'Forbidden' });
      if (url.pathname === '/' || !path.extname(file)) file = path.join(pub, 'index.html');
      return sendFile(res, file, 'no-cache');
    } catch (e) {
      app.reportError(`${req.method} ${url.pathname}`, e);
      if (!res.headersSent) json(res, 500, { ok: false, error: e.message });
    }
  };
}

module.exports = { makeHandler, interfaces };
