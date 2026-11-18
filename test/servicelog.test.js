'use strict';
// Service report: what happened, what caused it, problems.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadConfig } = require('../lib/server/config');
const { App } = require('../lib/server/app');

const quiet = { log() {}, warn() {}, error() {} };

test('the service report records songs, sections, parts, problems and their causes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-report-'));
  const app = new App(loadConfig({ LIGHTS_DATA: dir, PORT: '0' }), quiet);
  try {
    const e = app.engine;
    const song = e.show.songs.find((s) => s.name === 'Graves Into Gardens');
    app.run({ type: 'song.select', id: song.id }, 'operator');
    app.input({ type: 'midi.message', data: [0x90, 36, 100] }, 'MIDI');
    app.input({ type: 'pp.video', playing: true, name: 'Countdown' }, 'ProPresenter');
    app.input({ type: 'pp.video', playing: false }, 'ProPresenter');
    app.run({ type: 'section.go', songId: song.id, id: song.sections[3].id }, 'operator', 'the controller');
    app.run({ type: 'blackout.set', on: true }, 'operator');
    app.run({ type: 'panic' }, 'operator');
    app.reportError('DMX loop', new Error('Network is unreachable\nstack…'));
    const r = app.servicelog.report();
    const lines = r.entries.map((x) => `${x.kind}: ${x.text}${x.by ? ` (${x.by})` : ''}`);
    assert.deepStrictEqual(lines, [
      'song: Graves Into Gardens (a screen)',
      'section: Graves Into Gardens · Intro (MIDI)',
      'part: Video (ProPresenter video: Countdown)',
      'part: Worship (ProPresenter video ended)',
      'section: Graves Into Gardens · Chorus 1 (the controller)',
      'blackout: Blackout on (a screen)',
      'panic: Panic (Panic)',
      'blackout: Blackout off (Panic)',
      'problem: DMX loop: Network is unreachable',
    ]);
    assert.strictEqual(r.songs.length, 1);
    assert.strictEqual(r.songs[0].name, 'Graves Into Gardens');
    assert.strictEqual(r.problems.length, 2, 'panic and the error');
    assert.deepStrictEqual(app.servicelog.days(), [r.day]);
    // Live (no-change) actions log nothing
    const n = app.servicelog.report().entries.length;
    app.run({ type: 'gm.set', value: 0.5 }, 'operator');
    assert.strictEqual(app.servicelog.report().entries.length, n);
  } finally {
    app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
