// Live pitch correction ("auto-tune") for vocals.
// Pitch detection: YIN on a 2x decimated signal. Correction: pitch-synchronous overlap-add (PSOLA):
// one-period grains are copied to new positions, so a voice that is already in tune passes cleanly.
// Shared by the AudioWorklet (live) and the tests.

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Nearest allowed MIDI note for a (fractional) MIDI pitch, given key (0 = C) and scale notes.
export function nearestNote(midi, key, scale) {
  const allowed = SCALES[scale] || SCALES.chromatic;
  let best = Math.round(midi), bestD = Infinity;
  for (let n = Math.floor(midi) - 2; n <= Math.ceil(midi) + 2; n++) {
    const pc = (((n - key) % 12) + 12) % 12;
    if (!allowed.includes(pc)) continue;
    const d = Math.abs(n - midi);
    if (d < bestD) { bestD = d; best = n; }
  }
  return best;
}

export class Tuner {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.params = { on: true, amount: 1, speedMs: 30, key: 0, scale: 'major', minHz: 85, maxHz: 1000 };
    const size = 1 << 15;
    this.size = size;
    this.mask = size - 1;
    this.inBuf = new Float32Array(size);
    this.outBuf = new Float32Array(size);
    this.wBuf = new Float32Array(size);
    this.n = 0; // samples written
    this.tMax = Math.ceil(this.sr / this.params.minHz);
    this.latency = this.tMax + 64;
    this.nextOut = this.latency; // next synthesis mark (output time)
    this.inMark = 0; // current analysis mark (input time)
    // Detection on a 2x decimated copy
    this.dSize = 2048;
    this.dBuf = new Float32Array(this.dSize);
    this.dN = 0;
    this.dAcc = 0;
    this.hop = 256;
    this.sinceDetect = 0;
    this.period = Math.round(this.sr * 0.005);
    this.voiced = false;
    this.freq = 0;
    this.ratio = 1;
    this.targetRatio = 1;
    this.targetNote = null;
    this.level = 0;
  }

  set(p) {
    Object.assign(this.params, p);
  }

  detect() {
    const sr2 = this.sr / 2;
    const W = 512;
    const tauMin = Math.max(2, Math.floor(sr2 / this.params.maxHz));
    const tauMax = Math.min(Math.ceil(sr2 / this.params.minHz), this.dSize - W - 2);
    const start = this.dN - W - tauMax;
    if (start < 0) return;
    const x = (i) => this.dBuf[(start + i) & (this.dSize - 1)];
    // Energy gate
    let e = 0;
    for (let j = 0; j < W; j++) e += x(j) * x(j);
    this.level = Math.sqrt(e / W);
    if (this.level < 0.004) { this.voiced = false; return; }
    const d = new Float32Array(tauMax + 1);
    let run = 0;
    let found = -1;
    for (let tau = 1; tau <= tauMax; tau++) {
      let s = 0;
      for (let j = 0; j < W; j++) {
        const v = x(j) - x(j + tau);
        s += v * v;
      }
      run += s;
      d[tau] = run > 0 ? (s * tau) / run : 1; // cumulative mean normalised difference
      if (found < 0 && tau > tauMin && d[tau] < 0.15) found = tau;
      if (found > 0 && tau > found && d[tau] > d[tau - 1]) break;
    }
    if (found < 0) { this.voiced = false; return; }
    let t = found;
    while (t + 1 <= tauMax && d[t + 1] < d[t]) t++;
    const a = d[t - 1], b = d[t], c = t + 1 <= tauMax ? d[t + 1] : b;
    const shift = (a - c) / (2 * (a - 2 * b + c) || 1);
    const tauF = t + (Number.isFinite(shift) ? Math.max(-1, Math.min(1, shift)) : 0);
    this.voiced = d[t] < 0.25;
    if (!this.voiced) return;
    this.freq = sr2 / tauF;
    this.period = Math.round((2 * tauF));
  }

  updateTarget() {
    const p = this.params;
    if (!p.on || !this.voiced || !this.freq) {
      this.targetRatio = 1;
      this.targetNote = null;
      return;
    }
    const midi = 69 + 12 * Math.log2(this.freq / 440);
    const note = nearestNote(midi, p.key, p.scale);
    this.targetNote = note;
    this.targetRatio = Math.pow(2, ((note - midi) * p.amount) / 12);
  }

  // Process one block (mono). Writes the corrected signal to out.
  process(input, out) {
    const p = this.params;
    const coef = p.speedMs <= 0 ? 1 : 1 - Math.exp(-1 / ((p.speedMs / 1000) * this.sr));
    for (let i = 0; i < input.length; i++) {
      const v = input[i] || 0;
      this.inBuf[this.n & this.mask] = v;
      // decimate x2 for detection
      this.dAcc += v;
      if (this.n & 1) {
        this.dBuf[this.dN & (this.dSize - 1)] = this.dAcc * 0.5;
        this.dN++;
        this.dAcc = 0;
      }
      this.n++;
      if (++this.sinceDetect >= this.hop) {
        this.sinceDetect = 0;
        this.detect();
        this.updateTarget();
      }
      this.ratio += (this.targetRatio - this.ratio) * coef;
      this.placeGrains();
      // Output sample for time n-1 (latency is built into the synthesis marks)
      const k = (this.n - 1) & this.mask;
      const w = this.wBuf[k];
      out[i] = w > 0.25 ? this.outBuf[k] / w : this.outBuf[k];
      this.outBuf[k] = 0;
      this.wBuf[k] = 0;
    }
  }

  placeGrains() {
    const T = this.voiced ? Math.max(32, Math.min(this.tMax, this.period)) : Math.round(this.sr * 0.005);
    const ratio = this.voiced ? this.ratio : 1;
    // Place every grain whose window starts at or before the current output sample.
    while (this.nextOut - T <= this.n - 1) {
      const s = Math.round(this.nextOut);
      const ti = s - this.latency; // input time this output mark corresponds to
      // Analysis marks are one period apart; use the one nearest to ti.
      while (this.inMark + T / 2 < ti) this.inMark += T;
      if (this.inMark > ti + T) this.inMark = ti; // resync after silence
      const c = Math.round(this.inMark);
      if (c + T > this.n) break; // not enough input yet
      for (let j = -T; j < T; j++) {
        const w = 0.5 + 0.5 * Math.cos((Math.PI * j) / T);
        const o = (s + j) & this.mask;
        this.outBuf[o] += this.inBuf[(c + j) & this.mask] * w;
        this.wBuf[o] += w;
      }
      this.nextOut += T / ratio;
    }
  }

  info() {
    return {
      freq: this.voiced ? this.freq : 0,
      note: this.targetNote,
      cents: this.voiced && this.freq ? Math.round(1200 * Math.log2(this.ratio)) : 0,
      level: this.level,
      latencyMs: ((this.latency + this.tMax) / this.sr) * 1000,
    };
  }
}
