'use strict';
// Art-Net / sACN input: listen to another lighting desk.
//   merge  - highest level wins per channel between the desk and Sanctuary Lights (HTP)
//   backup - pass the desk's output through while it is sending; take over when it stops
const dgram = require('dgram');
const os = require('os');

const FRESH_MS = 2500;

function ownAddresses() {
  const out = new Set(['127.0.0.1']);
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4') out.add(a.address);
  return out;
}

// Parse an ArtDmx packet -> { port, data } or null
function parseArtnet(buf) {
  if (buf.length < 18 || buf.toString('ascii', 0, 8) !== 'Art-Net\0' || buf.readUInt16LE(8) !== 0x5000) return null;
  const port = buf.readUInt16LE(14) & 0x7fff;
  const len = Math.min(512, buf.readUInt16BE(16), buf.length - 18);
  const data = new Uint8Array(512);
  data.set(buf.subarray(18, 18 + len));
  return { port, data };
}

// Parse an E1.31 data packet -> { universe, data, cid, priority } or null
function parseSacn(buf) {
  if (buf.length < 126 || buf.toString('ascii', 4, 13) !== 'ASC-E1.17' || buf.readUInt32BE(18) !== 4 || buf.readUInt32BE(40) !== 2 || buf[117] !== 0x02) return null;
  if (buf[125] !== 0) return null; // start code 0 only
  const count = Math.min(513, buf.readUInt16BE(123)) - 1;
  const data = new Uint8Array(512);
  data.set(buf.subarray(126, 126 + Math.max(0, count)));
  return { universe: buf.readUInt16BE(113), data, cid: buf.subarray(22, 38).toString('hex'), priority: buf[108] };
}

class DmxInput {
  constructor(log = console) {
    this.log = log;
    this.cfg = { enabled: false };
    this.sockets = [];
    this.universes = new Map(); // UI universe -> { data, at, source }
    this.error = null;
  }

  // cfg: { enabled, protocol: 'artnet'|'sacn', mode: 'merge'|'backup', artnetBase, ownCid, universes: [1, 2...] }
  configure(cfg) {
    const next = { enabled: !!cfg.enabled, protocol: cfg.protocol === 'sacn' ? 'sacn' : 'artnet', mode: cfg.mode === 'backup' ? 'backup' : 'merge', artnetBase: cfg.artnetBase || 0, ownCid: cfg.ownCid || '', universes: (cfg.universes || [1]).slice(0, 64), ignoreOwn: cfg.ignoreOwn !== false };
    const key = JSON.stringify(next);
    if (key === this.key) return;
    this.key = key;
    this.close();
    this.cfg = next;
    this.universes.clear();
    if (!next.enabled) return;
    this.own = ownAddresses();
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    sock.on('error', (e) => {
      this.error = e.code === 'EADDRINUSE' ? 'The input port is in use by another program' : e.message;
      this.log.warn(`DMX input: ${this.error}`);
    });
    sock.on('message', (buf, rinfo) => this.receive(buf, rinfo));
    const port = next.protocol === 'sacn' ? 5568 : 6454;
    sock.bind(port, () => {
      this.error = null;
      if (next.protocol === 'sacn') {
        for (const u of next.universes) {
          try {
            sock.addMembership(`239.255.${(u >> 8) & 0xff}.${u & 0xff}`);
          } catch (e) {
            this.error = `sACN multicast: ${e.message}`;
          }
        }
      }
    });
    this.sockets.push(sock);
  }

  receive(buf, rinfo) {
    const c = this.cfg;
    if (c.protocol === 'artnet') {
      // Our own Art-Net output comes back as broadcast: ignore it
      if (c.ignoreOwn && this.own.has(rinfo.address)) return;
      const p = parseArtnet(buf);
      if (!p) return;
      const u = p.port + 1 - c.artnetBase;
      if (!c.universes.includes(u)) return;
      this.universes.set(u, { data: p.data, at: Date.now(), source: rinfo.address });
    } else {
      const p = parseSacn(buf);
      if (!p || p.cid === c.ownCid || !c.universes.includes(p.universe)) return;
      this.universes.set(p.universe, { data: p.data, at: Date.now(), source: rinfo.address });
    }
  }

  // Combine our rendered output with the input. Returns a new Map.
  apply(out, now = Date.now()) {
    if (!this.cfg.enabled || !this.universes.size) return out;
    const result = new Map(out);
    for (const [u, inp] of this.universes) {
      if (now - inp.at > FRESH_MS) continue;
      if (this.cfg.mode === 'backup') {
        result.set(u, inp.data); // the desk is running: pass it through
        continue;
      }
      const ours = out.get(u);
      const merged = new Uint8Array(512);
      for (let i = 0; i < 512; i++) merged[i] = Math.max(inp.data[i], ours ? ours[i] : 0);
      result.set(u, merged);
    }
    return result;
  }

  status(now = Date.now()) {
    return {
      enabled: this.cfg.enabled,
      mode: this.cfg.mode,
      error: this.error,
      universes: [...this.universes].map(([u, x]) => ({ universe: u, source: x.source, live: now - x.at <= FRESH_MS })),
    };
  }

  close() {
    for (const s of this.sockets) try { s.close(); } catch {}
    this.sockets = [];
  }
}

module.exports = { DmxInput, parseArtnet, parseSacn };
