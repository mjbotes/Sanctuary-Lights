'use strict';
const test = require('node:test');
const assert = require('node:assert');

const SR = 48000;
const load = () => import('../public/audio/tunercore.js');

// Voice-like test tone: fundamental plus harmonics
function voice(f, sec) {
  const n = Math.round(SR * sec);
  const x = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    ph += (2 * Math.PI * f) / SR;
    x[i] = 0.3 * Math.sin(ph) + 0.15 * Math.sin(2 * ph) + 0.08 * Math.sin(3 * ph);
  }
  return x;
}
function run(tuner, x) {
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i += 128) tuner.process(x.subarray(i, i + 128), out.subarray(i, i + 128));
  return out;
}
// Fundamental frequency of the second half (after settling), by autocorrelation peak near the expected period.
function pitchOf(y, guess) {
  const a = Math.floor(y.length * 0.6), W = 4096;
  let best = 0, bestLag = 0;
  const lo = Math.floor(SR / (guess * 1.2)), hi = Math.ceil(SR / (guess / 1.2));
  for (let lag = lo; lag <= hi; lag++) {
    let s = 0;
    for (let i = 0; i < W; i++) s += y[a + i] * y[a + i + lag];
    if (s > best) { best = s; bestLag = lag; }
  }
  // parabolic refine
  const ac = (lag) => { let s = 0; for (let i = 0; i < W; i++) s += y[a + i] * y[a + i + lag]; return s; };
  const l = ac(bestLag - 1), c = ac(bestLag), r = ac(bestLag + 1);
  const shift = (l - r) / (2 * (l - 2 * c + r));
  return SR / (bestLag + shift);
}
const rms = (y) => Math.sqrt(y.slice(y.length >> 1).reduce((s, v) => s + v * v, 0) / (y.length - (y.length >> 1)));
const cents = (f, g) => 1200 * Math.log2(f / g);

test('nearest note respects key and scale', async () => {
  const { nearestNote } = await load();
  assert.strictEqual(nearestNote(61, 0, 'major'), 60); // C# -> C (or D) in C major: 61 is between; equal distance -> first found (60)
  assert.strictEqual(nearestNote(61.2, 0, 'major'), 62);
  assert.strictEqual(nearestNote(61.2, 1, 'major'), 61); // C# major contains C#
  assert.strictEqual(nearestNote(63.4, 0, 'minor'), 63); // Eb in C minor
  assert.strictEqual(nearestNote(63.4, 0, 'major'), 64);
});

test('a flat note is pulled to the nearest scale note', async () => {
  const { Tuner } = await load();
  const t = new Tuner(SR);
  t.set({ key: 0, scale: 'major', speedMs: 0, amount: 1 });
  const target = 440; // A4 is in C major
  const sung = target * Math.pow(2, -40 / 1200); // 40 cents flat
  const y = run(t, voice(sung, 1.5));
  const f = pitchOf(y, target);
  assert.ok(Math.abs(cents(f, target)) < 8, `corrected to ${f.toFixed(1)} Hz (${cents(f, target).toFixed(1)} cents)`);
  assert.ok(Math.abs(rms(y) / rms(voice(sung, 1.5)) - 1) < 0.15, 'level kept');
});

test('a sharp low note in a minor key', async () => {
  const { Tuner } = await load();
  const t = new Tuner(SR);
  t.set({ key: 9, scale: 'minor', speedMs: 0 }); // A minor
  const target = 196; // G3
  const y = run(t, voice(target * Math.pow(2, 30 / 1200), 1.5));
  const f = pitchOf(y, target);
  assert.ok(Math.abs(cents(f, target)) < 8, `got ${cents(f, target).toFixed(1)} cents`);
});

test('an in-tune voice passes through cleanly (no comb filtering)', async () => {
  const { Tuner } = await load();
  const t = new Tuner(SR);
  t.set({ key: 0, scale: 'major' });
  const x = voice(261.63, 1.5);
  const y = run(t, x);
  assert.ok(Math.abs(cents(pitchOf(y, 261.63), 261.63)) < 5);
  assert.ok(Math.abs(rms(y) / rms(x) - 1) < 0.08, `level ratio ${(rms(y) / rms(x)).toFixed(3)}`);
});

test('amount 0 or off leaves the pitch alone', async () => {
  const { Tuner } = await load();
  const t = new Tuner(SR);
  t.set({ on: false });
  const sung = 440 * Math.pow(2, -40 / 1200);
  const y = run(t, voice(sung, 1.2));
  assert.ok(Math.abs(cents(pitchOf(y, sung), sung)) < 5);
});

test('latency is reported and small enough for live use', async () => {
  const { Tuner } = await load();
  const t = new Tuner(SR);
  assert.ok(t.info().latencyMs < 30, `${t.info().latencyMs.toFixed(1)} ms`);
});
