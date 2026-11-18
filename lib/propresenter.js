'use strict';
// ProPresenter 7 (7.9+) network API client.
// In ProPresenter: Settings > Network > Enable Network, note the port.
// Slide changes arrive on a streaming connection (POST /v1/status/updates, one JSON object per
// change) the moment they happen; if that is not available it falls back to polling:
//   GET /v1/presentation/slide_index   -> which presentation and slide is live
//   GET /v1/presentation/active        -> the presentation's groups (Verse 1, Chorus...) and their colours
//   GET /v1/presentation/{uuid}/thumbnail/{index} -> slide image (for the 3D screens and colour matching)
const http = require('http');
const { EventEmitter } = require('events');

function getJson(host, port, path, timeout = 1500) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host, port, path, timeout, headers: { Accept: 'application/json' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode === 204 || !body.trim()) return resolve(null);
        if (res.statusCode >= 400) return reject(new Error(`ProPresenter answered ${res.statusCode} for ${path}`));
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error(`ProPresenter sent something that is not JSON for ${path}`));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('ProPresenter did not answer (check the address, port and that Network is enabled)')));
    req.on('error', reject);
  });
}

function getRaw(host, port, path, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host, port, path, timeout }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => (res.statusCode >= 400 ? reject(new Error(`HTTP ${res.statusCode}`)) : resolve({ type: res.headers['content-type'] || 'image/jpeg', data: Buffer.concat(chunks) })));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

// Splits a stream of concatenated JSON objects (with any whitespace between them) into objects.
function jsonSplitter(onObject) {
  let buf = '';
  let depth = 0, inStr = false, esc = false, start = -1, scanned = 0;
  return (chunk) => {
    buf += chunk;
    for (let i = scanned; i < buf.length; i++) {
      const c = buf[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '{' || c === '[') {
        if (depth++ === 0) start = i;
      } else if ((c === '}' || c === ']') && depth > 0 && --depth === 0) {
        try { onObject(JSON.parse(buf.slice(start, i + 1))); } catch {}
        buf = buf.slice(i + 1);
        i = -1;
        start = -1;
      }
    }
    scanned = buf.length;
    if (depth === 0 && !inStr) { buf = buf.trimStart(); scanned = buf.length; }
    if (buf.length > 5e6) { buf = ''; depth = 0; scanned = 0; } // something is wrong: start over
  };
}

// ProPresenter colours are { red, green, blue, alpha } from 0 to 1.
const toRgb = (c) => (c && typeof c === 'object' && 'red' in c ? [Number(c.red) || 0, Number(c.green) || 0, Number(c.blue) || 0] : null);

// Normalise the presentation details into { uuid, name, groups: [{ name, color, start, count }] }.
function parsePresentation(json) {
  const p = (json && (json.presentation || json)) || {};
  const id = p.id || {};
  const groups = [];
  let start = 0;
  for (const g of Array.isArray(p.groups) ? p.groups : []) {
    const count = Array.isArray(g.slides) ? g.slides.length : 0;
    groups.push({ name: String(g.name || '').trim(), color: toRgb(g.color), start, count });
    start += count;
  }
  return { uuid: id.uuid || p.uuid || null, name: String(id.name || p.name || ''), groups };
}

function parseSlideIndex(json) {
  const pi = json && (json.presentation_index || json);
  if (!pi || pi.index === undefined || pi.index === null) return null;
  const id = pi.presentation_id || {};
  return { index: Number(pi.index), uuid: id.uuid || null, name: String(id.name || '') };
}

const groupAt = (pres, index) => pres.groups.find((g) => index >= g.start && index < g.start + g.count) || null;

class ProPresenter extends EventEmitter {
  constructor(log = console) {
    super();
    this.log = log;
    this.cfg = { enabled: false, host: '', port: 0 };
    this.state = { connected: false, error: null, presentation: null, index: null, group: null };
    this.details = null;
    this.timer = null;
  }

  configure(cfg) {
    const next = { enabled: !!cfg.enabled, host: String(cfg.host || '').trim(), port: Number(cfg.port) || 0 };
    const same = JSON.stringify(next) === JSON.stringify(this.cfg);
    this.cfg = next;
    if (same && (this.timer || !next.enabled)) return;
    clearTimeout(this.timer);
    this.timer = null;
    this.stopStream();
    this.noStreamUntil = 0;
    this.details = null;
    this.last = null;
    if (next.enabled && next.host && next.port) this.loop();
    else this.setState({ connected: false, error: next.enabled ? 'Enter the ProPresenter address and port' : null });
  }

  setState(patch) {
    const before = JSON.stringify(this.state);
    Object.assign(this.state, patch);
    if (JSON.stringify(this.state) !== before) this.emit('status', this.state);
  }

  // Streaming connection: ProPresenter sends the slide index every time it changes.
  startStream() {
    const { host, port } = this.cfg;
    if (this.stream || !host || !port || Date.now() < (this.noStreamUntil || 0)) return;
    const body = JSON.stringify(['presentation/slide_index']);
    const req = http.request({ host, port, path: '/v1/status/updates', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Accept: 'application/json' } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return fail(new Error(`HTTP ${res.statusCode}`));
      }
      res.setEncoding('utf8');
      const split = jsonSplitter((obj) => {
        if (!obj || (obj.url && !/slide_index/.test(obj.url))) return;
        const si = parseSlideIndex(obj.data !== undefined ? obj.data : obj);
        this.streamed = Date.now();
        this.handle(si).catch((e) => this.setState({ connected: false, error: e.message }));
      });
      this.streaming = true;
      this.setState({ streaming: true });
      res.on('data', split);
      res.on('end', () => fail(null));
      res.on('error', fail);
    });
    const fail = (err) => {
      if (this.stream !== req) return;
      this.stream = null;
      this.streaming = false;
      this.setState({ streaming: false });
      try { req.destroy(); } catch {}
      // Older ProPresenter versions have no streaming: keep polling and try again later.
      this.noStreamUntil = Date.now() + (err ? 30000 : 3000);
    };
    req.setTimeout(0);
    req.on('error', fail);
    req.end(body);
    this.stream = req;
  }

  stopStream() {
    if (this.stream) try { this.stream.destroy(); } catch {}
    this.stream = null;
    this.streaming = false;
  }

  async loop() {
    const { host, port } = this.cfg;
    try {
      this.startStream();
      // While streaming, a slow poll only checks the connection is still there.
      if (this.streaming && Date.now() - (this.lastPoll || 0) < 5000) {
        if (this.cfg.enabled) this.timer = setTimeout(() => this.loop(), 350);
        return;
      }
      this.lastPoll = Date.now();
      await this.handle(parseSlideIndex(await getJson(host, port, '/v1/presentation/slide_index')));
    } catch (e) {
      this.details = null;
      this.stopStream();
      this.setState({ connected: false, error: e.message });
    }
    if (this.cfg.enabled) this.timer = setTimeout(() => this.loop(), this.state.connected ? 350 : 3000);
  }

  // A slide index (from the stream or a poll): look up the group and tell the engine if it changed.
  async handle(si) {
    const { host, port } = this.cfg;
    {
      if (!si) {
        this.setState({ connected: true, error: null, index: null, group: null });
      } else {
        if (!this.details || (si.uuid && this.details.uuid !== si.uuid)) {
          let pres = null;
          try {
            pres = parsePresentation(await getJson(host, port, '/v1/presentation/active'));
          } catch {}
          if ((!pres || !pres.groups.length || (si.uuid && pres.uuid && pres.uuid !== si.uuid)) && si.uuid) {
            pres = parsePresentation(await getJson(host, port, `/v1/presentation/${encodeURIComponent(si.uuid)}`));
          }
          this.details = { ...pres, uuid: pres.uuid || si.uuid, name: pres.name || si.name };
        }
        const key = `${this.details.uuid}|${si.index}`;
        const group = groupAt(this.details, si.index);
        this.setState({ connected: true, error: null, presentation: { uuid: this.details.uuid, name: this.details.name }, index: si.index, group: group ? { name: group.name, color: group.color } : null });
        if (key !== this.last) {
          this.last = key;
          this.emit('slide', {
            presentation: { uuid: this.details.uuid, name: this.details.name },
            index: si.index,
            group: group ? { name: group.name, color: group.color } : null,
            groups: this.details.groups.map((g) => g.name),
          });
        }
      }
    }
  }

  thumbnail(uuid, index, quality = 320) {
    const { host, port } = this.cfg;
    if (!host || !port) return Promise.reject(new Error('ProPresenter is not set up'));
    return getRaw(host, port, `/v1/presentation/${encodeURIComponent(uuid)}/thumbnail/${Number(index) || 0}?quality=${quality}`);
  }

  close() {
    this.cfg.enabled = false;
    clearTimeout(this.timer);
    this.stopStream();
  }
}

module.exports = { ProPresenter, parsePresentation, parseSlideIndex, groupAt, jsonSplitter };
