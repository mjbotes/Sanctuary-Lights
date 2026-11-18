'use strict';
// Live takes: record live moves against the song's timeline, play them back, catch up after jumps.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadConfig } = require('../lib/server/config');
const { App } = require('../lib/server/app');

const quiet = { log() {}, warn() {}, error() {} };
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-take-'));
  const app = new App(loadConfig({ LIGHTS_DATA: dir, PORT: '0' }), quiet);
  clearInterval(app.takes.timer); // the test drives the clock
  const e = app.engine;
  const song = e.show.songs.find((s) => s.name === 'Graves Into Gardens');
  app.run({ type: 'song.select', id: song.id });
  const back = e.show.groups.find((g) => g.name === 'Back');
  // Pretend the tracks are playing at `pos` seconds (as the audio computer reports)
  const play = (pos, playing = true) => { e.rt.playhead = { songId: song.id, pos, dur: 300, playing, at: Date.now() }; };
  return { app, e, song, back, play, done: () => { app.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('record a take while the song plays, then it plays back on its own', () => {
  const { app, e, song, back, play, done } = setup();
  try {
    app.run({ type: 'take.record', on: true });
    // Not playing yet: nothing to record against
    app.run({ type: 'busk.level', groupId: back.id, level: 0.2 });
    assert.strictEqual(e.rt.recording.waiting, true);
    play(10);
    app.run({ type: 'busk.color', groupId: back.id, role: 'secondary' });
    play(12);
    app.run({ type: 'busk.fx', groupId: back.id, fx: 'pulse' });
    play(20);
    app.run({ type: 'flash.all', on: true });
    play(20.5);
    app.run({ type: 'flash.all', on: false });
    app.run({ type: 'gm.set', value: 0.9 }); // not part of a take
    const r = app.run({ type: 'take.record', on: false, save: true });
    assert.deepStrictEqual(r, { saved: true, events: 4 });
    assert.deepStrictEqual(song.take.events.map((x) => [Math.round(x.t * 10) / 10, x.a.type]), [[10, 'busk.color'], [12, 'busk.fx'], [20, 'flash.all'], [20.5, 'flash.all']]);

    // Sunday: release everything, play the song from the start
    app.run({ type: 'busk.release' });
    play(0);
    app.takes.tick();
    play(10.02);
    app.takes.tick();
    assert.strictEqual(e.rt.busk[back.id].color, 'pal:2', 'colour change at 10 s');
    assert.ok(!e.rt.busk[back.id].fx);
    play(12.01);
    app.takes.tick();
    assert.ok(e.rt.busk[back.id].fx, 'effect at 12 s');
    // play on normally (the timer ticks every 20 ms; here every 0.5 s)
    for (let t = 12.5; t <= 20.01; t += 0.5) { play(t); app.takes.tick(); }
    play(20.01);
    app.takes.tick();
    assert.strictEqual(e.rt.flashAll, true, 'flash at 20 s');
    play(20.6);
    app.takes.tick();
    assert.strictEqual(e.rt.flashAll, false, 'and off again');

    // A jump back (repeat a section): the state at the new place, without the flash
    play(11);
    app.takes.tick();
    assert.strictEqual(e.rt.busk[back.id].color, 'pal:2');
    assert.ok(!e.rt.busk[back.id].fx, 'the effect started at 12 s is not on yet at 11 s');
    // A jump forward (skip): caught up, momentary flash left out
    play(60);
    app.takes.tick();
    assert.ok(e.rt.busk[back.id].fx);
    assert.strictEqual(e.rt.flashAll, false);
    // The song stops: the take's live changes end with it
    play(61, false);
    app.takes.tick();
    assert.deepStrictEqual(e.rt.busk, {});
    // Switched off: nothing plays
    app.run({ type: 'take.set', songId: song.id, on: false });
    play(15);
    app.takes.tick();
    assert.deepStrictEqual(e.rt.busk, {});
  } finally {
    done();
  }
});

test('tempo changes: the take stays on the music (original timeline)', () => {
  const { app, e, song, back, play, done } = setup();
  try {
    app.run({ type: 'song.edit', id: song.id, bpm: 70 });
    app.run({ type: 'take.record', on: true });
    play(20);
    app.run({ type: 'busk.color', groupId: back.id, role: 'tertiary' });
    app.run({ type: 'take.record', on: false, save: true });
    assert.ok(Math.abs(song.take.events[0].t - 20) < 0.1);
    app.run({ type: 'busk.release' });
    app.run({ type: 'song.audio', id: song.id, targetBpm: 140 }); // twice as fast: 20 s of music = 10 s of playback
    play(0);
    app.takes.tick();
    play(9.9);
    app.takes.tick();
    assert.ok(!(e.rt.busk[back.id] || {}).color);
    play(10.05);
    app.takes.tick();
    assert.strictEqual(e.rt.busk[back.id].color, 'pal:3');
  } finally {
    done();
  }
});

test('discarding or recording nothing keeps the old take', () => {
  const { app, song, back, play, done } = setup();
  try {
    app.run({ type: 'take.record', on: true });
    play(5);
    app.run({ type: 'busk.level', groupId: back.id, level: 0.5 });
    app.run({ type: 'take.record', on: false, save: false });
    assert.ok(!song.take);
    app.run({ type: 'take.record', on: true });
    app.run({ type: 'take.record', on: false, save: true }); // nothing recorded
    assert.ok(!song.take);
  } finally {
    done();
  }
});
