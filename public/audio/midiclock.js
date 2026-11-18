// MIDI clock out from the computer that plays the tracks, so a keyboard rig, delay pedal or
// Ableton follows the song tempo: 24 clocks per beat, Start/Continue/Stop and Song Position.
// Clocks are timestamped ahead of time, so they stay steady even when the page is busy.
import { grid } from './timing.js';

const CLOCK = 0xf8, START = 0xfa, CONTINUE = 0xfb, STOP = 0xfc, SPP = 0xf2;
const AHEAD = 0.12; // seconds scheduled ahead

export class MidiClock {
  constructor(engine) {
    this.engine = engine;
    this.access = null;
    this.out = null;
    this.running = false;
    this.next = 0; // index of the next clock to send
    this.timer = null;
  }

  // List of MIDI outputs [{ id, name }]; asks the browser for MIDI access the first time.
  async outputs() {
    if (!navigator.requestMIDIAccess) throw new Error('This browser has no Web MIDI (use Chrome, Edge or the desktop app)');
    if (!this.access) this.access = await navigator.requestMIDIAccess();
    return [...this.access.outputs.values()].map((o) => ({ id: o.id, name: o.name }));
  }

  async setOutput(id) {
    this.stopClock();
    this.out = null;
    if (!id) return;
    await this.outputs();
    this.out = this.access.outputs.get(id) || null;
    if (!this.out) throw new Error('That MIDI output is not connected');
    this.timer = this.timer || setInterval(() => this.pump(), 25);
  }

  // Context time -> performance.now() milliseconds (Web MIDI timestamps)
  // The audio clock moves in steps of 128 samples, so the offset between the two clocks is
  // smoothed over time: steady clock spacing, while still following slow drift.
  syncClocks() {
    const ctx = this.engine.ctx;
    const ts = ctx.getOutputTimestamp ? ctx.getOutputTimestamp() : null;
    const off = ts && ts.performanceTime ? ts.performanceTime - ts.contextTime * 1000 : performance.now() - ctx.currentTime * 1000;
    this.offset = this.offset === undefined || Math.abs(off - this.offset) > 50 ? off : this.offset + (off - this.offset) * 0.03;
  }

  perf(ctxTime) {
    return this.offset + ctxTime * 1000;
  }

  send(bytes, ctxTime) {
    try { this.out.send(bytes, ctxTime === undefined ? undefined : this.perf(ctxTime)); } catch {}
  }

  stopClock() {
    if (this.out && this.running) this.out.send([STOP]);
    this.running = false;
  }

  // Start (or restart after a jump) at song position `pos`, at context time `when`.
  startAt(pos, when) {
    const e = this.engine;
    const g = grid(e.song);
    const tick = g.beat / 24;
    // Song Position Pointer counts 16th notes from the first downbeat.
    const beats = Math.max(0, (pos - g.downbeat) / g.beat);
    const sixteenths = Math.min(16383, Math.floor(beats * 4));
    if (this.running) this.send([STOP], when - 0.001);
    this.send([SPP, sixteenths & 0x7f, (sixteenths >> 7) & 0x7f], when - 0.001);
    this.send([sixteenths === 0 ? START : CONTINUE], when);
    // Clock k is at song time downbeat + k * tick
    this.base = { when, pos, tick, downbeat: g.downbeat };
    this.next = Math.ceil((pos - g.downbeat) / tick - 1e-6);
    this.running = true;
  }

  pump() {
    const e = this.engine;
    if (!this.out || !e.ctx) return;
    if (!e.playing) return this.stopClock();
    this.syncClocks();
    const anchor = e.jumping ? { when: e.jumping.when, pos: e.jumping.to } : { when: e.startTime, pos: e.startPos };
    // (Re)start when playback starts, or when the engine jumps / is re-based.
    if (!this.running || anchor.when !== this.anchorWhen || anchor.pos !== this.anchorPos) {
      this.anchorWhen = anchor.when;
      this.anchorPos = anchor.pos;
      if (!e.jumping || !this.running) this.startAt(e.jumping ? anchor.pos : e.position(), Math.max(e.ctx.currentTime + 0.005, e.jumping ? anchor.when : e.startTime + (e.position() - e.startPos)));
      else this.pendingJump = anchor;
    }
    const b = this.base;
    const until = e.ctx.currentTime + AHEAD;
    const jumpAt = this.pendingJump ? this.pendingJump.when : Infinity;
    for (;;) {
      const t = b.when + (b.downbeat + this.next * b.tick - b.pos);
      if (t >= until) break;
      if (t >= jumpAt) {
        // the jump happens before this clock: restart from the new place
        const j = this.pendingJump;
        this.pendingJump = null;
        this.startAt(j.pos, j.when);
        return;
      }
      if (t >= e.ctx.currentTime - 0.01) this.send([CLOCK], t);
      this.next++;
    }
  }
}
