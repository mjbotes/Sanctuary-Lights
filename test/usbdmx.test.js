'use strict';
// USB-DMX: packets, status, reconnect after unplugging (a temporary file stands in for the device).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { UsbDmx, enttecProPacket } = require('../lib/usbdmx');

const quiet = { warn() {}, log() {} };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('Enttec Pro packet layout', () => {
  const data = new Uint8Array(512);
  data[0] = 255;
  data[511] = 7;
  const p = enttecProPacket(data);
  assert.strictEqual(p.length, 518);
  assert.deepStrictEqual([p[0], p[1], p[2], p[3], p[4], p[5], p[516], p[517]], [0x7e, 6, 0x01, 0x02, 0, 255, 7, 0xe7]);
});

test('sends the chosen universe to the device and reports its status', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-usb-'));
  const dev = path.join(dir, 'cu.usbserial-EN000001');
  fs.writeFileSync(dev, '');
  const usb = new UsbDmx(quiet);
  try {
    assert.strictEqual(usb.status.state, 'off');
    usb.configure({ enabled: true, port: dev, universe: 2 });
    for (let i = 0; i < 50 && usb.status.state !== 'connected'; i++) await wait(20);
    assert.strictEqual(usb.status.state, 'connected');
    assert.match(usb.status.message, /Sending to cu\.usbserial-EN000001/);
    const u1 = new Uint8Array(512).fill(1), u2 = new Uint8Array(512).fill(2);
    usb.send(new Map([[1, u1], [2, u2]]));
    await wait(50);
    const written = fs.readFileSync(dev);
    assert.strictEqual(written.length, 518);
    assert.strictEqual(written[5], 2, 'universe 2 was sent');
    // A missing device is reported and looked for again
    usb.configure({ enabled: true, port: path.join(dir, 'not-there'), universe: 1 });
    await wait(50);
    assert.strictEqual(usb.status.state, 'searching');
    usb.configure({ enabled: false, port: '', universe: 1 });
    assert.strictEqual(usb.status.state, 'off');
  } finally {
    usb.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
