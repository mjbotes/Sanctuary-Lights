'use strict';
// DMX output: Art-Net, sACN (E1.31) and Enttec DMX USB Pro.
const dgram = require('dgram');
const { UsbDmx, enttecProPacket } = require('./usbdmx');

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


class Output {
  constructor(log = console) {
    this.log = log;
    this.settings = null;
    this.seq = 0;
    this.socket = null;
    this.usb = new UsbDmx(log); // USB-DMX (Enttec Pro and compatible), found automatically
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
    this.usb.configure({ enabled: settings.enttec, port: settings.enttecPort, universe: settings.enttecUniverse || 1 });
  }

  applyInterface() {
    if (!this.socket || !this.settings) return;
    try {
      if (this.settings.sacnInterface) this.socket.setMulticastInterface(this.settings.sacnInterface);
    } catch (e) {
      this.error(`sACN interface: ${e.message}`);
    }
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
    if (s.enttec) this.usb.send(universes);
    for (const [u, data] of universes) {
      if (s.artnet && this.socket) {
        const port = u - 1 + (s.artnetBase || 0);
        if (port >= 0) this.udp(artnetPacket(port, data, this.seq), 6454, s.artnetTarget || '255.255.255.255');
      }
      if (s.sacn && this.socket && u >= 1 && u <= 63999) {
        const pkt = sacnPacket(u, data, this.seq, Buffer.from(s.cid, 'hex'), s.sourceName || 'Sanctuary Lights', s.sacnPriority ?? 100);
        this.udp(pkt, 5568, s.sacnUnicast || sacnMulticastAddress(u));
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
    this.usb.close();
  }
}

module.exports = { Output, artnetPacket, sacnPacket, sacnMulticastAddress, enttecProPacket };
