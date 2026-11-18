'use strict';
// Actions – Live control: group faders/colours/effects, strobe, flash, tempo, masters. Each action runs with `this` = the engine; return { show: true } when the saved show changed.
const { clamp01, palIndex, num } = require('../util');

module.exports = {
  // Panic: drop every live change and go to the safe look (house/worship lights) at full master.
  'panic'() {
    this.programmer = {};
    this.progRefs = {};
    this.rt.busk = {};
    this.rt.running = {};
    this.rt.livePresets = {};
    this.rt.padFlash = {};
    this.rt.padsOn = {};
    this.rt.strobe = false;
    this.rt.flashAll = false;
    this.rt.blackout = false;
    this.rt.gm = 1;
    this.rt.hold = false;
    // Back to the worship part at full brightness (e.g. stuck dimmed after a video)
    const w = this.show.parts.find((p) => p.sections && !p.video);
    if (w) {
      this.rt.partFade = { from: this.partLevelAt(), to: w.level, start: Date.now(), dur: 1000 };
      this.rt.partId = w.id;
      this.rt.partAuto = false;
    }
    const safe = this.show.looks.find((l) => l.id === this.show.settings.safeLookId);
    if (safe) {
      this.rt.sectionId = null;
      this.setBase({ kind: 'look', lookId: safe.id }, 1);
    }
  },

  // Live control (busking) per group
  'busk.level'(a) {
    this.findIndex(this.show.groups, a.groupId);
    this.buskFor(a.groupId).level = clamp01(num(a.level, 'Level'));
  },

  'busk.color'(a) {
    this.findIndex(this.show.groups, a.groupId);
    const role = palIndex(a.role);
    this.buskFor(a.groupId).color = role >= 0 ? `pal:${role + 1}` : a.rgb ? a.rgb.map((v) => clamp01(num(v, 'Colour'))) : null;
  },

  'busk.fx'(a) {
    this.findIndex(this.show.groups, a.groupId);
    let fx = null;
    if (a.fx === 'off') fx = 'off';
    else if (this.effectById(a.fx)) fx = { type: a.fx, rate: [0.25, 0.5, 1, 2, 4].includes(Number(a.rate)) ? Number(a.rate) : 1 };
    this.buskFor(a.groupId).fx = fx;
  },

  'busk.flash'(a) {
    this.findIndex(this.show.groups, a.groupId);
    this.buskFor(a.groupId).flash = !!a.on;
  },

  'busk.release'(a) {
    if (a.groupId) delete this.rt.busk[a.groupId];
    else {
      this.rt.busk = {};
      this.rt.running = {};
      this.rt.livePresets = {};
      this.rt.padFlash = {};
      this.rt.padsOn = {};
    }
  },


  // Hold buttons available everywhere
  'strobe.hold'(a) {
    this.rt.strobe = a.on ? a.groupId || true : false;
  },

  'flash.all'(a) {
    this.rt.flashAll = !!a.on;
  },


  // Tempo
  'tempo.tap'() {
    const now = Date.now();
    this.taps = this.taps.filter((t) => now - t < 2500);
    this.taps.push(now);
    this.rt.beatT0 = now;
    if (this.taps.length >= 2) {
      const span = (this.taps.at(-1) - this.taps[0]) / (this.taps.length - 1);
      this.rt.bpm = Math.max(30, Math.min(300, 60000 / span));
    }
    this.rt.clock = false;
  },

  'tempo.set'(a) {
    const bpm = num(a.bpm, 'BPM');
    if (bpm < 30 || bpm > 300) throw new Error('BPM must be 30 to 300');
    this.rt.bpm = bpm;
    this.rt.clock = false;
  },

  // From MIDI clock (24 ticks per beat): called once per beat.
  'tempo.beat'(a) {
    const prevBpm = this.rt.bpm, prevClock = this.rt.clock;
    this.rt.beatT0 = Date.now();
    if (a.bpm >= 30 && a.bpm <= 300) this.rt.bpm = Number(a.bpm);
    this.rt.clock = true;
    // Only broadcast when the number on screen changes.
    if (Math.abs(prevBpm - this.rt.bpm) < 0.5 && prevClock) return { runtime: false };
  },

  'tempo.clockStop'() {
    this.rt.clock = false;
  },


  // Masters
  'gm.set'(a) {
    this.rt.gm = clamp01(num(a.value, 'Grand master'));
  },

  'blackout.set'(a) {
    this.rt.blackout = !!a.on;
  },
};
