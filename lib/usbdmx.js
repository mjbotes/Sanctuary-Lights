'use strict';
// USB-DMX output for Enttec DMX USB Pro and "Pro-compatible" interfaces (DMXking ultraDMX, etc.).
//
// No drivers needed on a Mac: these interfaces use an FTDI chip and macOS includes Apple's FTDI
// driver, so the interface appears as /dev/cu.usbserial-XXXX when plugged in. On Linux it appears
// as /dev/ttyUSB0 (kernel driver), on Windows as a COM port (Windows Update installs the FTDI driver).
//
// The device is found automatically (leave "Device" empty), reconnected when it is unplugged and
// plugged back in, and its status is shown in Setup.
// Not supported: simple "Open DMX" cables and uDMX sticks - they need exact timing a serial port
// cannot give. Use an Art-Net / sACN node for those.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const BAUD = 115200; // the Pro protocol is packet based; this only matters for some compatible clones

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

// ----- finding the interface ---------------------------------------------------------
const run = (cmd, args) => new Promise((resolve) => execFile(cmd, args, { timeout: 4000, windowsHide: true }, (err, out) => resolve(err ? '' : String(out))));

// Returns a list of candidate devices, best first: [{ path, name }]
async function findDevices(platform = process.platform) {
  if (platform === 'darwin') {
    let names = [];
    try {
      names = fs.readdirSync('/dev').filter((n) => /^cu\.usbserial/i.test(n));
    } catch {}
    // Enttec serial numbers start with "EN"
    names.sort((a, b) => /-EN/i.test(b) - /-EN/i.test(a) || a.localeCompare(b));
    return names.map((n) => ({ path: `/dev/${n}`, name: n.replace(/^cu\./, '') }));
  }
  if (platform === 'linux') {
    const out = [];
    try {
      for (const n of fs.readdirSync('/dev/serial/by-id')) {
        if (/ftdi|enttec|dmx|ultradmx/i.test(n)) out.push({ path: fs.realpathSync(path.join('/dev/serial/by-id', n)), name: n });
      }
    } catch {}
    if (!out.length) {
      try {
        for (const n of fs.readdirSync('/dev').filter((x) => /^ttyUSB\d+$/.test(x))) out.push({ path: `/dev/${n}`, name: n });
      } catch {}
    }
    out.sort((a, b) => /enttec|dmx/i.test(b.name) - /enttec|dmx/i.test(a.name));
    return out;
  }
  if (platform === 'win32') {
    // FTDI devices have VID_0403; ask Windows for present serial ports
    const ps = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command',
      "Get-PnpDevice -Class Ports -PresentOnly | Select-Object FriendlyName,InstanceId | ConvertTo-Json -Compress"]);
    let list = [];
    try {
      list = [].concat(JSON.parse(ps || '[]'));
    } catch {}
    const out = [];
    for (const d of list) {
      const m = /\((COM\d+)\)/.exec(d.FriendlyName || '');
      if (!m) continue;
      out.push({ path: `\\\\.\\${m[1]}`, name: `${d.FriendlyName}`, ftdi: /VID_0403/i.test(d.InstanceId || '') });
    }
    out.sort((a, b) => b.ftdi - a.ftdi || /dmx|enttec/i.test(b.name) - /dmx|enttec/i.test(a.name));
    return out.filter((d) => d.ftdi || /dmx|enttec/i.test(d.name));
  }
  return [];
}

// Put the serial port in raw mode at our baud rate
async function configurePort(dev, platform = process.platform) {
  if (platform === 'darwin') await run('stty', ['-f', dev, 'raw', String(BAUD), 'cs8', '-cstopb', '-parenb', 'clocal']);
  else if (platform === 'linux') await run('stty', ['-F', dev, 'raw', String(BAUD), 'cs8', '-cstopb', '-parenb', 'clocal']);
  else if (platform === 'win32') {
    const com = dev.replace(/^\\\\\.\\/, '');
    await run('mode', [com, `BAUD=${BAUD}`, 'PARITY=N', 'DATA=8', 'STOP=1']);
  }
}

class UsbDmx {
  constructor(log = console) {
    this.log = log;
    this.stream = null;
    this.device = null;
    this.wanted = null; // { enabled, port ('' = automatic), universe }
    this.status = { state: 'off', device: null, message: 'Off' };
    this.scanTimer = null;
    this.busy = false;
  }

  configure({ enabled, port, universe }) {
    const next = { enabled: !!enabled, port: String(port || '').trim(), universe: Number(universe) || 1 };
    const changed = JSON.stringify(next) !== JSON.stringify(this.wanted);
    this.wanted = next;
    if (!changed) return;
    this.close(false);
    if (!next.enabled) return this.setStatus('off', null, 'Off');
    this.connect();
    clearInterval(this.scanTimer);
    // Keep looking (plugged in later, or unplugged and back)
    this.scanTimer = setInterval(() => !this.stream && this.connect(), 3000);
    this.scanTimer.unref && this.scanTimer.unref();
  }

  setStatus(state, device, message) {
    const changed = this.status.state !== state || this.status.message !== message;
    this.status = { state, device, message };
    if (changed && this.onStatus) this.onStatus(this.status);
  }

  async connect() {
    if (this.busy || !this.wanted || !this.wanted.enabled || this.stream) return;
    this.busy = true;
    try {
      let dev = this.wanted.port;
      if (dev && process.platform === 'win32' && /^COM\d+$/i.test(dev)) dev = `\\\\.\\${dev.toUpperCase()}`;
      if (!dev) {
        const found = await findDevices();
        if (!found.length) return this.setStatus('searching', null, 'No USB-DMX interface found. Plug it in (it is found automatically).');
        dev = found[0].path;
      } else if (process.platform !== 'win32' && !fs.existsSync(dev)) {
        return this.setStatus('searching', dev, `${dev} is not connected`);
      }
      await configurePort(dev);
      if (!this.wanted || !this.wanted.enabled) return;
      const stream = fs.createWriteStream(dev, { flags: 'w' });
      stream.on('error', (e) => {
        this.log.warn(`USB-DMX ${dev}: ${e.message}`);
        if (this.stream === stream) {
          this.stream = null;
          this.setStatus('searching', dev, `Lost connection to ${path.basename(dev)} (unplugged?) - reconnecting`);
        }
      });
      stream.on('open', () => this.setStatus('connected', dev, `Sending to ${path.basename(dev)}`));
      this.stream = stream;
      this.device = dev;
    } finally {
      this.busy = false;
    }
  }

  // Called by the DMX loop with all universes; sends the chosen one
  send(universes) {
    if (!this.stream || !this.wanted) return;
    const data = universes.get(this.wanted.universe) || new Uint8Array(512);
    // Do not queue up frames if the interface is slower than our frame rate
    if (this.stream.writableLength < 2048) this.stream.write(enttecProPacket(data));
  }

  close(stopScanning = true) {
    if (stopScanning) clearInterval(this.scanTimer);
    if (this.stream) {
      try { this.stream.destroy(); } catch {}
    }
    this.stream = null;
  }
}

module.exports = { UsbDmx, enttecProPacket, findDevices };
