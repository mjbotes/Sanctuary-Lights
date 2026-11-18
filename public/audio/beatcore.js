// Beat and energy from a live sound (a microphone in the room, or a feed from the sound desk), for
// when there are no backing tracks or MIDI clock: the lights find the band's tempo and follow how
// big the music is. Pure maths, no Web Audio, so it runs in tests too.
//
//   const bt = new BeatTracker(sampleRate);
//   for each block of samples: const beats = bt.process(block);  // times (s) of beats in this block
//   bt.bpm, bt.confidence (0-1), bt.level (0-1, how loud compared with the loudest recent moment), bt.db
//
// How: an onset curve (sudden rises in low and full-band energy: kick, snare, strums) is
// autocorrelated to find the beat period (60-200 BPM, preferring around 120), then a comb over the
// onsets finds where the beats fall. Beats are predicted, so they arrive on time, not late.

const HOP = 512;
const MIN_BPM = 60;
const MAX_BPM = 200;

export class BeatTracker {
  constructor(sampleRate, opts = {}) {
    this.sr = sampleRate;
    this.fps = sampleRate / HOP; // onset frames per second
    this.size = Math.round(this.fps * (opts.window || 8)); // seconds of onsets kept
    this.env = new Float32Array(this.size);
    this.n = 0; // frames processed
    this.buf = new Float32Array(HOP);
    this.fill = 0;
    this.lp = 0; // low-pass state (kick drum band)
    this.lpA = 1 - Math.exp((-2 * Math.PI * 180) / sampleRate);
    this.prevLow = [];
    this.prevAll = [];
    this.bpm = 0;
    this.confidence = 0;
    this.period = 0; // frames per beat
    this.nextBeat = Infinity; // frame of the next beat
    this.pending = null; // a different tempo that must be seen twice before switching
    this.db = -90;
    this.smoothDb = -90;
    this.peakDb = -50;
    this.level = 0;
    this.range = opts.range || 30; // dB below the recent peak that counts as silent
  }

  process(samples) {
    const beats = [];
    for (let i = 0; i < samples.length; i++) {
      this.buf[this.fill++] = samples[i];
      if (this.fill === HOP) {
        this.fill = 0;
        if (this.frame()) beats.push(this.n / this.fps);
      }
    }
    return beats;
  }

  // One hop of audio. Returns true when a beat falls in it.
  frame() {
    let low = 0, all = 0;
    for (let i = 0; i < HOP; i++) {
      const x = this.buf[i];
      this.lp += this.lpA * (x - this.lp);
      low += this.lp * this.lp;
      all += x * x;
    }
    low /= HOP;
    all /= HOP;
    // Onset: rise in log energy over the average of the last few frames
    const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
    const lLow = Math.log(low + 1e-10), lAll = Math.log(all + 1e-10);
    const onset = Math.max(0, lLow - avg(this.prevLow)) + 0.5 * Math.max(0, lAll - avg(this.prevAll));
    this.prevLow.push(lLow);
    this.prevAll.push(lAll);
    if (this.prevLow.length > 3) { this.prevLow.shift(); this.prevAll.shift(); }
    // Silence counts as no onset at all (no beats from hiss)
    this.env[this.n % this.size] = all < 1e-7 ? 0 : onset;
    this.n++;

    // Loudness: fast up, slower down; compared with the loudest recent moment (that fades slowly)
    this.db = 10 * Math.log10(all + 1e-12);
    const k = this.db > this.smoothDb ? 0.05 : 0.004;
    this.smoothDb += k * (this.db - this.smoothDb);
    this.peakDb = Math.max(-50, this.smoothDb > this.peakDb ? this.smoothDb : this.peakDb - 0.1 / this.fps);
    this.level = Math.max(0, Math.min(1, 1 - (this.peakDb - this.smoothDb) / this.range));

    const every = Math.round(this.fps / 2);
    if (this.n >= this.fps * 3 && this.n % every === 0) this.estimate();
    if (this.n >= this.nextBeat) {
      this.nextBeat += this.period;
      if (this.nextBeat <= this.n) this.nextBeat = this.n + this.period;
      return this.confidence > 0.1 && this.level > 0.05; // no beats in silence
    }
    return false;
  }

  // The onsets, oldest first, mean removed
  history() {
    const len = Math.min(this.n, this.size);
    const out = new Float32Array(len);
    let sum = 0;
    for (let i = 0; i < len; i++) {
      out[i] = this.env[(this.n - len + i) % this.size];
      sum += out[i];
    }
    const mean = sum / len;
    for (let i = 0; i < len; i++) out[i] -= mean;
    return out;
  }

  estimate() {
    const h = this.history();
    const len = h.length;
    let zero = 0;
    for (let i = 0; i < len; i++) zero += h[i] * h[i];
    if (zero < 1e-6) { this.confidence = 0; return; }
    const lo = Math.floor((this.fps * 60) / MAX_BPM), hi = Math.ceil((this.fps * 60) / MIN_BPM);
    const acf = new Float32Array(2 * hi + 2);
    for (let lag = lo; lag < acf.length && lag < len; lag++) {
      let s = 0;
      for (let i = lag; i < len; i++) s += h[i] * h[i - lag];
      acf[lag] = s / (len - lag);
    }
    let best = 0, bestLag = 0;
    for (let lag = lo; lag <= hi; lag++) {
      const bpm = (60 * this.fps) / lag;
      const w = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2); // prefer tempos near 120
      const s = (acf[lag] + 0.5 * (acf[2 * lag] || 0)) * w;
      if (s > best) { best = s; bestLag = lag; }
    }
    if (!bestLag) { this.confidence = 0; return; }
    // Parabolic refinement between frames
    const a = acf[bestLag - 1], b = acf[bestLag], c = acf[bestLag + 1];
    const d = a - 2 * b + c;
    const period = bestLag + (d < 0 ? (0.5 * (a - c)) / d : 0);
    this.confidence = Math.max(0, Math.min(1, b / (zero / len)));
    const bpm = (60 * this.fps) / period;
    // Steady tempo: small changes blend in; a jump must show up twice in a row
    if (!this.bpm || Math.abs(bpm / this.bpm - 1) < 0.04) {
      this.bpm = this.bpm ? this.bpm * 0.7 + bpm * 0.3 : bpm;
      this.pending = null;
    } else if (this.pending && Math.abs(bpm / this.pending - 1) < 0.04) {
      this.bpm = bpm;
      this.pending = null;
    } else {
      this.pending = bpm;
    }
    this.period = (60 * this.fps) / this.bpm;
    // Phase: where a comb with this period lines up with the most onsets
    const P = this.period;
    let bestPhase = 0, bestScore = -Infinity;
    for (let ph = 0; ph < P; ph++) {
      let s = 0;
      for (let k = 0; ; k++) {
        const idx = Math.round(len - 1 - ph - k * P);
        if (idx < 0) break;
        s += h[idx] * (1 - k * 0.04); // recent beats count a bit more
      }
      if (s > bestScore) { bestScore = s; bestPhase = ph; }
    }
    const lastBeat = this.n - 1 - bestPhase;
    let next = lastBeat + P;
    while (next <= this.n) next += P;
    // Keep the running prediction when it is close (no jitter), else jump to the new one
    if (Number.isFinite(this.nextBeat) && Math.abs(this.nextBeat - next) < P / 4) this.nextBeat = this.nextBeat * 0.6 + next * 0.4;
    else if (Number.isFinite(this.nextBeat) && Math.abs(this.nextBeat - next + P) < P / 4) this.nextBeat = this.nextBeat * 0.6 + (next - P) * 0.4;
    else this.nextBeat = next;
  }
}
