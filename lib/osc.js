'use strict';
// OSC (Open Sound Control) input over UDP: TouchOSC, Bitfocus Companion / Stream Deck, QLab,
// Ableton (via OSC devices), ProPresenter-style controllers, etc.
const dgram = require('dgram');
const { EventEmitter } = require('events');

function readString(buf, off) {
  let end = off;
  while (end < buf.length && buf[end] !== 0) end++;
  const s = buf.toString('utf8', off, end);
  return { value: s, next: (end + 4) & ~3 }; // includes the terminating 0, padded to 4 bytes
}

// Parse one OSC packet into a list of { address, args } (bundles are flattened).
function parseOsc(buf, depth = 0) {
  if (depth > 8 || buf.length < 4) return [];
  const first = readString(buf, 0);
  if (first.value === '#bundle') {
    const out = [];
    let off = 16; // "#bundle\0" + 8-byte time tag
    while (off + 4 <= buf.length) {
      const size = buf.readInt32BE(off);
      off += 4;
      if (size <= 0 || off + size > buf.length) break;
      out.push(...parseOsc(buf.subarray(off, off + size), depth + 1));
      off += size;
    }
    return out;
  }
  if (!first.value.startsWith('/')) return [];
  const args = [];
  let off = first.next;
  if (off < buf.length && buf[off] === 0x2c) {
    const tags = readString(buf, off);
    off = tags.next;
    for (const t of tags.value.slice(1)) {
      if (t === 'i') { args.push(buf.readInt32BE(off)); off += 4; }
      else if (t === 'f') { args.push(buf.readFloatBE(off)); off += 4; }
      else if (t === 'd') { args.push(buf.readDoubleBE(off)); off += 8; }
      else if (t === 'h') { args.push(Number(buf.readBigInt64BE(off))); off += 8; }
      else if (t === 's' || t === 'S') { const r = readString(buf, off); args.push(r.value); off = r.next; }
      else if (t === 'b') { const n = buf.readInt32BE(off); off += 4 + ((n + 3) & ~3); }
      else if (t === 'T') args.push(true);
      else if (t === 'F') args.push(false);
      else if (t === 'N' || t === 'I') args.push(null);
      else if (t === 'c') { args.push(String.fromCharCode(buf.readInt32BE(off))); off += 4; }
      else if (t === 'r' || t === 'm') { off += 4; }
      else break; // unknown type: stop reading arguments
      if (off > buf.length) break;
    }
  }
  return [{ address: first.value, args }];
}

// Build an OSC message (used by the tests and by anyone who wants to send to us).
function encodeOsc(address, args = []) {
  const str = (s) => { const b = Buffer.from(`${s}\0`, 'utf8'); return Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]); };
  let tags = ',';
  const parts = [];
  for (const a of args) {
    if (typeof a === 'string') { tags += 's'; parts.push(str(a)); }
    else if (Number.isInteger(a)) { tags += 'i'; const b = Buffer.alloc(4); b.writeInt32BE(a); parts.push(b); }
    else if (typeof a === 'number') { tags += 'f'; const b = Buffer.alloc(4); b.writeFloatBE(a); parts.push(b); }
    else if (a === true) tags += 'T';
    else if (a === false) tags += 'F';
  }
  return Buffer.concat([str(address), str(tags), ...parts]);
}

class OscIn extends EventEmitter {
  constructor(log = console) {
    super();
    this.log = log;
    this.socket = null;
    this.port = 0;
    this.error = null;
  }

  configure(enabled, port) {
    port = Number(port) || 0;
    if (enabled && port && this.socket && this.port === port) return;
    this.close();
    if (!enabled || !port) return;
    this.port = port;
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    sock.on('message', (buf, rinfo) => {
      let msgs = [];
      try {
        msgs = parseOsc(buf);
      } catch {
        return;
      }
      for (const m of msgs) this.emit('message', { ...m, from: rinfo.address });
    });
    sock.on('error', (e) => {
      this.error = e.code === 'EADDRINUSE' ? `Port ${port} is in use by another program` : e.message;
      this.log.warn(`OSC: ${this.error}`);
      this.emit('status');
    });
    sock.bind(port, () => {
      this.error = null;
      this.emit('status');
    });
    this.socket = sock;
  }

  status() {
    return { listening: !!this.socket && !this.error, port: this.port, error: this.error };
  }

  close() {
    if (this.socket) try { this.socket.close(); } catch {}
    this.socket = null;
  }
}

module.exports = { OscIn, parseOsc, encodeOsc };
