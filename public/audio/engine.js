// Backing-track player and live vocal chain (runs on the computer that plays the audio).
// - Stems are decoded once, then re-rendered in Web Workers when the song's key or tempo changes.
// - Every stem has its own level, pan, mute/solo and output pair (e.g. click and guide to 3-4 for in-ears).
// - Section markers on the timeline call onMarker(sectionId) as playback passes them.
// - Jumps (sections, repeat, skip) happen on the next bar line, so the band stays in time.
// - A click and count-in are generated from the song's tempo; spoken guide cues ("Chorus") play a bar early.
// - The vocal chain: input -> auto-tune (follows the song key) -> EQ -> compressor -> outputs, with reverb and tempo delay sends.

import { grid, barLength, nextBar, clickTrack, countIn } from './timing.js';
import * as cache from './rendercache.js';

const dbToGain = (db) => (db <= -60 ? 0 : Math.pow(10, db / 20));

class WorkerPool {
  constructor(size) {
    this.workers = Array.from({ length: size }, () => ({ w: new Worker('/audio/pv-worker.js'), busy: false }));
    this.queue = [];
    this.nextId = 1;
    this.jobs = new Map();
    for (const slot of this.workers) {
      slot.w.onmessage = (e) => {
        const job = this.jobs.get(e.data.id);
        if (!job) return;
        if (e.data.progress !== undefined) return job.onProgress && job.onProgress(e.data.progress);
        this.jobs.delete(e.data.id);
        slot.busy = false;
        if (e.data.error) job.reject(new Error(e.data.error));
        else job.resolve(e.data.data);
        this.pump();
      };
    }
  }
  run(data, semitones, tempo, formant, onProgress) {
    return new Promise((resolve, reject) => {
      this.queue.push({ id: this.nextId++, data, semitones, tempo, formant, resolve, reject, onProgress });
      this.pump();
    });
  }
  pump() {
    for (const slot of this.workers) {
      if (slot.busy || !this.queue.length) continue;
      const job = this.queue.shift();
      slot.busy = true;
      this.jobs.set(job.id, job);
      slot.w.postMessage({ id: job.id, data: job.data, semitones: job.semitones, tempo: job.tempo, formant: job.formant });
    }
  }
}

export class AudioEngine {
  constructor(hooks = {}) {
    this.hooks = hooks;
    this.decoded = new Map(); // file -> AudioBuffer (original)
    this.rendered = new Map(); // key -> AudioBuffer
    this.song = null;
    this.buffers = new Map(); // stemId -> AudioBuffer for the current song
    this.strips = new Map(); // stemId -> { input, gain, pan, splitter, out }
    this.sources = [];
    this.playing = false;
    this.pos = 0;
    this.loop = null;
    this.prepareToken = 0;
    this.vocal = null;
    this.planned = null; // a jump waiting for its bar line: { at, to, label }
    this.guideDone = new Set();
  }

  async init() {
    if (this.ctx) return;
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    await this.ctx.audioWorklet.addModule('/audio/autotune-worklet.js');
    this.pool = new WorkerPool(Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 1)));
    this.setupOutputs();
    this.timer = setInterval(() => this.tick(), 20);
  }

  setupOutputs() {
    const d = this.ctx.destination;
    this.channels = Math.max(2, d.maxChannelCount || 2);
    d.channelCount = this.channels;
    d.channelCountMode = 'explicit';
    d.channelInterpretation = 'discrete';
    if (this.merger) this.merger.disconnect();
    this.merger = this.ctx.createChannelMerger(this.channels);
    this.merger.connect(d);
    this.master = this.master || this.ctx.createGain();
    // Re-route every strip
    for (const [id, strip] of this.strips) this.route(strip, strip.outPair || 0);
    if (this.vocal) this.route(this.vocal.outStrip, 0);
    this.hooks.onOutputs && this.hooks.onOutputs(this.outputPairs());
  }

  outputPairs() {
    const pairs = [];
    for (let p = 0; p * 2 + 1 < this.channels; p++) pairs.push({ value: p, label: p === 0 ? 'Main 1-2' : `${p * 2 + 1}-${p * 2 + 2}` });
    return pairs;
  }

  async setOutputDevice(deviceId) {
    if (!this.ctx.setSinkId) throw new Error('Choosing the output device needs Chrome, Edge or the desktop app');
    await this.ctx.setSinkId(deviceId || '');
    this.setupOutputs();
  }

  // Stereo node -> output pair `pair` (falls back to Main if the device has fewer outputs).
  route(strip, pair) {
    strip.outPair = pair;
    const p = pair * 2 + 1 < this.channels ? pair : 0;
    try { strip.splitter.disconnect(); } catch {}
    strip.splitter.connect(this.merger, 0, p * 2);
    strip.splitter.connect(this.merger, 1, p * 2 + 1);
  }

  makeStrip() {
    const input = this.ctx.createGain();
    const gain = this.ctx.createGain();
    const pan = this.ctx.createStereoPanner();
    const splitter = this.ctx.createChannelSplitter(2);
    input.connect(gain).connect(pan).connect(splitter);
    const meter = this.ctx.createAnalyser();
    meter.fftSize = 512;
    pan.connect(meter);
    return { input, gain, pan, splitter, meter, outPair: 0 };
  }

  // ----- loading and rendering ---------------------------------------------------
  async decode(file) {
    if (this.decoded.has(file)) return this.decoded.get(file);
    const res = await fetch(`/assets/${file.split('/').map(encodeURIComponent).join('/')}`);
    if (!res.ok) throw new Error(`Could not load ${file}`);
    const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
    this.decoded.set(file, buf);
    return buf;
  }

  static changes(song, stem) {
    const tempo = song.targetBpm && song.bpm ? song.targetBpm / song.bpm : 1;
    const semitones = stem.keepPitch ? 0 : song.transpose || 0;
    // Voices keep their natural tone when the key changes (no "chipmunk" effect)
    const formant = semitones !== 0 && !!stem.formant;
    return { tempo, semitones, formant };
  }

  // Get every stem of a song ready at its current key and tempo. Calls onStatus with progress.
  async prepare(song, { background = false } = {}) {
    const token = background ? this.prepareToken : ++this.prepareToken;
    const stems = song.stems || [];
    const out = new Map();
    let done = 0;
    const total = stems.length || 1;
    const status = (extra) => !background && this.hooks.onStatus && this.hooks.onStatus({ songId: song.id, ...extra });
    status({ preparing: true, progress: 0, text: 'Loading tracks…' });
    await Promise.all(stems.map(async (stem) => {
      const { tempo, semitones, formant } = AudioEngine.changes(song, stem);
      const key = `${stem.file}|${semitones}|${tempo.toFixed(5)}|${formant}`;
      let buf = this.rendered.get(key);
      if (!buf) {
        const orig = await this.decode(stem.file);
        const ck = cache.renderKey(stem.file, semitones, tempo, formant);
        const saved = semitones === 0 && Math.abs(tempo - 1) < 1e-6 ? null : await cache.load(ck);
        if (semitones === 0 && Math.abs(tempo - 1) < 1e-6) buf = orig;
        else if (saved && saved.channels.length === orig.numberOfChannels) {
          buf = this.ctx.createBuffer(saved.channels.length, saved.channels[0].length, saved.sampleRate);
          saved.channels.forEach((d, c) => buf.copyToChannel(d, c));
        } else {
          const prog = new Array(orig.numberOfChannels).fill(0);
          const chans = await Promise.all(Array.from({ length: orig.numberOfChannels }, (_, c) =>
            this.pool.run(orig.getChannelData(c).slice(), semitones, tempo, formant, (p) => {
              prog[c] = p;
              status({ preparing: true, progress: (done + prog.reduce((a, b) => a + b, 0) / prog.length) / total, text: `Changing key/tempo… ${stem.name}` });
            })));
          if (token !== this.prepareToken && !background) throw new Error('cancelled');
          buf = this.ctx.createBuffer(orig.numberOfChannels, chans[0].length, orig.sampleRate);
          chans.forEach((d, c) => buf.copyToChannel(d, c));
          cache.save(ck, chans, orig.sampleRate, this.hooks.uploadHeaders ? this.hooks.uploadHeaders() : {});
        }
        this.rendered.set(key, buf);
        if (this.rendered.size > 60) this.rendered.delete(this.rendered.keys().next().value);
      }
      out.set(stem.id, buf);
      done++;
      status({ preparing: true, progress: done / total, text: `Preparing… ${done}/${total}` });
    }));
    if (!background && token !== this.prepareToken) throw new Error('cancelled');
    return out;
  }

  async load(song) {
    const wasPlaying = this.playing && this.song && this.song.id === song.id;
    const pos = this.position();
    const buffers = await this.prepare(song);
    if (this.playing) this.stopSources();
    this.song = song;
    this.buffers = buffers;
    // tempo ratio change: keep the same place in the music
    const oldTempo = this.tempo || 1;
    this.tempo = song.targetBpm && song.bpm ? song.targetBpm / song.bpm : 1;
    this.duration = Math.max(0, ...[...buffers.values()].map((b) => b.duration));
    for (const strip of this.strips.values()) try { strip.splitter.disconnect(); } catch {}
    this.strips.clear();
    for (const stem of song.stems) {
      const strip = this.makeStrip();
      this.strips.set(stem.id, strip);
      this.route(strip, stem.out || 0);
    }
    // Generated click (and the count-in and guide cues share its output)
    const click = this.makeStrip();
    this.strips.set('__click', click);
    this.route(click, (song.click && song.click.out) ?? 1);
    this.buildClick(song, false);
    this.planned = null;
    this.applyMix(song);
    this.peaks = this.computePeaks();
    this.hooks.onStatus && this.hooks.onStatus({ songId: song.id, preparing: false, ready: true, text: song.stems.length ? 'Ready' : 'No tracks for this song' });
    if (wasPlaying) this.play((pos * oldTempo) / this.tempo);
    else this.pos = Math.min((this.pos * oldTempo) / this.tempo, this.duration || 0);
  }

  applyMix(song) {
    const anySolo = song.stems.some((s) => s.solo);
    for (const stem of song.stems) {
      const strip = this.strips.get(stem.id);
      if (!strip) continue;
      const audible = !stem.mute && (!anySolo || stem.solo);
      strip.gain.gain.setTargetAtTime(audible ? dbToGain(stem.gain || 0) : 0, this.ctx.currentTime, 0.015);
      strip.pan.pan.setTargetAtTime(stem.pan || 0, this.ctx.currentTime, 0.015);
      if ((stem.out || 0) !== strip.outPair) this.route(strip, stem.out || 0);
    }
    const click = this.strips.get('__click');
    if (click) {
      const c = song.click || {};
      // The strip is always open (count-in, guides); only the click source is muted when off.
      click.gain.gain.setTargetAtTime(dbToGain(c.level ?? -6), this.ctx.currentTime, 0.015);
      if (this.clickGain) this.clickGain.gain.setTargetAtTime(c.on ? 1 : 0, this.ctx.currentTime, 0.015);
      if ((c.out ?? 1) !== click.outPair) this.route(click, c.out ?? 1);
      const sig = JSON.stringify([song.bpm, song.targetBpm, song.beatsPerBar, song.downbeat]);
      if (sig !== this.clickSig) this.buildClick(song);
    }
  }

  // Click audio for the whole song at its current tempo.
  buildClick(song, restart = true) {
    this.clickSig = JSON.stringify([song.bpm, song.targetBpm, song.beatsPerBar, song.downbeat]);
    const dur = Math.max(1, this.duration || 1);
    const sr = this.ctx.sampleRate;
    const data = clickTrack(sr, dur, grid(song));
    const buf = this.ctx.createBuffer(1, data.length, sr);
    buf.copyToChannel(data, 0);
    this.clickBuf = buf;
    if (restart && this.playing) this.play(this.position());
  }

  // Seconds of count-in left (for the display), or 0.
  countingIn() {
    return this.playing ? Math.max(0, this.startTime - this.ctx.currentTime) : 0;
  }

  computePeaks(n = 1200) {
    const bufs = [...this.buffers.entries()].filter(([id]) => !/click|cue|guide/i.test((this.song.stems.find((s) => s.id === id) || {}).name || ''));
    const list = (bufs.length ? bufs : [...this.buffers.entries()]).map(([, b]) => b);
    if (!list.length) return null;
    const peaks = new Float32Array(n);
    for (const b of list) {
      const d = b.getChannelData(0);
      const per = Math.max(1, Math.floor(d.length / n));
      for (let i = 0; i < n; i++) {
        let m = 0;
        for (let j = i * per, e = Math.min(d.length, j + per); j < e; j += 8) m = Math.max(m, Math.abs(d[j]));
        peaks[i] = Math.max(peaks[i], m);
      }
    }
    return peaks;
  }

  // ----- transport ---------------------------------------------------------------
  // Song position = startPos + (ctx time - startTime). A scheduled jump changes both at its bar line.
  position() {
    if (!this.playing) return this.pos;
    const j = this.jumping;
    if (j && this.ctx.currentTime >= j.when) {
      this.startTime = j.when;
      this.startPos = j.to;
      this.jumping = null;
      this.justJumped = true;
    }
    if (this.ctx.currentTime < this.startTime) return this.startPos; // counting in
    let p = this.startPos + (this.ctx.currentTime - this.startTime);
    if (this.loop && p > this.loop.end) p = this.loop.start + ((p - this.loop.start) % (this.loop.end - this.loop.start));
    return Math.max(0, p);
  }

  // Start every stem (and the click) at `pos` at context time `when`.
  startSources(pos, when) {
    const list = [];
    const add = (buf, dest, gain) => {
      if (!buf || pos >= buf.duration) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      if (this.loop) Object.assign(src, { loop: true, loopStart: this.loop.start, loopEnd: this.loop.end });
      src.connect(gain || dest);
      src.start(when, pos);
      list.push(src);
    };
    for (const stem of this.song.stems) {
      const strip = this.strips.get(stem.id);
      if (strip) add(this.buffers.get(stem.id), strip.input);
    }
    const click = this.strips.get('__click');
    if (click && this.clickBuf) {
      this.clickGain = this.clickGain || this.ctx.createGain();
      this.clickGain.disconnect();
      this.clickGain.connect(click.input);
      this.clickGain.gain.value = this.song.click && this.song.click.on ? 1 : 0;
      add(this.clickBuf, click.input, this.clickGain);
    }
    return list;
  }

  // countInBars: bars of click before the music starts (only used for "play").
  play(from, { countInBars = 0 } = {}) {
    if (!this.song) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const pos = Math.max(0, Math.min(from ?? this.pos, this.duration || 0));
    this.stopSources();
    this.planned = null;
    this.jumping = null;
    let when = this.ctx.currentTime + 0.05;
    if (countInBars > 0) {
      const ci = countIn(this.ctx.sampleRate, grid(this.song), countInBars);
      const buf = this.ctx.createBuffer(1, ci.data.length, this.ctx.sampleRate);
      buf.copyToChannel(ci.data, 0);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.strips.get('__click').input);
      src.start(when);
      this.sources.push(src);
      when += ci.seconds;
    }
    this.sources.push(...this.startSources(pos, when));
    this.startTime = when;
    this.startPos = pos;
    this.lastTickPos = pos - 0.001;
    this.guideDone.clear();
    this.playing = true;
    this.hooks.onPlayState && this.hooks.onPlayState(true, pos);
  }

  stopSources(when) {
    for (const s of this.sources) try { s.stop(when); if (when === undefined) s.disconnect(); } catch {}
    this.sources = [];
  }

  stop() {
    this.pos = this.position();
    this.stopSources();
    this.playing = false;
    this.planned = null;
    this.jumping = null;
    this.hooks.onPlayState && this.hooks.onPlayState(false, this.pos);
  }

  seek(pos) {
    if (this.playing) this.play(pos);
    else this.pos = Math.max(0, Math.min(pos, this.duration || 0));
  }

  // Jump to `to`: now, at the next bar line ('bar'), or at song time `at`. Replaces any planned jump.
  jump(to, { quantize = 'bar', at = null, label = '' } = {}) {
    if (!this.playing) return this.seek(to);
    if (this.loop) this.setLoop(null);
    const pos = this.position();
    const when = at ?? (quantize === 'bar' ? nextBar(pos, grid(this.song), 0.15) : pos);
    if (when - pos < 0.02) return this.play(to);
    this.planned = { at: when, to, label };
    this.hooks.onPlan && this.hooks.onPlan(this.planned);
  }

  cancelJump() {
    this.planned = null;
    this.hooks.onPlan && this.hooks.onPlan(null);
  }

  // The planned jump is close: schedule the audio sample-accurately.
  armJump() {
    const p = this.planned;
    this.planned = null;
    const when = Math.max(this.ctx.currentTime + 0.01, this.startTime + (p.at - this.startPos));
    const old = this.sources;
    this.sources = [];
    for (const s of old) try { s.stop(when); } catch {}
    this.sources = this.startSources(p.to, when);
    this.jumping = { when, to: p.to };
    this.guideDone.clear();
    this.hooks.onPlan && this.hooks.onPlan(null);
  }

  // Where the section around `pos` starts and ends (in playback time).
  sectionRange(pos) {
    const ms = this.markerTimes();
    const cur = this.sectionAt(pos);
    const start = cur ? cur.t : 0;
    const i = cur ? ms.indexOf(cur) : -1;
    const next = ms.slice(i + 1).find((m) => m.t > start + 0.05);
    return { cur, start, end: next ? next.t : this.duration || 0, next, after: next ? ms.slice(ms.indexOf(next) + 1).find((m) => m.t > next.t + 0.05) : null };
  }

  // Play this section again when it ends.
  repeatSection() {
    const r = this.sectionRange(this.position());
    if (r.end <= r.start) return;
    this.jump(r.start, { at: r.end - 0.001, label: 'repeat' });
  }

  // When this section ends, skip the next one.
  skipNext() {
    const r = this.sectionRange(this.position());
    if (!r.next) return;
    this.jump(r.after ? r.after.t : this.duration, { at: r.end - 0.001, label: 'skip' });
  }

  setLoop(range) {
    // Re-base the clock so position() stays right
    if (this.playing) {
      this.startPos = this.position();
      this.startTime = this.ctx.currentTime;
    }
    this.loop = range && range.end > range.start + 0.05 ? range : null;
    for (const s of this.sources) {
      if (this.loop) Object.assign(s, { loopStart: this.loop.start, loopEnd: this.loop.end, loop: true });
      else s.loop = false;
    }
    if (!this.loop && this.playing) {
      // Sources were looping: restart them at the right place so they keep going past the loop end.
      this.play(this.position());
    }
  }

  // Spoken cue for a section name: "Verse 2" uses the "verse" sample.
  guideFor(name) {
    const cues = this.guideCues || {};
    const base = String(name || '').toLowerCase().replace(/[^a-z ]/g, '').trim().split(/\s+/)[0];
    return cues[base] || null;
  }

  // Schedule guide cues that are due in the next 0.3 s (one bar before each marker).
  scheduleGuides(pos) {
    if (!this.song || !this.song.guides || !this.guideCues) return;
    const bar = barLength(grid(this.song));
    for (const m of this.markerTimes()) {
      const t = m.t - bar;
      const id = `${m.sectionId}@${m.t.toFixed(2)}`;
      if (t < pos - 0.05 || t > pos + 0.3 || this.guideDone.has(id)) continue;
      this.guideDone.add(id);
      const sec = this.song.sections.find((x) => x.id === m.sectionId);
      const file = sec && this.guideFor(sec.name);
      if (!file) continue;
      this.decode(file).then((buf) => {
        if (!this.playing) return;
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.connect(this.strips.get('__click').input);
        src.start(Math.max(this.ctx.currentTime, this.startTime + (t - this.startPos)));
        this.sources.push(src);
      }).catch(() => {});
    }
  }

  // Markers are in the song's original timeline; playback time is divided by the tempo ratio.
  markerTimes() {
    if (!this.song) return [];
    return (this.song.markers || []).map((m) => ({ sectionId: m.sectionId, t: m.time / (this.tempo || 1) })).sort((a, b) => a.t - b.t);
  }

  sectionAt(pos) {
    let cur = null;
    for (const m of this.markerTimes()) if (m.t <= pos + 0.02) cur = m;
    return cur;
  }

  tick() {
    if (!this.playing) return;
    if (this.planned && this.position() >= this.planned.at - 0.25) this.armJump();
    const pos = this.position();
    const prev = this.lastTickPos;
    if (this.justJumped) {
      this.justJumped = false;
      const m = this.sectionAt(pos);
      if (m) this.hooks.onMarker && this.hooks.onMarker(m.sectionId);
    } else if (pos < prev) {
      // looped back: the section at the loop start is current again
      const m = this.sectionAt(pos);
      if (m) this.hooks.onMarker && this.hooks.onMarker(m.sectionId);
    } else {
      for (const m of this.markerTimes()) if (m.t > prev && m.t <= pos) this.hooks.onMarker && this.hooks.onMarker(m.sectionId);
    }
    this.lastTickPos = pos;
    if (!this.jumping) this.scheduleGuides(pos);
    if (!this.loop && !this.planned && !this.jumping && pos >= (this.duration || 0) - 0.01) {
      this.stop();
      this.pos = 0;
    }
  }

  meterLevels() {
    const out = {};
    const tmp = new Float32Array(512);
    for (const [id, strip] of this.strips) {
      strip.meter.getFloatTimeDomainData(tmp);
      let m = 0;
      for (let i = 0; i < tmp.length; i++) m = Math.max(m, Math.abs(tmp[i]));
      out[id] = m;
    }
    if (this.vocal) {
      this.vocal.inMeter.getFloatTimeDomainData(tmp);
      let m = 0;
      for (let i = 0; i < tmp.length; i++) m = Math.max(m, Math.abs(tmp[i]));
      out.vocal = m;
    }
    return out;
  }

  // ----- vocal chain -------------------------------------------------------------
  async startVocal(deviceId, channel = 0) {
    this.stopVocal();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 }, latency: 0 },
    });
    const ctx = this.ctx;
    const src = ctx.createMediaStreamSource(stream);
    const split = ctx.createChannelSplitter(2);
    src.connect(split);
    const inGain = ctx.createGain();
    split.connect(inGain, Math.min(channel, 1));
    const inMeter = ctx.createAnalyser();
    inMeter.fftSize = 512;
    inGain.connect(inMeter);
    const tuner = new AudioWorkletNode(ctx, 'autotune', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    tuner.port.onmessage = (e) => this.hooks.onTuner && this.hooks.onTuner(e.data);
    const low = new BiquadFilterNode(ctx, { type: 'lowshelf', frequency: 180 });
    const hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 90, Q: 0.7 });
    const mid = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 2500, Q: 0.9 });
    const high = new BiquadFilterNode(ctx, { type: 'highshelf', frequency: 9000 });
    const comp = new DynamicsCompressorNode(ctx, { attack: 0.005, release: 0.15, knee: 6 });
    const makeup = ctx.createGain();
    const toStereo = ctx.createGain();
    toStereo.channelCount = 2;
    inGain.connect(tuner).connect(hp).connect(low).connect(mid).connect(high).connect(comp).connect(makeup);
    // Sends
    const revSend = ctx.createGain();
    const reverb = new ConvolverNode(ctx, { buffer: this.impulse(2.4) });
    const dlySend = ctx.createGain();
    const delay = new DelayNode(ctx, { maxDelayTime: 4 });
    const fb = ctx.createGain();
    const dlyTone = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 4500 });
    makeup.connect(toStereo);
    makeup.connect(revSend).connect(reverb).connect(toStereo);
    makeup.connect(dlySend).connect(delay).connect(dlyTone).connect(fb).connect(delay);
    dlyTone.connect(toStereo);
    const outStrip = this.makeStrip();
    toStereo.connect(outStrip.input);
    this.route(outStrip, 0);
    this.vocal = { stream, src, inGain, inMeter, tuner, low, mid, high, comp, makeup, revSend, dlySend, delay, fb, outStrip, nodes: [split, hp, reverb, dlyTone, toStereo] };
    if (this.vocalSettings) this.setVocal(...this.vocalSettings);
    if (ctx.state === 'suspended') await ctx.resume();
  }

  stopVocal() {
    if (!this.vocal) return;
    for (const t of this.vocal.stream.getTracks()) t.stop();
    try { this.vocal.src.disconnect(); this.vocal.outStrip.splitter.disconnect(); } catch {}
    this.vocal = null;
  }

  // v: vocal settings; key: 0-11 or null; minor: bool; bpm: number
  setVocal(v, key, minor, bpm) {
    this.vocalSettings = [v, key, minor, bpm];
    const voc = this.vocal;
    if (!voc) return;
    const t = this.ctx.currentTime;
    voc.outStrip.gain.gain.setTargetAtTime(v.on ? 1 : 0, t, 0.02);
    voc.inGain.gain.setTargetAtTime(dbToGain(v.gain || 0), t, 0.02);
    const scale = v.autotune.scale === 'song' ? (key === null || key === undefined ? 'chromatic' : minor ? 'minor' : 'major') : v.autotune.scale;
    voc.tuner.port.postMessage({ on: !!v.autotune.on, amount: v.autotune.amount, speedMs: v.autotune.speed, key: key ?? 0, scale });
    voc.low.gain.setTargetAtTime(v.eq.low, t, 0.02);
    voc.mid.gain.setTargetAtTime(v.eq.mid, t, 0.02);
    voc.high.gain.setTargetAtTime(v.eq.high, t, 0.02);
    voc.comp.threshold.setTargetAtTime(-6 - 30 * v.comp, t, 0.02);
    voc.comp.ratio.setTargetAtTime(1 + 7 * v.comp, t, 0.02);
    voc.makeup.gain.setTargetAtTime(dbToGain(8 * v.comp), t, 0.02);
    voc.revSend.gain.setTargetAtTime(v.reverb * 0.6, t, 0.02);
    voc.dlySend.gain.setTargetAtTime(v.delay * 0.5, t, 0.02);
    voc.fb.gain.setTargetAtTime(0.35, t, 0.02);
    voc.delay.delayTime.setTargetAtTime(Math.min(4, (60 / (bpm || 120)) * (v.fx.delayBeats || 0.75)), t, 0.05);
  }

  impulse(sec) {
    const sr = this.ctx.sampleRate, n = Math.floor(sr * sec);
    const buf = this.ctx.createBuffer(2, n, sr);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        d[i] = (Math.random() * 2 - 1) * Math.exp(-t * 3.2) * (t < 0.02 ? t / 0.02 : 1) * 0.6;
      }
    }
    return buf;
  }
}
