'use strict';
// DMX output: Art-Net, sACN (E1.31) and Enttec DMX USB Pro.
const dgram = require('dgram');
const fs = require('fs');
const { execFile } = require('child_process');

function artnetPacket(universe, data, sequence) {
  // universe here is the 15-bit Art-Net port address (0-based).
  const buf = Buffer.alloc(18 + 512);
  buf.write('Art-Net\0', 0, 'ascii');
  buf.writeUInt16LE(0x5000, 8); // OpDmx
  buf.writeUInt16BE(14, 10); // protocol version
  buf.writeUInt8(sequence & 0xff, 12);
  buf.writeUInt8(0, 13); // physical
  buf.writeUInt16LE(universe & 0x7fff, 14);
  buf.writeUInt16BE(512, 16);
  Buffer.from(data.buffer, data.byteOffset, 512).copy(buf, 18);
  return buf;
}

function sacnPacket(universe, data, sequence, cid, sourceName, priority) {
  const buf = Buffer.alloc(638);
  // Root layer
  buf.writeUInt16BE(0x0010, 0);
  buf.writeUInt16BE(0x0000, 2);
  buf.write('ASC-E1.17\0\0\0', 4, 'ascii');
  buf.writeUInt16BE(0x7000 | (638 - 16), 16);
  buf.writeUInt32BE(0x00000004, 18);
  cid.copy(buf, 22, 0, 16);
  // Framing layer
  buf.writeUInt16BE(0x7000 | (638 - 38), 38);
  buf.writeUInt32BE(0x00000002, 40);
  buf.write(String(sourceName).slice(0, 63), 44, 'utf8');
  buf.writeUInt8(priority, 108);
  buf.writeUInt16BE(0, 109); // sync address
  buf.writeUInt8(sequence & 0xff, 111);
  buf.writeUInt8(0, 112); // options
  buf.writeUInt16BE(universe, 113);
  // DMP layer
  buf.writeUInt16BE(0x7000 | (638 - 115), 115);
  buf.writeUInt8(0x02, 117);
  buf.writeUInt8(0xa1, 118);
  buf.writeUInt16BE(0x0000, 119);
  buf.writeUInt16BE(0x0001, 121);
  buf.writeUInt16BE(513, 123);
  buf.writeUInt8(0, 125); // start code
  Buffer.from(data.buffer, data.byteOffset, 512).copy(buf, 126);
  return buf;
}

function sacnMulticastAddress(universe) {
  return `239.255.${(universe >> 8) & 0xff}.${universe & 0xff}`;
}

function enttecProPacket(data) {
  const buf = Buffer.alloc(5 + 513);
  buf[0] = 0x7e;
  buf[1] = 6; // Output Only Send DMX Packet
  buf.writeUInt16LE(513, 2);
  buf[4] = 0; // start code
  Buffer.from(data.buffer, data.byteOffset, 512).copy(buf, 5);
  buf[517] = 0xe7;
  return buf;
}

class Output {
  constructor(log = console) {
    this.log = log;
    this.settings = null;
    this.seq = 0;
    this.socket = null;
    this.enttec = null;
    this.enttecPath = null;
    this.lastError = null;
  }

  configure(settings) {
    this.settings = settings;
    const needUdp = settings.artnet || settings.sacn;
    if (needUdp && !this.socket) {
      this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      this.socket.on('error', (e) => this.error(`Network: ${e.message}`));
      this.socket.bind(() => {
        try {
          this.socket.setBroadcast(true);
          this.socket.setMulticastTTL(8);
          this.applyInterface();
        } catch (e) {
          this.error(`Network: ${e.message}`);
        }
      });
    } else if (this.socket) {
      this.applyInterface();
    }
    const want = settings.enttec && settings.enttecPort ? settings.enttecPort : null;
    if (want !== this.enttecPath) this.openEnttec(want);
  }

  applyInterface() {
    if (!this.socket || !this.settings) return;
    try {
      if (this.settings.sacnInterface) this.socket.setMulticastInterface(this.settings.sacnInterface);
    } catch (e) {
      this.error(`sACN interface: ${e.message}`);
    }
  }

  openEnttec(path) {
    if (this.enttec) {
      this.enttec.destroy();
      this.enttec = null;
    }
    this.enttecPath = path;
    if (!path) return;
    const flag = process.platform === 'darwin' ? '-f' : '-F';
    execFile('stty', [flag, path, 'raw', '57600'], (err) => {
      if (err) this.log.warn(`stty on ${path} failed (continuing): ${err.message}`);
      if (this.enttecPath !== path) return;
      const stream = fs.createWriteStream(path, { flags: 'w' });
      stream.on('error', (e) => {
        this.error(`USB DMX (${path}): ${e.message}`);
        if (this.enttec === stream) this.enttec = null;
      });
      this.enttec = stream;
    });
  }

  error(msg) {
    if (msg !== this.lastError) this.log.warn(msg);
    this.lastError = msg;
  }

  // universes: Map<number (1-based UI universe), Uint8Array(512)>
  send(universes) {
    const s = this.settings;
    if (!s) return;
    this.seq = (this.seq % 255) + 1;
    for (const [u, data] of universes) {
      if (s.artnet && this.socket) {
        const port = u - 1 + (s.artnetBase || 0);
        if (port >= 0) this.udp(artnetPacket(port, data, this.seq), 6454, s.artnetTarget || '255.255.255.255');
      }
      if (s.sacn && this.socket && u >= 1 && u <= 63999) {
        const pkt = sacnPacket(u, data, this.seq, Buffer.from(s.cid, 'hex'), s.sourceName || 'Sanctuary Lights', s.sacnPriority ?? 100);
        this.udp(pkt, 5568, s.sacnUnicast || sacnMulticastAddress(u));
      }
      if (s.enttec && this.enttec && u === (s.enttecUniverse || 1) && this.enttec.writableLength < 4096) {
        this.enttec.write(enttecProPacket(data));
      }
    }
  }

  udp(buf, port, host) {
    this.socket.send(buf, port, host, (err) => {
      if (err) this.error(`Send to ${host}:${port}: ${err.message}`);
    });
  }

  close() {
    if (this.socket) this.socket.close();
    if (this.enttec) this.enttec.destroy();
  }
}

module.exports = { Output, artnetPacket, sacnPacket, sacnMulticastAddress, enttecProPacket };
