'use strict';
// ProPresenter 7 (7.9+) network API client.
// In ProPresenter: Settings > Network > Enable Network, note the port. This client polls
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

  async loop() {
    const { host, port } = this.cfg;
    try {
      const si = parseSlideIndex(await getJson(host, port, '/v1/presentation/slide_index'));
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
    } catch (e) {
      this.details = null;
      this.setState({ connected: false, error: e.message });
    }
    if (this.cfg.enabled) this.timer = setTimeout(() => this.loop(), this.state.connected ? 350 : 3000);
  }

  thumbnail(uuid, index, quality = 320) {
    const { host, port } = this.cfg;
    if (!host || !port) return Promise.reject(new Error('ProPresenter is not set up'));
    return getRaw(host, port, `/v1/presentation/${encodeURIComponent(uuid)}/thumbnail/${Number(index) || 0}?quality=${quality}`);
  }

  close() {
    this.cfg.enabled = false;
    clearTimeout(this.timer);
  }
}

module.exports = { ProPresenter, parsePresentation, parseSlideIndex, groupAt };
