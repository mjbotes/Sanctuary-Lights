'use strict';
// Hardware controllers: Launchpad grid, lights, hold-to-Panic, and Learn for any controller.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadConfig } = require('../lib/server/config');
const { App } = require('../lib/server/app');
const { gridKey, velFor } = require('../lib/controller');

const quiet = { log() {}, warn() {}, error() {} };
function setup(profile = 'launchpad') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-ctl-'));
  const app = new App(loadConfig({ LIGHTS_DATA: dir, PORT: '0' }), quiet);
  const sent = [];
  const ctl = app.devices.controller;
  ctl.midi = { setControllerPort() {}, outPorts: () => ['Launchpad Mini MK3 LPMiniMK3 MIDI'], send: (port, bytes) => sent.push([port, bytes]) };
  app.run({ type: 'settings.controller', controller: { enabled: true, port: 'Launchpad Mini MK3 LPMiniMK3 MIDI', profile } });
  return { app, ctl, sent, done: () => { app.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}
const press = (ctl, note) => ctl.message([0x90, note, 127]);
const release = (ctl, note) => ctl.message([0x90, note, 0]);

test('grid layout', () => {
  assert.strictEqual(gridKey(8, 1), 'part:0');
  assert.strictEqual(gridKey(7, 1), 'sec:0');
  assert.strictEqual(gridKey(5, 8), 'sec:23');
  assert.strictEqual(gridKey(4, 3), 'pad:2');
  assert.strictEqual(gridKey(2, 1), 'song:0');
  assert.deepStrictEqual([1, 2, 3, 4, 5, 6, 7, 8].map((c) => gridKey(1, c)), ['prev', 'next', 'item', 'flash', 'strobe', 'blackout', 'panic', 'tap']);
  assert.strictEqual(velFor('#ff0000'), 5);
  assert.strictEqual(velFor('#00ff00'), 21);
});

test('Launchpad: programmer mode, buttons run the service, lights follow', async () => {
  const t = setup();
  try {
    const e = t.app.engine;
    assert.ok(t.sent.some(([, b]) => b[0] === 0xf0), 'switched to Programmer mode');
    // Row 2: songs; pick Graves Into Gardens (song 2 of the set list)
    const gig = e.setList().findIndex((s) => s.name === 'Graves Into Gardens');
    press(t.ctl, 21 + gig);
    assert.strictEqual(e.song(e.rt.songId).name, 'Graves Into Gardens');
    // Row 7: sections; the 3rd section
    press(t.ctl, 73);
    assert.strictEqual(e.rt.sectionId, e.song(e.rt.songId).sections[2].id);
    // Row 8: parts; Sermon is the 3rd
    press(t.ctl, 83);
    assert.strictEqual(e.rt.partId, 'sermon');
    // Bottom row: next section brings worship back
    press(t.ctl, 12);
    assert.strictEqual(e.rt.partId, 'worship');
    assert.strictEqual(e.rt.sectionId, e.song(e.rt.songId).sections[3].id);
    // Flash is held
    press(t.ctl, 14);
    assert.strictEqual(e.rt.flashAll, true);
    release(t.ctl, 14);
    assert.strictEqual(e.rt.flashAll, false);
    // Blackout toggles
    press(t.ctl, 16);
    assert.strictEqual(e.rt.blackout, true);
    press(t.ctl, 16);
    assert.strictEqual(e.rt.blackout, false);
    // Panic only after holding 1 second
    e.rt.gm = 0.3;
    press(t.ctl, 17);
    release(t.ctl, 17);
    assert.strictEqual(e.rt.gm, 0.3, 'a tap does not panic');
    press(t.ctl, 17);
    await new Promise((ok) => setTimeout(ok, 1100));
    release(t.ctl, 17);
    assert.strictEqual(e.rt.gm, 1, 'held: panic');
    // Lights: the current section pulses, Worship is green
    t.sent.length = 0;
    t.ctl.sentLights.clear(); // send them all again
    t.ctl.refreshLights();
    const light = (note) => (t.sent.filter(([, b]) => b[1] === note).at(-1) || [])[1];
    assert.strictEqual(light(81)[2], 21, 'Worship lit green');
    assert.strictEqual(light(74)[0], 0x92, 'current section pulses');
    // Only changes are sent
    t.sent.length = 0;
    t.ctl.refreshLights();
    assert.strictEqual(t.sent.length, 0);
  } finally {
    t.done();
  }
});

test('any controller: Learn a button, then it works (and lights)', () => {
  const t = setup('generic');
  try {
    const e = t.app.engine;
    t.app.run({ type: 'controller.learn', key: 'blackout' });
    t.ctl.message([0xb1, 20, 127]); // CC 20 on channel 2
    assert.deepStrictEqual(e.show.settings.controller.learned.blackout, { t: 'cc', ch: 1, n: 20 });
    assert.strictEqual(e.rt.controllerLearn, null);
    assert.strictEqual(e.rt.blackout, false, 'learning does not also press it');
    t.ctl.message([0xb1, 20, 127]);
    assert.strictEqual(e.rt.blackout, true);
    t.app.run({ type: 'controller.learn', key: 'part:2' });
    t.ctl.message([0x90, 60, 100]);
    t.ctl.message([0x90, 60, 100]);
    assert.strictEqual(e.rt.partId, 'sermon');
    t.ctl.refreshLights();
    assert.ok(t.sent.some(([, b]) => b[0] === 0x90 && b[1] === 60 && b[2] === 127), 'the learned note lights up');
    // Controller notes never reach the song triggers (separate port in MidiIn)
  } finally {
    t.done();
  }
});
