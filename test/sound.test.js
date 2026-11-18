'use strict';
// Follow the band by sound: beat and loudness detection, and what the engine does with them
const test = require('node:test');
const assert = require('node:assert');
const { Engine, demoShow } = require('../lib/engine');

const SR = 48000;
const load = () => import('../public/audio/beatcore.js');

// A drum pattern: kick on the beat, hi-hat on the off-beat, a little noise
function band(bpm, sec, { gain = 1, offset = 0.1, seed = 1 } = {}) {
  const n = SR * sec, x = new Float32Array(n), beat = 60 / bpm;
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < n; i++) x[i] = 0.02 * rnd() * gain;
  for (let t = offset; t < sec; t += beat) {
    const i0 = Math.round(t * SR);
    for (let i = 0; i < SR * 0.15 && i0 + i < n; i++) x[i0 + i] += gain * 0.8 * Math.exp(-i / (SR * 0.04)) * Math.sin((2 * Math.PI * 55 * i) / SR);
    const j0 = Math.round((t + beat / 2) * SR);
    for (let i = 0; i < SR * 0.03 && j0 + i < n; i++) x[j0 + i] += gain * 0.3 * Math.exp(-i / (SR * 0.008)) * rnd();
  }
  return x;
}
function feed(bt, x, block = 128) {
  const beats = [];
  for (let i = 0; i < x.length; i += block) beats.push(...bt.process(x.subarray(i, i + block)));
  return beats;
}

test('finds the tempo and lands on the beat', async () => {
  const { BeatTracker } = await load();
  for (const bpm of [72, 90, 128]) {
    const bt = new BeatTracker(SR);
    const beats = feed(bt, band(bpm, 16));
    assert.ok(Math.abs(bt.bpm - bpm) < 1.5, `${bpm} BPM: got ${bt.bpm}`);
    const late = beats.filter((t) => t > 10);
    assert.ok(late.length >= Math.floor((6 * bpm) / 60) - 1, `${bpm}: a beat every beat (${late.length})`);
    for (const t of late) {
      const ph = (t - 0.1) / (60 / bpm);
      const ms = (ph - Math.round(ph)) * (60000 / bpm);
      assert.ok(Math.abs(ms) < 40, `${bpm}: beat ${ms.toFixed(0)} ms off the kick`);
    }
  }
});

test('loudness: full band near 1, quiet verse lower, silence 0 and no beats', async () => {
  const { BeatTracker } = await load();
  const bt = new BeatTracker(SR);
  const avgTail = (x) => {
    const vals = [];
    for (let i = 0; i < x.length; i += 2400) { feed(bt, x.subarray(i, i + 2400)); vals.push(bt.level); }
    return vals.slice(-vals.length / 2);
  };
  assert.ok(Math.min(...avgTail(band(100, 10))) > 0.8);
  const quiet = avgTail(band(100, 10, { gain: 0.1, seed: 7 }));
  assert.ok(Math.max(...quiet) < 0.5 && Math.min(...quiet) > 0.15, `quiet: ${quiet}`);
  const silence = new Float32Array(SR * 5);
  avgTail(silence);
  assert.strictEqual(bt.level, 0);
  assert.deepStrictEqual(feed(bt, silence), [], 'no beats from silence');
});

test('the beat sets the tempo, unless MIDI clock or the tracks are in charge', () => {
  const e = new Engine(demoShow());
  e.dispatch({ type: 'sound.beat', bpm: 96, host: 'the lighting computer' });
  assert.strictEqual(e.rt.bpm, 96);
  assert.strictEqual(e.runtimeState().sound.tempo, true);
  assert.strictEqual(e.runtimeState().sound.host, 'the lighting computer');
  e.rt.clock = true;
  e.dispatch({ type: 'sound.beat', bpm: 120 });
  assert.strictEqual(e.rt.bpm, 96, 'MIDI clock wins');
  e.rt.clock = false;
  e.rt.transport = { ...e.rt.transport, cmd: 'play' };
  e.dispatch({ type: 'sound.beat', bpm: 120 });
  assert.strictEqual(e.rt.bpm, 96, 'playing tracks win');
  e.rt.transport.cmd = 'stop';
  e.dispatch({ type: 'sound.settings', tempo: false });
  e.dispatch({ type: 'sound.beat', bpm: 120 });
  assert.strictEqual(e.rt.bpm, 96, 'switched off');
  assert.throws(() => e.dispatch({ type: 'sound.beat', bpm: 900 }), /BPM/);
});

test('brightness follows the music: only in worship, only the chosen groups, stops when the listener goes', () => {
  const e = new Engine(demoShow());
  const g = e.show.groups[0];
  const inGroup = g.fixtures[0];
  const other = e.show.fixtures.map((f) => f.id).find((id) => !g.fixtures.includes(id));
  e.dispatch({ type: 'prog.set', fixtures: [inGroup, other], values: { dim: 1 } });
  e.dispatch({ type: 'part.go', id: 'worship', fade: 0 });
  e.dispatch({ type: 'sound.settings', depth: 0.6 });
  const now = Date.now();
  e.dispatch({ type: 'sound.level', level: 0 });
  assert.ok(Math.abs(e.computeLook(now)[inGroup].dim - 0.4) < 1e-6, 'quiet: 40%');
  e.dispatch({ type: 'sound.level', level: 1 });
  assert.strictEqual(e.computeLook(now)[inGroup].dim, 1, 'full band: as programmed');
  e.dispatch({ type: 'sound.level', level: 0.5 });
  assert.ok(Math.abs(e.computeLook(now)[inGroup].dim - 0.7) < 1e-6);
  // Only the chosen groups
  e.dispatch({ type: 'sound.settings', groups: [g.id] });
  assert.ok(e.computeLook(now)[inGroup].dim < 1);
  assert.strictEqual(e.computeLook(now)[other].dim, 1);
  // Not during the sermon
  e.dispatch({ type: 'part.go', id: 'sermon', fade: 0 });
  assert.strictEqual(e.soundFactor(now), null);
  e.dispatch({ type: 'part.go', id: 'worship', fade: 0 });
  assert.ok(e.soundFactor(now) < 1);
  // The listener stopped sending
  assert.strictEqual(e.soundFactor(now + 4000), null);
  assert.strictEqual(e.computeLook(now + 4000)[inGroup].dim, 1);
  e.dispatch({ type: 'sound.stop' });
  assert.strictEqual(e.runtimeState().sound, null);
  // Off
  e.dispatch({ type: 'sound.level', level: 0 });
  e.dispatch({ type: 'sound.settings', energy: false });
  assert.strictEqual(e.computeLook()[inGroup].dim, 1);
  // Settings are cleaned
  e.dispatch({ type: 'sound.settings', depth: 7, groups: ['nope', g.id] });
  assert.deepStrictEqual(e.show.settings.sound, { tempo: true, energy: false, groups: [g.id], depth: 1 });
});
