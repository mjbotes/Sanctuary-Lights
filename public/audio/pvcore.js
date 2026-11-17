// Pitch shift and time stretch for backing tracks (offline, high quality).
// Phase vocoder with identity phase locking (peaks keep their partials together) and
// phase reset on transients (keeps drums punchy), followed by a windowed-sinc resampler.
// Used from a Web Worker in the app, and from Node in the tests.
(function (root) {
  'use strict';

  // ----- FFT (in-place, radix 2) -----------------------------------------------------
  function makeFFT(n) {
    const levels = Math.log2(n);
    if (levels % 1) throw new Error('FFT size must be a power of two');
    const rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0, x = i; b < levels; b++, x >>= 1) r = (r << 1) | (x & 1);
      rev[i] = r;
    }
    const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      cos[i] = Math.cos((2 * Math.PI * i) / n);
      sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
    function transform(re, im, inverse) {
      for (let i = 0; i < n; i++) {
        const j = rev[i];
        if (j > i) {
          let t = re[i]; re[i] = re[j]; re[j] = t;
          t = im[i]; im[i] = im[j]; im[j] = t;
        }
      }
      const sgn = inverse ? 1 : -1;
      for (let size = 2; size <= n; size <<= 1) {
        const half = size >> 1, step = n / size;
        for (let i = 0; i < n; i += size) {
          for (let j = i, k = 0; j < i + half; j++, k += step) {
            const l = j + half;
            const c = cos[k], s = sgn * sin[k];
            const tre = re[l] * c - im[l] * s;
            const tim = re[l] * s + im[l] * c;
            re[l] = re[j] - tre; im[l] = im[j] - tim;
            re[j] += tre; im[j] += tim;
          }
        }
      }
    }
    return transform;
  }

  const TAU = Math.PI * 2;
  const wrap = (p) => p - TAU * Math.round(p / TAU);

  // Time-stretch x by factor alpha (output length = input length * alpha).
  function stretch(x, alpha, opts = {}, onProgress) {
    const N = opts.fftSize || 4096;
    const Hs = N / 4;
    const Ha = Hs / alpha;
    const half = N / 2;
    const fft = makeFFT(N);
    const win = new Float64Array(N);
    for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((TAU * i) / N);
    const pad = half;
    const len = x.length;
    const outLen = Math.round(len * alpha);
    const frames = Math.ceil((len + pad) / Ha) + 1;
    const out = new Float64Array(Math.ceil(frames * Hs + N + pad * alpha) + N);
    const norm = new Float64Array(out.length);
    const re = new Float64Array(N), im = new Float64Array(N);
    const mag = new Float64Array(half + 1), phase = new Float64Array(half + 1);
    const prevPhase = new Float64Array(half + 1), synPhase = new Float64Array(half + 1);
    const peaks = new Int32Array(half + 1);
    let prevPos = 0, prevEnergy = 0, first = true;
    for (let m = 0; m < frames; m++) {
      const pos = Math.round(m * Ha) - pad; // analysis position (can start before 0)
      for (let i = 0; i < N; i++) {
        const j = pos + i;
        re[i] = j >= 0 && j < len ? x[j] * win[i] : 0;
        im[i] = 0;
      }
      fft(re, im, false);
      let energy = 0;
      for (let k = 0; k <= half; k++) {
        mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
        phase[k] = Math.atan2(im[k], re[k]);
        energy += mag[k] * mag[k];
      }
      // Transient: big jump in energy -> take the analysis phases as they are.
      const transient = !first && energy > 4 * prevEnergy + 1e-9 && energy > 1e-6;
      const hop = pos - prevPos;
      if (first || transient || hop <= 0) {
        for (let k = 0; k <= half; k++) synPhase[k] = phase[k];
      } else {
        // Peaks
        let np = 0;
        for (let k = 1; k < half; k++) {
          if (mag[k] > mag[k - 1] && mag[k] >= mag[k + 1] && (k < 2 || mag[k] > mag[k - 2]) && (k > half - 2 || mag[k] > mag[k + 2])) peaks[np++] = k;
        }
        if (!np) peaks[np++] = 1;
        // True frequency at peaks -> new synthesis phase
        for (let p = 0; p < np; p++) {
          const k = peaks[p];
          const omega = (TAU * k) / N;
          const dphi = wrap(phase[k] - prevPhase[k] - omega * hop);
          const freq = omega + dphi / hop;
          synPhase[k] += freq * Hs;
        }
        // Identity phase locking: bins follow the nearest peak.
        let p = 0;
        for (let k = 0; k <= half; k++) {
          while (p < np - 1 && Math.abs(peaks[p + 1] - k) < Math.abs(peaks[p] - k)) p++;
          const pk = peaks[p];
          if (k !== pk) synPhase[k] = synPhase[pk] + (phase[k] - phase[pk]);
        }
      }
      for (let k = 0; k <= half; k++) prevPhase[k] = phase[k];
      prevPos = pos;
      prevEnergy = energy;
      first = false;
      // Inverse FFT (Hermitian spectrum)
      for (let k = 0; k <= half; k++) {
        re[k] = mag[k] * Math.cos(synPhase[k]);
        im[k] = mag[k] * Math.sin(synPhase[k]);
      }
      for (let k = half + 1; k < N; k++) {
        re[k] = re[N - k];
        im[k] = -im[N - k];
      }
      fft(re, im, true);
      const o = m * Hs;
      for (let i = 0; i < N; i++) {
        out[o + i] += (re[i] / N) * win[i];
        norm[o + i] += win[i] * win[i];
      }
      if (onProgress && m % 256 === 0) onProgress(m / frames);
    }
    const start = Math.round(pad * alpha);
    const y = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const j = i + start;
      const n = norm[j];
      y[i] = n > 1e-3 ? out[j] / n : out[j] / 1.5;
    }
    return y;
  }

  // Resample by reading x at positions i * step (step > 1 shortens). Band-limited when shortening.
  // Windowed-sinc kernel from a table (PHASES fractional positions x TAPS taps).
  function resample(x, step, outLen) {
    const TAPS = 16, PHASES = 1024, H = TAPS / 2;
    const cut = Math.min(1, 1 / step);
    const sinc = (t) => (t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t));
    const table = new Float32Array((PHASES + 1) * TAPS);
    for (let ph = 0; ph <= PHASES; ph++) {
      const frac = ph / PHASES;
      let sum = 0;
      for (let t = 0; t < TAPS; t++) {
        const d = frac - (t - H + 1); // distance from sample (base - H + 1 + t)
        const w = sinc(cut * d) * sinc(d / H);
        table[ph * TAPS + t] = w;
        sum += w;
      }
      for (let t = 0; t < TAPS; t++) table[ph * TAPS + t] /= sum || 1; // unity gain
    }
    const y = new Float32Array(outLen);
    const n = x.length;
    for (let i = 0; i < outLen; i++) {
      const pos = i * step;
      const base = Math.floor(pos);
      const row = Math.round((pos - base) * PHASES) * TAPS;
      let acc = 0;
      const j0 = base - H + 1;
      if (j0 >= 0 && j0 + TAPS <= n) {
        for (let t = 0; t < TAPS; t++) acc += x[j0 + t] * table[row + t];
      } else {
        for (let t = 0; t < TAPS; t++) {
          const j = j0 + t;
          if (j >= 0 && j < n) acc += x[j] * table[row + t];
        }
      }
      y[i] = acc;
    }
    return y;
  }

  // Shift pitch by `semitones` and change tempo by `tempo` (1.1 = 10% faster).
  function process(x, semitones, tempo, opts, onProgress) {
    const pitch = Math.pow(2, (semitones || 0) / 12);
    const t = tempo || 1;
    const outLen = Math.round(x.length / t);
    if (Math.abs(pitch - 1) < 1e-6 && Math.abs(t - 1) < 1e-6) return Float32Array.from(x);
    const alpha = pitch / t; // stretch so that resampling by `pitch` lands on the new length
    const s = stretch(x, alpha, opts, onProgress && ((p) => onProgress(p * 0.9)));
    if (Math.abs(pitch - 1) < 1e-6) return s.length === outLen ? s : s.subarray(0, outLen);
    const y = resample(s, pitch, outLen);
    if (onProgress) onProgress(1);
    return y;
  }

  const api = { makeFFT, stretch, resample, process };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PV = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
