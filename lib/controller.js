'use strict';
// Hardware controllers: Launchpad (Mini MK3 / X / Pro MK3), APC mini mk2, or any MIDI controller
// (Learn). Buttons run the service: service parts, the current song's sections, set-list songs,
// pads, and Prev / Next / Next item / Flash / Strobe / Blackout / Panic / Tap. Their lights show
// what is on.
//
// Grid layout (8 x 8, top row first):
//   row 8      service parts
//   rows 7-5   sections of the current song (24)
//   row 4      pads 1-8
//   row 3      pads 9-16
//   row 2      set-list songs 1-8
//   row 1      ◀ section, section ▶, next item, Flash (hold), Strobe (hold), Blackout, Panic (hold 1 s), Tap
//
// The controller's own MIDI port is opened separately (MidiIn.setControllerPort), so its notes
// never trigger song sections.
const { nameKey } = require('./engine/util');
const FX = require('../public/fxmath');

// Launchpad / APC mini mk2 colour palette (velocity numbers): a few clear colours
const PALETTE = [
  [0, [0, 0, 0]], [3, [255, 255, 255]], [1, [70, 70, 70]], [5, [255, 0, 0]], [9, [255, 100, 0]], [13, [255, 220, 0]],
  [17, [130, 255, 0]], [21, [0, 255, 0]], [33, [0, 255, 150]], [37, [0, 220, 255]], [41, [0, 120, 255]], [45, [0, 0, 255]],
  [49, [90, 0, 255]], [53, [180, 0, 255]], [57, [255, 0, 180]], [95, [255, 0, 80]],
];
const C = { off: 0, dim: 1, white: 3, red: 5, amber: 9, yellow: 13, green: 21, cyan: 37, blue: 45, purple: 53 };

// Nearest palette colour for a hex colour
function velFor(hex) {
  const [r, g, b] = FX.hexToRgb(hex || '#ffffff').map((x) => x * 255);
  let best = 3, bd = Infinity;
  for (const [v, [pr, pg, pb]] of PALETTE) {
    if (v === 0 || v === 1) continue;
    const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (d < bd) { bd = d; best = v; }
  }
  return best;
}

const PROFILES = {
  launchpad: {
    name: 'Launchpad (Mini MK3, X, Pro MK3: Programmer mode)',
    note: (row, col) => row * 10 + col, // row 1 = bottom
    // Programmer mode (Mini MK3, X, Pro MK3: devices ignore the others' messages)
    init: [[0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x0e, 0x01, 0xf7], [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0c, 0x0e, 0x01, 0xf7], [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0e, 0x0e, 0x01, 0xf7]],
    light: (note, vel, pulse) => [pulse ? 0x92 : 0x90, note, vel],
  },
  apcmini: {
    name: 'Akai APC mini mk2',
    note: (row, col) => (row - 1) * 8 + (col - 1),
    init: [],
    light: (note, vel, pulse) => [pulse ? 0x9a : 0x96, note, vel], // channel 7 = full brightness, 11 = pulsing
  },
  generic: { name: 'Any MIDI controller (Learn each button)', generic: true },
};

// Everything a button can do: key -> { label, press, release, light }
function functions(app) {
  const e = app.engine, rt = e.rt, sh = e.show;
  const fns = new Map();
  const add = (key, def) => fns.set(key, def);
  sh.parts.slice(0, 8).forEach((p, i) => add(`part:${i}`, {
    label: `Part: ${p.name}`,
    press: () => ({ type: 'part.go', id: p.id }),
    light: () => (rt.partId === p.id ? [p.video ? C.amber : C.green, false] : [p.video ? C.amber : C.blue, false, true]),
  }));
  const song = e.song(rt.songId);
  for (let i = 0; i < 24; i++) {
    const sec = song && song.sections[i];
    add(`sec:${i}`, {
      label: `Section ${i + 1} of the current song`,
      press: () => (sec ? { type: 'section.go', songId: song.id, id: sec.id } : null),
      light: () => {
        if (!sec) return [C.off];
        const look = sec.lookId && sh.looks.find((l) => l.id === sec.lookId);
        const v = look ? velFor(look.color) : C.dim;
        if (sec.id === rt.sectionId) return [v, true];
        return [v, false, true];
      },
    });
  }
  sh.pads.slice(0, 16).forEach((pad, i) => add(`pad:${i}`, {
    label: `Pad: ${pad.name}`,
    press: () => ({ type: 'pad.press', id: pad.id, down: true }),
    release: () => ({ type: 'pad.press', id: pad.id, down: false }),
    light: () => ((rt.padsOn || {})[pad.id] || (rt.padFlash || {})[pad.id] ? [C.purple] : [C.dim]),
  }));
  e.setList().slice(0, 8).forEach((s, i) => add(`song:${i}`, {
    label: `Song: ${s.name}`,
    press: () => ({ type: 'song.select', id: s.id }),
    light: () => (rt.songId === s.id ? [C.green] : [C.white, false, true]),
  }));
  add('prev', { label: '◀ Previous section', press: () => (song ? { type: 'section.go', songId: song.id, dir: -1 } : null), light: () => [song ? C.white : C.off] });
  add('next', { label: 'Next section ▶', press: () => (song ? { type: 'section.go', songId: song.id, dir: 1 } : null), light: () => [song ? C.green : C.off] });
  add('item', { label: 'Next item in the service order', press: () => (sh.order ? { type: 'order.go', dir: 1 } : null), light: () => [sh.order ? C.cyan : C.off] });
  add('flash', { label: 'Flash (hold)', press: () => ({ type: 'flash.all', on: true }), release: () => ({ type: 'flash.all', on: false }), light: () => [rt.flashAll ? C.white : C.dim] });
  add('strobe', { label: 'Strobe (hold)', press: () => ({ type: 'strobe.hold', on: true }), release: () => ({ type: 'strobe.hold', on: false }), light: () => [rt.strobe ? C.white : C.dim] });
  add('blackout', { label: 'Blackout on/off', press: () => ({ type: 'blackout.set', on: !rt.blackout }), light: () => (rt.blackout ? [C.red, true] : [C.red, false, true]) });
  add('panic', { label: 'Panic (hold 1 second)', holdMs: 1000, press: () => ({ type: 'panic' }), light: () => [C.amber] });
  add('tap', { label: 'Tap tempo', press: () => ({ type: 'tempo.tap' }), light: () => [C.yellow] });
  return fns;
}

// Grid: key for (row, col), rows 1-8 bottom to top
function gridKey(row, col) {
  const c = col - 1;
  if (row === 8) return `part:${c}`;
  if (row >= 5) return `sec:${(7 - row) * 8 + c}`;
  if (row === 4) return `pad:${c}`;
  if (row === 3) return `pad:${8 + c}`;
  if (row === 2) return `song:${c}`;
  return ['prev', 'next', 'item', 'flash', 'strobe', 'blackout', 'panic', 'tap'][c];
}

class Controller {
  constructor(app, midi) {
    this.app = app;
    this.midi = midi;
    this.cfg = { enabled: false, port: '', profile: 'launchpad', learned: {} };
    this.sentLights = new Map();
    this.held = new Map();
    this.timer = null;
  }

  configure(cfg = {}) {
    const next = { enabled: !!cfg.enabled, port: String(cfg.port || ''), profile: PROFILES[cfg.profile] ? cfg.profile : 'launchpad', learned: cfg.learned || {} };
    const changed = next.port !== this.cfg.port || next.profile !== this.cfg.profile || next.enabled !== this.cfg.enabled;
    this.cfg = next;
    if (!changed) return;
    this.sentLights.clear();
    this.midi.setControllerPort(next.enabled ? next.port : '');
    clearInterval(this.timer);
    this.timer = null;
    if (next.enabled && next.port) {
      for (const m of this.profile().init || []) this.send(m);
      this.timer = setInterval(() => this.refreshLights(), 100);
    }
  }

  profile() {
    return PROFILES[this.cfg.profile];
  }

  // The output port with the same (or a similar) name as the input
  outPort() {
    const outs = this.midi.outPorts ? this.midi.outPorts() : [];
    const p = this.cfg.port;
    return outs.find((o) => o === p) || outs.find((o) => nameKey(o).startsWith(nameKey(p).slice(0, 10))) || p;
  }

  send(bytes) {
    if (this.cfg.port) this.midi.send(this.outPort(), bytes);
  }

  // Key of the button a message is from (or null)
  keyOf(msg) {
    const st = msg[0] & 0xf0, n = msg[1];
    if (this.profile().generic) {
      const t = st === 0xb0 ? 'cc' : 'note';
      for (const [key, trig] of Object.entries(this.cfg.learned)) if (trig && trig.t === t && trig.n === n && trig.ch === (msg[0] & 0x0f)) return key;
      return null;
    }
    if (st !== 0x90 && st !== 0x80) return null;
    for (let row = 1; row <= 8; row++) for (let col = 1; col <= 8; col++) if (this.profile().note(row, col) === n) return gridKey(row, col);
    return null;
  }

  // A message from the controller
  message(msg) {
    const st = msg[0] & 0xf0;
    if (st !== 0x90 && st !== 0x80 && st !== 0xb0) return null;
    const down = (st === 0x90 || st === 0xb0) && msg[2] > 0;
    const learn = this.app.engine.rt.controllerLearn;
    if (learn) {
      if (!down) return null;
      const action = { type: 'controller.learned', key: learn, trigger: { t: st === 0xb0 ? 'cc' : 'note', ch: msg[0] & 0x0f, n: msg[1] } };
      this.run(action);
      return action;
    }
    const key = this.keyOf(msg);
    const fn = key && functions(this.app).get(key);
    if (!fn) return null;
    let action = null;
    if (down) {
      if (fn.holdMs) {
        // Hold to run (Panic): only after holding the button
        this.held.set(key, setTimeout(() => { this.held.delete(key); this.run(fn.press()); }, fn.holdMs));
        return null;
      }
      action = fn.press();
    } else {
      if (this.held.has(key)) { clearTimeout(this.held.get(key)); this.held.delete(key); }
      action = fn.release ? fn.release() : null;
    }
    this.run(action);
    return action;
  }

  run(action) {
    if (!action) return;
    try { this.app.input(action); } catch (e) { this.app.log.warn(`Controller: ${e.message}`); }
  }

  // Lights: what each button should show; only changes are sent
  lights() {
    const fns = functions(this.app);
    const out = [];
    if (this.profile().generic) {
      for (const [key, trig] of Object.entries(this.cfg.learned)) {
        const fn = fns.get(key);
        if (!fn || !trig || trig.t !== 'note') continue;
        const [vel] = fn.light();
        out.push({ id: `${trig.ch}:${trig.n}`, bytes: [0x90 | trig.ch, trig.n, vel > 1 ? 127 : 0] });
      }
      return out;
    }
    for (let row = 1; row <= 8; row++) {
      for (let col = 1; col <= 8; col++) {
        const fn = fns.get(gridKey(row, col));
        const [vel, pulse, dimmed] = fn ? fn.light() : [C.off];
        const note = this.profile().note(row, col);
        // "dimmed": a quieter version where the controller has one (APC: lower brightness channel)
        let bytes = this.profile().light(note, vel, pulse);
        if (dimmed && this.cfg.profile === 'apcmini') bytes = [0x93, note, vel];
        out.push({ id: String(note), bytes });
      }
    }
    return out;
  }

  refreshLights() {
    if (!this.cfg.enabled || !this.cfg.port) return;
    for (const { id, bytes } of this.lights()) {
      const k = bytes.join(',');
      if (this.sentLights.get(id) === k) continue;
      this.sentLights.set(id, k);
      this.send(bytes);
    }
  }

  // Every function, for the Learn list
  static functionList(app) {
    return [...functions(app)].map(([key, f]) => ({ key, label: f.label }));
  }

  close() {
    clearInterval(this.timer);
    for (const t of this.held.values()) clearTimeout(t);
  }
}

module.exports = { Controller, PROFILES, gridKey, velFor, functions };
