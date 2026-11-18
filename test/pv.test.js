'use strict';
const test = require('node:test');
const assert = require('node:assert');
const PV = require('../public/audio/pvcore');

const SR = 48000;
const sine = (f, sec, amp = 0.5) => Float32Array.from({ length: Math.round(SR * sec) }, (_, i) => amp * Math.sin((2 * Math.PI * f * i) / SR));
// Frequency from upward zero crossings in the middle of the signal (avoids the edges).
function freqOf(y) {
  const a = Math.floor(y.length * 0.25), b = Math.floor(y.length * 0.75);
  let first = -1, last = -1, count = 0;
  for (let i = a + 1; i < b; i++) {
    if (y[i - 1] < 0 && y[i] >= 0) {
      const t = i - 1 + -y[i - 1] / (y[i] - y[i - 1]);
      if (first < 0) first = t;
      last = t;
      count++;
    }
  }
  return ((count - 1) * SR) / (last - first);
}
const rms = (y, a, b) => Math.sqrt(y.slice(a, b).reduce((s, v) => s + v * v, 0) / (b - a));

test('FFT round trip', () => {
  const n = 1024;
  const fft = PV.makeFFT(n);
  const re = Float64Array.from({ length: n }, () => Math.random() - 0.5), im = new Float64Array(n);
  const orig = Float64Array.from(re);
  fft(re, im, false);
  fft(re, im, true);
  for (let i = 0; i < n; i++) assert.ok(Math.abs(re[i] / n - orig[i]) < 1e-9);
});

test('no change returns the same audio', () => {
  const x = sine(440, 0.5);
  assert.deepStrictEqual(PV.process(x, 0, 1), x);
});

test('pitch up 2 semitones keeps the length and moves the frequency', () => {
  const x = sine(440, 2);
  const y = PV.process(x, 2, 1);
  assert.strictEqual(y.length, x.length);
  const f = freqOf(y);
  assert.ok(Math.abs(f - 440 * Math.pow(2, 2 / 12)) < 1.5, `got ${f}`);
  const mid = [y.length * 0.3, y.length * 0.7].map(Math.floor);
  assert.ok(Math.abs(rms(y, ...mid) - 0.5 / Math.SQRT2) < 0.03, 'level stays the same');
});

test('pitch down 3 semitones', () => {
  const y = PV.process(sine(330, 2), -3, 1);
  const f = freqOf(y);
  assert.ok(Math.abs(f - 330 * Math.pow(2, -3 / 12)) < 1.5, `got ${f}`);
});

test('tempo change keeps the pitch and changes the length', () => {
  const x = sine(440, 2);
  const y = PV.process(x, 0, 1.25);
  assert.strictEqual(y.length, Math.round(x.length / 1.25));
  const f = freqOf(y);
  assert.ok(Math.abs(f - 440) < 1.5, `got ${f}`);
  const mid = [y.length * 0.3, y.length * 0.7].map(Math.floor);
  assert.ok(Math.abs(rms(y, ...mid) - 0.5 / Math.SQRT2) < 0.03);
});

test('key and tempo together, and a chord stays a chord', () => {
  const n = SR * 2;
  const x = new Float32Array(n);
  for (const f of [261.63, 329.63, 392]) for (let i = 0; i < n; i++) x[i] += 0.2 * Math.sin((2 * Math.PI * f * i) / SR);
  const y = PV.process(x, 1, 0.9);
  assert.strictEqual(y.length, Math.round(n / 0.9));
  // Check the spectrum peaks moved up a semitone
  const N = 16384, fft = PV.makeFFT(N);
  const re = new Float64Array(N), im = new Float64Array(N);
  const off = Math.floor(y.length / 2 - N / 2);
  for (let i = 0; i < N; i++) re[i] = y[off + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  fft(re, im, false);
  const mag = (f) => Math.hypot(re[Math.round((f * N) / SR)], im[Math.round((f * N) / SR)]);
  const up = Math.pow(2, 1 / 12);
  for (const f of [261.63, 329.63, 392]) assert.ok(mag(f * up) > 20 * mag(f), `peak at ${(f * up).toFixed(1)} Hz`);
});

test('formant preservation keeps a voice-like envelope in place when the pitch moves', () => {
  // Harmonics of 150 Hz shaped by a resonance ("formant") around 900 Hz
  const n = SR * 2;
  const x = new Float32Array(n);
  for (let h = 1; h * 150 < 4000; h++) {
    const f = h * 150;
    const amp = 0.08 * Math.exp(-(((f - 900) / 250) ** 2));
    for (let i = 0; i < n; i++) x[i] += amp * Math.sin((2 * Math.PI * f * i) / SR);
  }
  // Spectral centroid between 300 and 2500 Hz in the middle of the signal
  const centroid = (y) => {
    const N = 16384, fft = PV.makeFFT(N);
    const re = new Float64Array(N), im = new Float64Array(N);
    const off = Math.floor(y.length / 2 - N / 2);
    for (let i = 0; i < N; i++) re[i] = y[off + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
    fft(re, im, false);
    let num = 0, den = 0;
    for (let k = Math.round((300 * N) / SR); k < Math.round((2500 * N) / SR); k++) {
      const m = Math.hypot(re[k], im[k]);
      num += m * ((k * SR) / N);
      den += m;
    }
    return num / den;
  };
  const c0 = centroid(x);
  const plain = centroid(PV.process(x, 4, 1, {}));
  const kept = centroid(PV.process(x, 4, 1, { formant: true }));
  assert.ok(plain > c0 * 1.15, `without: formant moves up (${c0.toFixed(0)} -> ${plain.toFixed(0)} Hz)`);
  assert.ok(Math.abs(kept - c0) < Math.abs(plain - c0) / 2.5, `with: stays close (${c0.toFixed(0)} -> ${kept.toFixed(0)} Hz)`);
});
