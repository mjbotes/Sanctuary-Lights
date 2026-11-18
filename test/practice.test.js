'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadConfig } = require('../lib/server/config');
const { App } = require('../lib/server/app');

const quiet = { log() {}, warn() {}, error() {} };

test('practice mode: the real lights stay, the screens show practice, leaving puts it all back', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-practice-'));
  const app = new App(loadConfig({ LIGHTS_DATA: dir, PORT: '0' }), quiet);
  const sent = [];
  app.devices.output.send = (u) => sent.push(u);
  app.devices.startLoop(40);
  try {
    const e = app.engine;
    const song = e.show.songs.find((s) => s.name === 'Graves Into Gardens');
    const chorus = song.sections.find((s) => s.name === 'Chorus 2');
    app.run({ type: 'section.edit', songId: song.id, id: chorus.id, fade: 0 }); // no fade, so the stage is settled
    app.run({ type: 'song.select', id: song.id });
    app.run({ type: 'section.go', songId: song.id, id: chorus.id });
    await new Promise((ok) => setTimeout(ok, 120));
    const real = sent.at(-1).get(1).slice();
    app.run({ type: 'practice.set', on: true });
    assert.ok(app.engine.runtimeState().practice, 'every screen is told');
    // Practise: blackout, another part, another song
    app.run({ type: 'blackout.set', on: true });
    app.run({ type: 'part.go', id: 'sermon' });
    app.run({ type: 'section.go', songId: song.id, id: song.sections[0].id });
    await new Promise((ok) => setTimeout(ok, 120));
    assert.deepStrictEqual([...sent.at(-1).get(1)], [...real], 'the real lights did not change');
    assert.strictEqual(e.liveState(app.latestLook).fixtures[e.show.fixtures[0].id].d, 0, 'the screens show the practice (blackout)');
    // A restart during practice must not bring practice onto the lights
    assert.strictEqual(e.persistentRuntime().sectionId, song.sections.find((s) => s.name === 'Chorus 2').id);
    // Leave, putting everything back
    app.run({ type: 'practice.set', on: false });
    assert.strictEqual(e.rt.blackout, false);
    assert.strictEqual(e.rt.partId, 'worship');
    assert.strictEqual(e.rt.sectionId, song.sections.find((s) => s.name === 'Chorus 2').id);
    await new Promise((ok) => setTimeout(ok, 120));
    assert.deepStrictEqual([...sent.at(-1).get(1)].slice(0, 20), [...real].slice(0, 20), 'no jump on the real lights');
    // Leave keeping the practice: it goes to the lights
    app.run({ type: 'practice.set', on: true });
    app.run({ type: 'blackout.set', on: true });
    app.run({ type: 'practice.set', on: false, keep: true });
    await new Promise((ok) => setTimeout(ok, 120));
    const front1 = e.show.fixtures.find((f) => f.name === 'Front 1'); // Dim + RGBW: channel 1 is the dimmer
    assert.ok(real[front1.address - 1] > 0, 'it was lit');
    assert.strictEqual(sent.at(-1).get(1)[front1.address - 1], 0, 'blackout reached the lights');
    assert.strictEqual(e.rt.blackout, true);
  } finally {
    app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
