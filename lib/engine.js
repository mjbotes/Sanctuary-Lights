'use strict';
// The lighting engine: show data, playback, mixing and DMX rendering.
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { BUILTIN_PROFILES, compileProfile, displayColor, parseChannels } = require('./profiles');
const FX = require('../public/fxmath');
const Geom = require('../public/geom');

const uid = () => crypto.randomBytes(5).toString('hex');
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
const round4 = (v) => Math.round(v * 10000) / 10000;
const ease = (t) => t * t * (3 - 2 * t); // smoothstep: gentle start and end

// Colour channel values for a fixture making the given RGB colour (0-1).
// Fixtures with a white emitter use it for the common part of R, G and B.
function colorValues(prof, [r, g, b]) {
  const has = (x) => prof.attrs.includes(x);
  const out = {};
  const w = has('white') ? Math.min(r, g, b) : 0;
  if (has('red')) out.red = round4(r - w);
  if (has('green')) out.green = round4(g - w);
  if (has('blue')) out.blue = round4(b - w);
  if (has('white')) out.white = round4(w);
  if (has('amber')) out.amber = 0;
  if (has('uv')) out.uv = 0;
  if (!has('red') && !has('green') && !has('blue') && has('white')) out.white = Math.max(r, g, b);
  return out;
}

function hsvToRgb(h, s, v) {
  const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][((i % 6) + 6) % 6];
}

const COLOR_SET = new Set(['red', 'green', 'blue', 'white', 'amber', 'uv']);
const PRESET_ATTRS = {
  dim: (a) => a === 'dim',
  color: (a) => COLOR_SET.has(a),
  position: (a) => a === 'pan' || a === 'tilt',
  beam: (a) => !['dim', 'pan', 'tilt', 'haze', 'fan'].includes(a) && !COLOR_SET.has(a),
  all: (a) => a !== 'haze' && a !== 'fan',
};

// Starting pads: quick live buttons. Keys work from any tab.
function defaultPads() {
  const pad = (name, kind, effectId, mode, key) => ({ id: uid(), name, kind, effectId, presetId: null, groupId: '', mode, key, rate: 1 });
  return [
    pad('Pulse', 'effect', 'pulse', 'toggle', '1'),
    pad('Chase', 'effect', 'chase', 'toggle', '2'),
    pad('Sparkle', 'effect', 'sparkle', 'toggle', '3'),
    pad('Wave', 'effect', 'dim-wave', 'toggle', '4'),
    pad('Rainbow', 'effect', 'rainbow', 'toggle', '5'),
    pad('Beat strobe', 'effect', 'beat-strobe', 'hold', '6'),
    pad('Circle', 'effect', 'circle-phase', 'toggle', '7'),
    pad('Ballyhoo', 'effect', 'ballyhoo', 'toggle', '8'),
    pad('Figure 8', 'effect', 'fig8', 'toggle', '9'),
    pad('Breathe', 'effect', 'breathe', 'toggle', '0'),
  ];
}

function cleanEffect(e, id) {
  const n = (v, d, lo, hi) => {
    const x = Number(v);
    return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d;
  };
  const layers = (Array.isArray(e.layers) ? e.layers : []).slice(0, 8).map((l) => ({
    attr: /^[a-z][a-z0-9_]*$/i.test(l.attr) ? String(l.attr) : 'dim',
    wave: FX.WAVES[l.wave] ? l.wave : 'sine',
    mode: ['abs', 'rel', 'scale'].includes(l.mode) ? l.mode : 'abs',
    low: n(l.low, 0, 0, 1),
    high: n(l.high, 1, 0, 1),
    width: n(l.width, 0, 0, 1),
    speed: n(l.speed, 1, 0.125, 16),
    offset: n(l.offset, 0, -360, 360),
    colorA: /^#[0-9a-f]{6}$/i.test(l.colorA) || /^pal:[123]$/.test(l.colorA) ? l.colorA : '#ff0000',
    colorB: /^#[0-9a-f]{6}$/i.test(l.colorB) || /^pal:[123]$/.test(l.colorB) ? l.colorB : '#0028ff',
    smooth: !!l.smooth,
  }));
  if (!layers.length) throw new Error('An effect needs at least one layer');
  const sp = e.speed && e.speed.hz ? { hz: n(e.speed.hz, 2, 0.05, 30) } : { beats: n(e.speed && e.speed.beats, 1, 0.0625, 64) };
  return {
    id,
    name: String(e.name || 'Effect').trim().slice(0, 40) || 'Effect',
    cat: ['dim', 'color', 'position', 'beam'].includes(e.cat) ? e.cat : 'dim',
    speed: sp,
    phaseFrom: n(e.phaseFrom, 0, -1440, 1440),
    phaseTo: n(e.phaseTo, 0, -1440, 1440),
    groups: Math.floor(n(e.groups, 1, 1, 64)),
    wings: Math.floor(n(e.wings, 1, 1, 8)),
    dir: e.dir === -1 || e.dir === '-1' ? -1 : 1,
    layers,
  };
}

// Backing-track fields of a song (stems, key, tempo, markers, vocal snapshot, MIDI out).
function normalizeSong(s) {
  if (!Array.isArray(s.stems)) s.stems = [];
  if (!Array.isArray(s.markers)) s.markers = [];
  if (!(Number.isInteger(s.key) && s.key >= 0 && s.key < 12)) s.key = null;
  s.minor = !!s.minor;
  s.palette = normPalette(s.palette);
  s.transpose = Number.isInteger(s.transpose) ? s.transpose : 0;
  if (!(s.targetBpm >= 30 && s.targetBpm <= 300)) s.targetBpm = null;
  if (!s.midiOut || typeof s.midiOut !== 'object') s.midiOut = null;
  return s;
}

const VOCAL_DEFAULT = {
  on: false, gain: 0, autotune: { on: true, amount: 1, speed: 30, scale: 'song' },
  eq: { low: 0, mid: 0, high: 0 }, comp: 0.5, reverb: 0.25, delay: 0, fx: { delayBeats: 0.75 },
};
const cloneVocal = (v) => JSON.parse(JSON.stringify(v));
function mergeVocal(cur, p) {
  const out = cloneVocal(cur);
  const n = (v, lo, hi) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Number(v))) : undefined);
  if ('on' in p) out.on = !!p.on;
  if (n(p.gain, -24, 24) !== undefined) out.gain = n(p.gain, -24, 24);
  if (p.autotune) {
    const a = p.autotune;
    if ('on' in a) out.autotune.on = !!a.on;
    if (n(a.amount, 0, 1) !== undefined) out.autotune.amount = n(a.amount, 0, 1);
    if (n(a.speed, 0, 400) !== undefined) out.autotune.speed = n(a.speed, 0, 400);
    if (['song', 'major', 'minor', 'chromatic'].includes(a.scale)) out.autotune.scale = a.scale;
  }
  if (p.eq) for (const k of ['low', 'mid', 'high']) if (n(p.eq[k], -15, 15) !== undefined) out.eq[k] = n(p.eq[k], -15, 15);
  for (const k of ['comp', 'reverb', 'delay']) if (n(p[k], 0, 1) !== undefined) out[k] = n(p[k], 0, 1);
  if (p.fx && n(p.fx.delayBeats, 0.125, 4) !== undefined) out.fx.delayBeats = n(p.fx.delayBeats, 0.125, 4);
  return out;
}

// Names like "Verse 1", "verse", "VERSE 1" -> comparable forms
const nameKey = (n) => String(n || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const baseKey = (n) => nameKey(String(n || '').replace(/\s*\d+\s*$/, ''));

// Find the section of a song for a ProPresenter group name.
function matchSection(sections, groupName) {
  const k = nameKey(groupName), b = baseKey(groupName);
  return sections.find((s) => nameKey(s.name) === k)
    || (/1$/.test(k) ? sections.find((s) => nameKey(s.name) === b) : null) // "Verse 1" -> "Verse"
    || sections.find((s) => baseKey(s.name) === b)
    || null;
}

// Primary / secondary / tertiary colours. Each song can have its own.
const PALETTE_DEFAULT = ['#ffb070', '#2050ff', '#a020f0'];
const PAL_NAMES = ['Primary', 'Secondary', 'Tertiary'];
const isHex = (c) => /^#[0-9a-f]{6}$/i.test(String(c || ''));
const normPalette = (p) => (Array.isArray(p) && p.length === 3 && p.every(isHex) ? p.map((c) => c.toLowerCase()) : null);
const rgbToHex = (rgb) => '#' + rgb.map((v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0')).join('');
// 'pal:1' -> 0 ; also accepts 'primary', 'secondary', 'tertiary', 'p', 's', 't', 1-3
function palIndex(x) {
  const k = String(x ?? '').toLowerCase().trim();
  const m = /^pal:([123])$/.exec(k);
  if (m) return Number(m[1]) - 1;
  const names = { primary: 0, p: 0, '1': 0, secondary: 1, s: 1, '2': 1, tertiary: 2, t: 2, '3': 2 };
  return k in names ? names[k] : -1;
}

function defaultSettings() {
  return {
    artnet: true,
    artnetTarget: '255.255.255.255',
    artnetBase: 0,
    sacn: false,
    sacnInterface: '',
    sacnUnicast: '',
    sacnPriority: 100,
    enttec: false,
    enttecPort: '',
    enttecUniverse: 1,
    fps: 40,
    sourceName: 'Sanctuary Lights',
    midiInput: '',
    midiOutput: '',
    pp: { enabled: false, host: '', port: 1025, sections: true, songs: true, colorMode: 'off', colorTarget: 'primary', colorGroups: [] },
    osc: { enabled: true, port: 8000 },
    screenProtect: 'warn',
    midiChannel: 0,
    noteBase: 36,
    pcSelectsSong: true,
    cid: crypto.randomBytes(16).toString('hex'),
  };
}

function emptyShow() {
  return { version: 1, name: 'My Church', settings: defaultSettings(), profiles: {}, fixtures: [], groups: [], cues: [], scenes: [], looks: [], songs: [], palette: [...PALETTE_DEFAULT], stage3d: { stage: { w: 12, d: 6, h: 0.6 }, models: [] } };
}

function demoShow() {
  const show = emptyShow();
  show.name = 'Demo show';
  const add = (name, profile, universe, address, x, y) =>
    show.fixtures.push({ id: uid(), name, profile, universe, address, x, y });
  for (let i = 0; i < 4; i++) add(`Front ${i + 1}`, 'drgbw', 1, 1 + i * 5, 0.2 + i * 0.2, 0.8);
  for (let i = 0; i < 6; i++) add(`Back ${i + 1}`, 'rgbwau', 1, 21 + i * 6, 0.1 + i * 0.16, 0.25);
  add('Pulpit spot', 'dimmer', 1, 60, 0.5, 0.55);
  add('House lights', 'dimmer', 1, 61, 0.92, 0.92);
  show.groups.push({ id: uid(), name: 'Front', fixtures: show.fixtures.slice(0, 4).map((f) => f.id) });
  show.groups.push({ id: uid(), name: 'Back', fixtures: show.fixtures.slice(4, 10).map((f) => f.id) });
  // Example looks: front fixtures are Dim+RGBW, back fixtures RGBWA+UV.
  const front = show.fixtures.slice(0, 4), back = show.fixtures.slice(4, 10);
  const look = (name, color, frontVals, backVals) => {
    const values = {};
    for (const f of front) if (frontVals) values[f.id] = frontVals;
    for (const f of back) if (backVals) values[f.id] = backVals;
    show.looks.push({ id: uid(), name, color, values });
  };
  look('Intro', '#3c2aa8', { dim: 0.35, red: 0.4, green: 0.25, blue: 0.1, white: 0.3 }, { dim: 0.5, red: 0.2, green: 0, blue: 1, white: 0 });
  look('Verse', '#e0a060', { dim: 0.7, red: 0.3, green: 0.15, white: 0.7 }, { dim: 0.45, red: 0.1, green: 0.2, blue: 0.9, white: 0 });
  look('Chorus', '#ff7840', { dim: 1, red: 0.2, green: 0.1, white: 1 }, { dim: 1, red: 1, green: 0.35, blue: 0, white: 0, amber: 0.6 });
  look('Bridge', '#8a3cff', { dim: 0.5, red: 0.3, green: 0.15, white: 0.5 }, { dim: 0.85, red: 0.55, green: 0, blue: 1, white: 0, uv: 0.6 });
  look('Outro', '#2a3a80', { dim: 0.3, red: 0.3, green: 0.15, white: 0.3 }, { dim: 0.3, red: 0, green: 0.1, blue: 0.8, white: 0 });
  const byName = Object.fromEntries(show.looks.map((l) => [l.name, l.id]));
  const sections = ['Intro', 'Verse', 'Chorus', 'Verse 2', 'Chorus 2', 'Bridge', 'Chorus 3', 'Outro'];
  show.songs.push({
    id: uid(), name: 'Example song', notes: '', trigger: null,
    sections: sections.map((n) => ({ id: uid(), name: n, lookId: byName[n.replace(/ \d+$/, '')], fade: n.startsWith('Chorus') ? 0.5 : 2, trigger: null })),
  });
  return show;
}

class Engine extends EventEmitter {
  constructor(show, runtime = {}) {
    super();
    this.loadShow(show, runtime);
  }

  loadShow(show, runtime = {}) {
    const base = emptyShow();
    this.show = { ...base, ...show, settings: { ...base.settings, ...(show.settings || {}) } };
    this.programmer = {};
    this.progRefs = {};
    this.cueFade = null;
    this.sceneFades = {};
    this.compile();
    for (const k of ['presets', 'effects']) if (!Array.isArray(this.show[k])) this.show[k] = [];
    if (!Array.isArray(this.show.pads)) this.show.pads = defaultPads();
    if (!this.show.stage3d || typeof this.show.stage3d !== 'object') this.show.stage3d = { stage: { w: 12, d: 6, h: 0.6 }, models: [] };
    if (!Array.isArray(this.show.stage3d.screens)) this.show.stage3d.screens = [];
    for (const k of ['looks', 'songs']) if (!Array.isArray(this.show[k])) this.show[k] = [];
    for (const song of this.show.songs) normalizeSong(song);
    this.show.palette = normPalette(this.show.palette) || [...PALETTE_DEFAULT];
    const cueIndex = Number.isInteger(runtime.cueIndex) ? runtime.cueIndex : -1;
    const startBase = runtime.base && runtime.base.kind === 'look' && this.show.looks.some((l) => l.id === runtime.base.lookId) ? runtime.base : { kind: 'cue' };
    const song = this.show.songs.find((x) => x.id === runtime.songId);
    this.rt = {
      cueIndex: cueIndex < this.show.cues.length ? cueIndex : -1,
      base: startBase,
      songId: song ? song.id : null,
      sectionId: song && song.sections.some((x) => x.id === runtime.sectionId) ? runtime.sectionId : null,
      mode: ['manual', 'hybrid', 'auto'].includes(runtime.mode) ? runtime.mode : 'hybrid',
      hold: false,
      learn: null,
      lastMidi: null,
      sceneLevels: {},
      sceneOrder: {},
      gm: typeof runtime.gm === 'number' ? clamp01(runtime.gm) : 1,
      blackout: false,
      busk: {},
      running: {},
      livePresets: {},
      padFlash: {},
      padsOn: {},
      strobe: false,
      flashAll: false,
      tricks: { active: true, ...(runtime.tricks || {}) },
      transport: { seq: 0, cmd: 'stop', pos: 0, songId: null },
      playhead: null,
      audioHost: null,
      vocal: mergeVocal(VOCAL_DEFAULT, runtime.vocal || {}),
      pp: null,
      paletteLive: {},
      lastOsc: null,
      bpm: 120,
      beatT0: Date.now(),
      clock: false,
    };
    for (const [gid, b] of Object.entries(runtime.busk || {})) {
      if (this.show.groups.some((g) => g.id === gid)) this.rt.busk[gid] = { level: clamp01(b.level ?? 1), color: b.color || null, fx: b.fx || null, flash: false };
    }
    if (runtime.bpm >= 30 && runtime.bpm <= 300) this.rt.bpm = runtime.bpm;
    this.taps = [];
    for (const s of this.show.scenes) {
      const lvl = runtime.sceneLevels && runtime.sceneLevels[s.id];
      if (lvl > 0) this.setSceneLevel(s.id, lvl);
    }
  }

  // ----- compiled lookups -------------------------------------------------
  compile() {
    this.profiles = {};
    for (const [id, p] of Object.entries(BUILTIN_PROFILES)) this.profiles[id] = { ...compileProfile(p), builtin: true };
    for (const [id, p] of Object.entries(this.show.profiles)) {
      try {
        this.profiles[id] = compileProfile(p);
      } catch (e) {
        this.emit('log', `Profile ${p.name}: ${e.message}`);
      }
    }
    this.fixtureMap = new Map();
    for (const f of this.show.fixtures) {
      const prof = this.profiles[f.profile];
      if (prof) this.fixtureMap.set(f.id, { fixture: f, prof });
    }
  }

  profileList() {
    return Object.entries(this.profiles).map(([id, p]) => ({
      id,
      name: p.name,
      builtin: !!p.builtin,
      footprint: p.footprint,
      attrs: p.attrs,
      channels: p.builtin ? BUILTIN_PROFILES[id].channels : this.show.profiles[id].channels,
    }));
  }

  // ----- looks ------------------------------------------------------------
  defaultsLook() {
    const look = {};
    for (const [id, { prof }] of this.fixtureMap) look[id] = { ...prof.defaults };
    return look;
  }

  // Values of whatever drives the base layer: the cue list or a song look.
  baseValues() {
    if (this.rt.base.kind === 'look') {
      const look = this.show.looks.find((l) => l.id === this.rt.base.lookId);
      return look ? look.values : {};
    }
    const cue = this.show.cues[this.rt.cueIndex];
    return cue ? cue.values : {};
  }

  baseTarget() {
    const look = this.defaultsLook();
    for (const [fid, vals] of Object.entries(this.baseValues() || {})) {
      if (!look[fid]) continue;
      for (const [a, v] of Object.entries(vals)) if (a in look[fid]) look[fid][a] = v;
    }
    this.applyRefs(look, this.baseRefs());
    return look;
  }

  baseRefs() {
    const src = this.rt.base.kind === 'look' ? this.show.looks.find((x) => x.id === this.rt.base.lookId) : this.show.cues[this.rt.cueIndex];
    return (src && src.refs) || {};
  }

  // ----- palette -------------------------------------------------------------------
  paletteSource() {
    const song = this.show.songs.find((x) => x.id === this.rt.songId);
    return song && song.palette ? 'song' : 'show';
  }
  paletteNow() {
    const song = this.show.songs.find((x) => x.id === this.rt.songId);
    const base = (song && song.palette) || this.show.palette;
    return base.map((c, i) => this.rt.paletteLive[i] || c);
  }
  palRgb(i) {
    return FX.hexToRgb(this.paletteNow()[i] || '#ffffff');
  }
  // Colour token -> rgb 0..1: '#rrggbb', 'pal:1'..'pal:3', or [r,g,b]
  colorRgb(c) {
    if (Array.isArray(c)) return c;
    const i = palIndex(c);
    if (i >= 0) return this.palRgb(i);
    return FX.hexToRgb(isHex(c) ? c : '#ffffff');
  }
  // Presets, including the three built-in palette presets 'pal:1'..'pal:3' (always there)
  getPreset(pid) {
    const i = palIndex(pid);
    if (i >= 0 && String(pid).startsWith('pal:')) return { id: pid, kind: 'color', name: PAL_NAMES[i], palette: i };
    return this.show.presets.find((x) => x.id === pid);
  }

  presetValue(preset, fid, attr) {
    if (preset.palette !== undefined) {
      const fx = this.fixtureMap.get(fid);
      if (!fx || !fx.prof.colorAttrs.length) return undefined;
      return colorValues(fx.prof, this.palRgb(preset.palette))[attr];
    }
    const own = preset.values && preset.values[fid];
    if (own && attr in own) return own[attr];
    return preset.universal ? preset.universal[attr] : undefined;
  }

  // refs: { fixtureId: { attr: presetId } } -> use the preset's current value
  applyRefs(look, refs) {
    for (const [fid, attrs] of Object.entries(refs || {})) {
      if (!look[fid]) continue;
      for (const [a, pid] of Object.entries(attrs)) {
        const preset = this.getPreset(pid);
        const v = preset && this.presetValue(preset, fid, a);
        if (v !== undefined && a in look[fid]) look[fid][a] = v;
      }
    }
  }

  applyPresetTo(look, preset, fids) {
    for (const fid of fids) {
      const cur = look[fid];
      if (!cur) continue;
      for (const a of Object.keys(cur)) {
        if (!PRESET_ATTRS[preset.kind](a)) continue;
        const v = this.presetValue(preset, fid, a);
        if (v !== undefined) cur[a] = v;
      }
    }
  }

  cueLayer(now) {
    const target = this.baseTarget();
    const f = this.cueFade;
    if (!f) return target;
    const elapsed = now - f.start;
    if (elapsed >= f.dur) {
      this.cueFade = null;
      return target;
    }
    const kAll = ease(f.base > 0 ? clamp01(elapsed / f.base) : 1);
    for (const [fid, vals] of Object.entries(target)) {
      const from = f.from[fid];
      if (!from) continue;
      let k = kAll;
      const tm = f.timing && f.timing[fid];
      if (tm) {
        const local = elapsed - (tm.delay || 0) * 1000;
        const fadeMs = tm.fade === undefined ? f.base : tm.fade * 1000;
        k = local <= 0 ? 0 : fadeMs > 0 ? ease(clamp01(local / fadeMs)) : 1;
      }
      for (const a of Object.keys(vals)) if (a in from) vals[a] = lerp(from[a], vals[a], k);
    }
    return target;
  }

  baseSource() {
    return this.rt.base.kind === 'look' ? this.show.looks.find((x) => x.id === this.rt.base.lookId) : this.show.cues[this.rt.cueIndex];
  }

  updateSceneFades(now) {
    for (const [id, f] of Object.entries(this.sceneFades)) {
      const t = f.dur > 0 ? clamp01((now - f.start) / f.dur) : 1;
      this.setSceneLevel(id, lerp(f.from, f.to, ease(t)), true);
      if (t >= 1) delete this.sceneFades[id];
    }
  }

  // Full look before grand master / blackout.
  // opts.live = false leaves out live trims (group faders, effects, flash), e.g. when recording.
  computeLook(now = Date.now(), opts = {}) {
    const live = opts.live !== false;
    this.updateSceneFades(now);
    const look = this.cueLayer(now);
    const active = this.show.scenes
      .filter((s) => (this.rt.sceneLevels[s.id] || 0) > 0)
      .sort((a, b) => (this.rt.sceneOrder[a.id] || 0) - (this.rt.sceneOrder[b.id] || 0));
    for (const s of active) {
      const level = this.rt.sceneLevels[s.id];
      for (const [fid, vals] of Object.entries(s.values || {})) {
        const cur = look[fid];
        if (!cur) continue;
        for (const [a, v] of Object.entries(vals)) {
          if (!(a in cur)) continue;
          cur[a] = a === 'dim' ? Math.max(cur[a], v * level) : lerp(cur[a], v, level);
        }
      }
    }
    // Presets switched on from pads (recorded like live colours).
    for (const lp of Object.values(this.rt.livePresets)) {
      const preset = this.getPreset(lp.presetId);
      if (preset) this.applyPresetTo(look, preset, this.fixturesOf(lp));
    }
    // Live group colours are part of the look (they get recorded).
    for (const g of this.show.groups) {
      const b = this.rt.busk[g.id];
      if (!b || !b.color) continue;
      for (const fid of g.fixtures) {
        const fx = this.fixtureMap.get(fid);
        if (fx && look[fid]) Object.assign(look[fid], colorValues(fx.prof, this.colorRgb(b.color)));
      }
    }
    for (const [fid, vals] of Object.entries(this.programmer)) {
      const cur = look[fid];
      if (!cur) continue;
      for (const [a, v] of Object.entries(vals)) if (a in cur) cur[a] = v;
    }
    // Values applied from presets stay linked while editing (e.g. change Primary -> the lights follow).
    this.applyRefs(look, this.progRefs);
    // Live effects and group faders work on top of everything, including the programmer.
    if (live) this.applyEffects(look, now);
    if (live) this.applyGroupLevels(look);
    if (live) {
      const full = (fids) => { for (const fid of fids) if (look[fid] && 'dim' in look[fid]) look[fid].dim = 1; };
      for (const g of this.show.groups) {
        const b = this.rt.busk[g.id];
        if (b && b.flash) full(g.fixtures);
      }
      for (const pf of Object.values(this.rt.padFlash)) full(this.fixturesOf(pf));
      if (this.rt.flashAll) full(Object.keys(look));
      // Screen protection: lights that would shine on a projector screen or LED wall
      const mode = this.show.settings.screenProtect || 'warn';
      this.blocked = mode === 'off' ? new Set() : this.screenHits(look);
      if (mode === 'block') for (const fid of this.blocked) look[fid].dim = 0;
    }
    return look;
  }

  // ----- live layer: effects and group faders --------------------------------
  effectById(id) {
    return FX.BUILTIN.find((e) => e.id === id) || this.show.effects.find((e) => e.id === id);
  }

  fixturesOf(inst) {
    if (inst.groupId) {
      const g = this.show.groups.find((x) => x.id === inst.groupId);
      return g ? g.fixtures : [];
    }
    if (Array.isArray(inst.fixtures)) return inst.fixtures;
    return this.show.fixtures.map((f) => f.id); // "all"
  }

  // Every effect that should run now, in order (later ones win on the same attribute).
  activeEffects() {
    const out = new Map();
    const base = this.rt.base.kind === 'look' ? this.show.looks.find((x) => x.id === this.rt.base.lookId) : this.show.cues[this.rt.cueIndex];
    ((base && base.effects) || []).forEach((e, i) => {
      const effectId = e.effectId || e.type;
      out.set(e.groupId ? `g:${e.groupId}` : `stored:${i}`, { ...e, effectId });
    });
    for (const [gid, b] of Object.entries(this.rt.busk)) {
      if (b.fx === 'off') out.delete(`g:${gid}`);
      else if (b.fx) out.set(`g:${gid}`, { groupId: gid, effectId: b.fx.type, rate: b.fx.rate || 1, size: 1 });
    }
    for (const [key, inst] of Object.entries(this.rt.running)) out.set(`run:${key}`, inst);
    if (this.rt.strobe) out.set('strobe', { effectId: 'strobe', groupId: this.rt.strobe === true ? null : this.rt.strobe, rate: 1, size: 1 });
    return [...out.values()];
  }

  applyEffects(look, now) {
    const list = this.activeEffects();
    if (!list.length) return;
    const beats = (now - this.rt.beatT0) / (60000 / this.rt.bpm);
    const seconds = now / 1000;
    for (const inst of list) {
      const fx = this.effectById(inst.effectId);
      if (!fx) continue;
      let members = this.fixturesOf(inst).filter((fid) => look[fid]);
      const t = inst.tricks;
      let steps = null;
      if (t && this.tricksUsed(t)) {
        const lay = this.trickLayout(members, t);
        members = lay.map((x) => x.fid);
        steps = lay;
      }
      const n = members.length;
      if (!n) continue;
      const size = inst.size ?? 1;
      const cycles = FX.cyclesAt(fx, beats, seconds, inst.rate || 1);
      members.forEach((fid, i) => {
        const v = look[fid];
        const prof = this.fixtureMap.get(fid).prof;
        let ov;
        if (steps) {
          const { k, m } = steps[i];
          const item = steps[i];
          const pFrom = FX.hasValue(t.phaseFrom) || FX.hasValue(t.phaseTo) ? t.phaseFrom : fx.phaseFrom;
          const pTo = FX.hasValue(t.phaseFrom) || FX.hasValue(t.phaseTo) ? t.phaseTo : fx.phaseTo;
          const a = FX.hasValue(pFrom) ? Number(pFrom) : FX.hasValue(pTo) ? Number(pTo) : 0;
          const b = FX.hasValue(pTo) ? Number(pTo) : a;
          const full = b - a !== 0 && Math.abs(b - a) % 360 === 0;
          ov = { phase: this.spreadFor(a, b, item, full) / 360, slots: m, speed: this.spreadFor(t.speedFrom, t.speedTo, item) || undefined };
        }
        for (const { layer, w, value } of FX.evaluate(fx, i, n, cycles, ov)) {
          const a = layer.attr;
          if (a === 'hue' || a === 'color' || a === 'palette') {
            if (!prof.colorAttrs.length) continue;
            let rgb;
            if (a === 'hue') rgb = FX.hsvToRgb(((value % 1) + 1) % 1, 1, 1);
            else if (a === 'palette') {
              const x = ((value % 1) + 1) % 1 * 3;
              const i0 = Math.floor(x) % 3;
              const c0 = this.palRgb(i0), c1 = this.palRgb((i0 + 1) % 3);
              rgb = layer.smooth ? c0.map((c, k) => lerp(c, c1[k], x - Math.floor(x))) : c0;
            } else {
              const ca = this.colorRgb(layer.colorA), cb = this.colorRgb(layer.colorB);
              rgb = ca.map((c, k) => lerp(c, cb[k], w));
            }
            for (const [ca, cv] of Object.entries(colorValues(prof, rgb))) v[ca] = lerp(v[ca] ?? 0, cv, size);
            continue;
          }
          if (!(a in v)) continue;
          if (layer.mode === 'scale') v[a] *= lerp(1, value, size);
          else if (layer.mode === 'rel') v[a] = clamp01(v[a] + (w - 0.5) * ((layer.high ?? 1) - (layer.low ?? 0)) * size);
          else v[a] = lerp(v[a], value, size);
        }
      });
    }
  }

  applyGroupLevels(look) {
    for (const g of this.show.groups) {
      const b = this.rt.busk[g.id];
      if (!b || b.level >= 1) continue;
      for (const fid of g.fixtures) if (look[fid] && 'dim' in look[fid]) look[fid].dim *= b.level;
    }
  }

  // Effects saved with a cue or look: what is running now, except momentary ones.
  captureEffects() {
    const out = [];
    for (const [gid, b] of Object.entries(this.rt.busk)) if (b.fx && b.fx !== 'off') out.push({ groupId: gid, effectId: b.fx.type, rate: b.fx.rate || 1, size: 1 });
    for (const inst of Object.values(this.rt.running)) {
      if (inst.hold) continue;
      const e = { effectId: inst.effectId, rate: inst.rate || 1, size: inst.size ?? 1 };
      if (inst.tricks) e.tricks = { ...inst.tricks };
      if (inst.groupId) e.groupId = inst.groupId;
      else if (inst.fixtures) e.fixtures = [...inst.fixtures];
      out.push(e);
    }
    // Keep effects of the current cue/look that were not switched off live.
    const base = this.rt.base.kind === 'look' ? this.show.looks.find((x) => x.id === this.rt.base.lookId) : this.show.cues[this.rt.cueIndex];
    for (const e of (base && base.effects) || []) {
      if (e.groupId && (this.rt.busk[e.groupId] || {}).fx) continue;
      if (!out.some((o) => o.groupId && o.groupId === e.groupId)) out.push({ ...e, effectId: e.effectId || e.type });
    }
    return out;
  }

  padOn(pad, hold) {
    const target = pad.groupId ? { groupId: pad.groupId } : {};
    if (pad.kind === 'effect') this.rt.running[pad.id] = { effectId: pad.effectId, rate: pad.rate || 1, size: 1, hold, ...target };
    else if (pad.kind === 'preset') this.rt.livePresets[pad.id] = { presetId: pad.presetId, ...target };
    else if (pad.kind === 'flash') this.rt.padFlash[pad.id] = { ...target };
    this.rt.padsOn[pad.id] = true;
  }

  padOff(id) {
    delete this.rt.running[id];
    delete this.rt.livePresets[id];
    delete this.rt.padFlash[id];
    delete this.rt.padsOn[id];
  }

  // Screen colour -> live colour of the chosen light groups (all groups if none chosen)
  applyScreenColor(rgb) {
    if (!rgb || rgb.length < 3) return;
    if ((this.show.settings.pp.colorTarget || 'primary') === 'primary') {
      this.rt.paletteLive[0] = rgbToHex(rgb);
      return;
    }
    const ids = this.show.settings.pp.colorGroups.length ? this.show.settings.pp.colorGroups : this.show.groups.map((g) => g.id);
    for (const gid of ids) if (this.show.groups.some((g) => g.id === gid)) this.buskFor(gid).color = rgb.map((v) => round4(clamp01(v)));
  }

  buskFor(gid) {
    return (this.rt.busk[gid] ||= { level: 1, color: null, fx: null, flash: false });
  }

  // ----- DMX rendering ----------------------------------------------------
  render(look) {
    const universes = new Map();
    const master = this.rt.blackout ? 0 : this.rt.gm;
    for (const [fid, { fixture, prof }] of this.fixtureMap) {
      const vals = look[fid];
      if (!vals) continue;
      let data = universes.get(fixture.universe);
      if (!data) universes.set(fixture.universe, (data = new Uint8Array(512)));
      const dimEff = clamp01((vals.dim ?? 0) * master);
      prof.channels.forEach((ch, i) => {
        const idx = fixture.address - 1 + i;
        if (idx < 0 || idx >= 512) return;
        if (ch.fixed !== undefined) {
          data[idx] = ch.fixed;
          return;
        }
        let v;
        if (ch.attr === 'dim') v = dimEff;
        else if (!prof.hasDimChannel && prof.colorAttrs.includes(ch.attr)) v = (vals[ch.attr] ?? 0) * dimEff;
        else v = vals[ch.attr] ?? 0;
        v = clamp01(v);
        if (prof.fineAttrs.has(ch.attr)) {
          const v16 = Math.round(v * 65535);
          data[idx] = ch.fine ? v16 & 0xff : v16 >> 8;
        } else {
          data[idx] = Math.round(v * 255);
        }
      });
    }
    return universes;
  }

  liveState(look) {
    const master = this.rt.blackout ? 0 : this.rt.gm;
    const fixtures = {};
    for (const [fid, { prof }] of this.fixtureMap) {
      const vals = look[fid];
      const c = displayColor({ ...vals, dim: (vals.dim ?? 0) * master }, prof);
      const o = { c, d: round4((vals.dim ?? 0) * master) };
      if ('pan' in vals) o.p = round4(vals.pan);
      if ('tilt' in vals) o.t = round4(vals.tilt);
      if ('zoom' in vals) o.z = round4(vals.zoom);
      if (this.blocked && this.blocked.has(fid)) o.x = 1; // would hit a screen
      fixtures[fid] = o;
    }
    const now = Date.now();
    const f = this.cueFade;
    return {
      fixtures,
      cueProgress: f && f.dur > 0 ? clamp01((now - f.start) / f.dur) : 1,
      sceneLevels: Object.fromEntries(Object.entries(this.rt.sceneLevels).map(([k, v]) => [k, round4(v)])),
      beat: round4((((Date.now() - this.rt.beatT0) / (60000 / this.rt.bpm)) % 1 + 1) % 1),
    };
  }

  runtimeState() {
    return {
      cueIndex: this.rt.cueIndex,
      base: this.rt.base,
      songId: this.rt.songId,
      sectionId: this.rt.sectionId,
      mode: this.rt.mode,
      hold: this.rt.hold,
      learn: this.rt.learn,
      lastMidi: this.rt.lastMidi,
      busk: this.rt.busk,
      running: this.rt.running,
      padsOn: this.rt.padsOn,
      strobe: this.rt.strobe,
      flashAll: this.rt.flashAll,
      progRefs: this.progRefs,
      tricks: this.rt.tricks,
      transport: this.rt.transport,
      playhead: this.rt.playhead,
      audioHost: this.rt.audioHost,
      vocal: this.rt.vocal,
      pp: this.rt.pp,
      palette: this.paletteNow(),
      paletteSource: this.paletteSource(),
      paletteLive: this.rt.paletteLive,
      lastOsc: this.rt.lastOsc,
      bpm: Math.round(this.rt.bpm * 10) / 10,
      clock: this.rt.clock,
      gm: this.rt.gm,
      blackout: this.rt.blackout,
      programmer: this.programmer,
      sceneLevels: this.rt.sceneLevels,
    };
  }

  persistentRuntime() {
    const { cueIndex, gm, sceneLevels, base, songId, sectionId, mode, bpm, tricks, vocal } = this.rt; // kept between restarts
    const busk = Object.fromEntries(Object.entries(this.rt.busk).map(([k, b]) => [k, { level: b.level, color: b.color, fx: b.fx }]));
    return { cueIndex, gm, sceneLevels, base, songId, sectionId, mode, busk, bpm, tricks, vocal };
  }

  // ----- helpers for actions ----------------------------------------------
  setSceneLevel(id, level, fromFade = false) {
    level = clamp01(level);
    const prev = this.rt.sceneLevels[id] || 0;
    if (prev === 0 && level > 0) this.rt.sceneOrder[id] = (this.orderCounter = (this.orderCounter || 0) + 1);
    if (level === 0) delete this.rt.sceneLevels[id];
    else this.rt.sceneLevels[id] = level;
    if (!fromFade) delete this.sceneFades[id];
  }

  setBase(base, fadeSec, from = this.cueLayer(Date.now())) {
    const now = Date.now();
    this.rt.base = base;
    // Per-light fade/delay (from selection tricks) stretch the fade if needed.
    const src = this.baseSource();
    const timing = (src && src.timing) || null;
    let dur = Math.max(0, fadeSec || 0) * 1000;
    if (timing) for (const tm of Object.values(timing)) dur = Math.max(dur, ((tm.delay || 0) + (tm.fade ?? fadeSec ?? 0)) * 1000);
    this.cueFade = dur > 0 ? { from, start: now, dur, base: Math.max(0, fadeSec || 0) * 1000, timing } : null;
  }

  // ----- selection tricks ------------------------------------------------------
  // 3D position (the same defaults the 3D view uses for lights not placed yet).
  stagePos(fid) {
    const fx = this.fixtureMap.get(fid);
    if (!fx) return { x: 0, y: 0, z: 0 };
    return Geom.placement(fx.fixture, this.show.stage3d.stage).pos;
  }

  // Spread value From -> To for a light in a trick layout (by step, or by real distance).
  spreadFor(from, to, item, full = false) {
    if (item.f === undefined) return FX.spread(from, to, item.k, item.m, full);
    if (!FX.hasValue(from) && !FX.hasValue(to)) return null;
    const a = FX.hasValue(from) ? Number(from) : Number(to);
    const b = FX.hasValue(to) ? Number(to) : Number(from);
    const f = full && item.m > 1 ? item.f * (item.m - 1) / item.m : item.f;
    return a + (b - a) * f;
  }

  // ----- screens: lights must not shine on projector screens / LED walls ------------------
  beamAngle(fx, vals) {
    return fx.prof.attrs.includes('zoom') ? 8 + 42 * (vals.zoom ?? 0.5) : fx.fixture.beam || 25;
  }

  // Lights whose beam would land on a protected screen, given the current look.
  screenHits(look) {
    const screens = (this.show.stage3d.screens || []).filter((x) => x.protect !== false);
    const hits = new Set();
    if (!screens.length) return hits;
    const stage = this.show.stage3d.stage;
    for (const [fid, fx] of this.fixtureMap) {
      const v = look[fid];
      if (!v || !('dim' in v) || v.dim <= 0.001) continue;
      const { pos, aim } = Geom.placement(fx.fixture, stage);
      const mover = fx.prof.attrs.includes('pan') || fx.prof.attrs.includes('tilt');
      const dir = Geom.beamDir(pos, aim, mover, v.pan ?? 0.5, v.tilt ?? 0.5);
      const angle = this.beamAngle(fx, v);
      if (screens.some((sc) => Geom.beamHitsScreen(pos, dir, angle, sc).hit)) hits.add(fid);
    }
    return hits;
  }

  tricksUsed(t = this.rt.tricks) {
    return !!t && t.active !== false && Object.entries(t).some(([k, v]) => k !== 'active' && (k === 'order' ? v && v !== 'tap' : FX.hasValue(v)));
  }

  // Lights in trick order with their step: [{ fid, k, m }]
  trickLayout(ids, t = this.rt.tricks) {
    const list = ids.filter((id) => this.fixtureMap.has(id));
    if (!this.tricksUsed(t)) return list.map((fid, i) => ({ fid, k: i, m: list.length }));
    const posOf = (id) => this.stagePos(id);
    const ordered = FX.trickOrder(list, t, posOf);
    const steps = FX.trickSteps(ordered.length, t);
    const fr = FX.trickFractions(ordered, t, posOf);
    return ordered.map((fid, i) => ({ fid, ...steps[i], ...(fr ? { f: fr[i] } : {}) }));
  }

  // Per-light fade/delay for a recorded cue or look, or null.
  captureTiming(fixtures) {
    const t = this.rt.tricks;
    if (!this.tricksUsed(t) || !Array.isArray(fixtures)) return null;
    const anyTime = ['fadeFrom', 'fadeTo', 'delayFrom', 'delayTo'].some((k) => FX.hasValue(t[k]));
    if (!anyTime) return null;
    const timing = {};
    for (const item of this.trickLayout(fixtures)) {
      const { fid } = item;
      const fade = this.spreadFor(t.fadeFrom, t.fadeTo, item);
      const delay = this.spreadFor(t.delayFrom, t.delayTo, item);
      timing[fid] = { fade: round4(Math.max(0, fade ?? 0)), delay: round4(Math.max(0, delay ?? 0)) };
      if (fade === null) delete timing[fid].fade;
    }
    return Object.keys(timing).length ? timing : null;
  }

  gotoCue(index, fadeSec) {
    const from = this.cueLayer(Date.now());
    this.rt.cueIndex = index;
    const cue = this.show.cues[index];
    this.setBase({ kind: 'cue' }, fadeSec ?? (cue ? cue.fade : 2), from);
  }

  // ----- songs ------------------------------------------------------------
  song(id) {
    return this.show.songs.find((x) => x.id === id);
  }

  goSection(song, section) {
    this.rt.songId = song.id;
    this.rt.sectionId = section.id;
    const look = section.lookId && this.show.looks.find((l) => l.id === section.lookId);
    // A section without a look just marks the position and leaves the lights alone.
    if (look) this.setBase({ kind: 'look', lookId: look.id }, section.fade ?? 1);
  }

  // Pick a look whose name matches a section name ("Verse 2" -> "Verse").
  guessLook(name) {
    const n = String(name).toLowerCase().replace(/\s*\d+$/, '').trim();
    const looks = this.show.looks;
    return (looks.find((l) => l.name.toLowerCase() === n) || looks.find((l) => l.name.toLowerCase().startsWith(n)) || {}).id || null;
  }

  // ----- MIDI ---------------------------------------------------------------
  // Returns null for messages we ignore (clock, note off, ...), so they are not broadcast.
  handleMidi(bytes) {
    const [status, d1 = 0, d2 = 0] = bytes;
    const kind = status & 0xf0;
    const ch = (status & 0x0f) + 1;
    let msg = null;
    if (kind === 0x90 && d2 > 0) msg = { t: 'note', ch, n: d1 };
    else if (kind === 0xb0 && d2 > 0) msg = { t: 'cc', ch, n: d1 };
    else if (kind === 0xc0) msg = { t: 'pc', ch, n: d1 };
    if (!msg) return null;
    this.rt.lastMidi = { ...msg, at: Date.now(), result: '' };
    const res = (text, show = false) => {
      this.rt.lastMidi.result = text;
      return { show };
    };
    const filter = this.show.settings.midiChannel;
    if (filter && ch !== filter) return res(`ignored (listening on channel ${filter} only)`);

    if (this.rt.learn) {
      const L = this.rt.learn;
      this.rt.learn = null;
      const song = this.song(L.songId);
      const target = L.sectionId ? song && song.sections.find((x) => x.id === L.sectionId) : song;
      if (!target) return res('learn target is gone');
      target.trigger = { t: msg.t, ch: msg.ch, n: msg.n };
      return res(`learned for ${target.name}`, true);
    }
    if (this.rt.hold) return res('ignored (Hold is on)');

    const same = (tr) => tr && tr.t === msg.t && tr.ch === msg.ch && tr.n === msg.n;
    const songs = this.show.songs;
    // 1. Song select
    let song = songs.find((s) => same(s.trigger));
    if (!song && msg.t === 'pc' && this.show.settings.pcSelectsSong && !songs.some((s) => s.trigger && s.trigger.t === 'pc')) song = songs[msg.n];
    if (song) {
      if (song.id !== this.rt.songId) {
        this.rt.songId = song.id;
        this.rt.sectionId = null;
        if (song.bpm && !this.rt.clock) this.rt.bpm = song.bpm;
      }
      return res(`song: ${song.name}`);
    }
    // 2. Section trigger: current song first, then any song
    const cur = this.song(this.rt.songId);
    let hit = null;
    if (cur) {
      const sec = cur.sections.find((x) => same(x.trigger));
      if (sec) hit = [cur, sec];
    }
    if (!hit) {
      for (const s of songs) {
        const sec = s.sections.find((x) => same(x.trigger));
        if (sec) { hit = [s, sec]; break; }
      }
    }
    // 3. Default note map: note (base + i) = section i of the current song
    if (!hit && cur && msg.t === 'note') {
      const i = msg.n - (this.show.settings.noteBase ?? 36);
      if (i >= 0 && i < cur.sections.length) hit = [cur, cur.sections[i]];
    }
    if (!hit) return res('no match');
    if (this.rt.mode === 'manual') return res(`${hit[1].name} (ignored: Manual mode)`);
    this.goSection(hit[0], hit[1]);
    return res(`${hit[0].name} · ${hit[1].name}`);
  }

  // Capture what is on stage (before grand master) as compact cue values.
  // Preset references to keep: from the programmer, and from the current cue/look where unchanged.
  captureRefs(look) {
    const refs = {};
    const add = (fid, a, pid) => {
      const preset = this.getPreset(pid);
      if (!preset || !look[fid]) return;
      const v = this.presetValue(preset, fid, a);
      if (v !== undefined && Math.abs(v - look[fid][a]) < 0.0005) (refs[fid] ||= {})[a] = pid;
    };
    for (const [fid, attrs] of Object.entries(this.baseRefs())) {
      if (this.programmer[fid]) continue;
      for (const [a, pid] of Object.entries(attrs)) add(fid, a, pid);
    }
    for (const [fid, attrs] of Object.entries(this.progRefs)) for (const [a, pid] of Object.entries(attrs)) add(fid, a, pid);
    return refs;
  }

  captureStage() {
    const look = this.computeLook(Date.now(), { live: false });
    const values = {};
    for (const [fid, { prof }] of this.fixtureMap) {
      const diff = {};
      for (const [a, v] of Object.entries(look[fid])) if (Math.abs(v - prof.defaults[a]) > 0.0005) diff[a] = round4(v);
      if (Object.keys(diff).length) values[fid] = diff;
    }
    return values;
  }

  colorFor(values) {
    // Average display colour of a set of values, used to tint scene buttons.
    let r = 0, g = 0, b = 0, n = 0;
    for (const [fid, vals] of Object.entries(values)) {
      const fx = this.fixtureMap.get(fid);
      if (!fx) continue;
      const c = displayColor({ ...fx.prof.defaults, ...vals, dim: 1 }, fx.prof);
      r += c[0]; g += c[1]; b += c[2]; n++;
    }
    if (!n) return '#8899aa';
    const hex = (v) => Math.round(v / n).toString(16).padStart(2, '0');
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  }

  findIndex(list, id) {
    const i = list.findIndex((x) => x.id === id);
    if (i < 0) throw new Error('Not found');
    return i;
  }

  validatePatch(f, prof) {
    if (!Number.isInteger(f.universe) || f.universe < 1 || f.universe > 63999) throw new Error('Universe must be 1 to 63999');
    if (!Number.isInteger(f.address) || f.address < 1) throw new Error('Address must be 1 to 512');
    if (f.address + prof.footprint - 1 > 512) throw new Error(`${f.name}: address ${f.address} + ${prof.footprint} channels runs past 512`);
  }

  nextFreeAddress(universe, footprint) {
    const used = new Uint8Array(513);
    for (const { fixture, prof } of this.fixtureMap.values()) {
      if (fixture.universe !== universe) continue;
      for (let i = 0; i < prof.footprint; i++) used[fixture.address + i] = 1;
    }
    for (let a = 1; a + footprint - 1 <= 512; a++) {
      let ok = true;
      for (let i = 0; i < footprint; i++) if (used[a + i]) { ok = false; break; }
      if (ok) return a;
    }
    return null;
  }

  // ----- actions ----------------------------------------------------------
  // Returns { show: bool, runtime: bool } describing what changed.
  dispatch(action) {
    const fn = ACTIONS[action && action.type];
    if (!fn) throw new Error(`Unknown action ${action && action.type}`);
    const res = fn.call(this, action) || {};
    if (res.show) this.compile();
    return { show: !!res.show, runtime: res.runtime !== false };
  }
}

const num = (v, name) => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number`);
  return n;
};
const ids = (a) => (Array.isArray(a.fixtures) ? a.fixtures : []);

const ACTIONS = {
  // Programmer
  'prog.set'(a) {
    for (const fid of ids(a)) {
      const fx = this.fixtureMap.get(fid);
      if (!fx) continue;
      const p = (this.programmer[fid] ||= {});
      for (const [attr, v] of Object.entries(a.values || {})) {
        if (!fx.prof.attrs.includes(attr)) continue;
        p[attr] = clamp01(num(v, attr));
        if (this.progRefs[fid]) delete this.progRefs[fid][attr];
      }
    }
  },
  'prog.color'(a) {
    const [r, g, b] = (a.rgb || []).map((v) => clamp01(num(v, 'colour')));
    for (const fid of ids(a)) {
      const fx = this.fixtureMap.get(fid);
      if (!fx || !fx.prof.colorAttrs.length) continue;
      const cv = colorValues(fx.prof, [r, g, b]);
      Object.assign((this.programmer[fid] ||= {}), cv);
      if (this.progRefs[fid]) for (const k of Object.keys(cv)) delete this.progRefs[fid][k];
    }
  },
  // Spread a value From -> To over the lights, following the selection tricks.
  'prog.fan'(a) {
    const attr = String(a.attr || 'dim');
    const from = clamp01(num(a.from, 'From')), to = clamp01(num(a.to, 'To'));
    for (const item of this.trickLayout(ids(a))) {
      const { fid } = item;
      const fx = this.fixtureMap.get(fid);
      if (!fx.prof.attrs.includes(attr)) continue;
      (this.programmer[fid] ||= {})[attr] = round4(this.spreadFor(from, to, item));
      if (this.progRefs[fid]) delete this.progRefs[fid][attr];
    }
  },
  'tricks.set'(a) {
    const t = this.rt.tricks;
    const p = a.tricks || {};
    const lim = { shift: [-512, 512], shuffle: [0, 1e6], block: [1, 512], groups: [1, 512], wings: [1, 64], width: [1, 512], part: [0, 512],
      turn: [-360, 360], tilt: [-90, 90],
      phaseFrom: [-3600, 3600], phaseTo: [-3600, 3600], speedFrom: [0.125, 16], speedTo: [0.125, 16],
      fadeFrom: [0, 600], fadeTo: [0, 600], delayFrom: [0, 600], delayTo: [0, 600] };
    for (const [k, v] of Object.entries(p)) {
      if (k === 'active') t.active = !!v;
      else if (k === 'order') t.order = ['tap', 'left-right', 'right-left', 'front-back', 'back-front', 'low-high', 'high-low', 'centre-out', 'outside-in', 'direction'].includes(v) ? v : 'tap';
      else if (k === 'spatial') t.spatial = !!v;
      else if (lim[k]) {
        if (v === null || v === '' || v === undefined) delete t[k];
        else t[k] = Math.max(lim[k][0], Math.min(lim[k][1], num(v, k)));
      }
    }
  },
  'tricks.reset'() {
    this.rt.tricks = { active: true };
  },
  'tricks.shuffle'() {
    this.rt.tricks.shuffle = 1 + Math.floor(Math.random() * 999999);
  },
  // Step through the parts made by Width: dir +1 / -1, n = number of selected lights.
  'tricks.part'(a) {
    const t = this.rt.tricks;
    if (!FX.hasValue(t.width)) throw new Error('Set a Width first');
    const parts = Math.ceil(Math.max(1, num(a.n, 'Count')) / t.width);
    const cur = Number(t.part) || 0;
    if (a.all) t.part = 0;
    else if (!cur) t.part = a.dir < 0 ? parts : 1;
    else t.part = ((cur - 1 + (a.dir < 0 ? -1 : 1) + parts) % parts) + 1;
  },
  'prog.locate'(a) {
    for (const fid of ids(a)) {
      const fx = this.fixtureMap.get(fid);
      if (!fx) continue;
      this.programmer[fid] = { ...fx.prof.defaults, dim: 1 };
      if ('haze' in fx.prof.defaults) this.programmer[fid].haze = 0;
    }
  },
  'prog.clear'(a) {
    if (Array.isArray(a.fixtures)) for (const fid of a.fixtures) { delete this.programmer[fid]; delete this.progRefs[fid]; }
    else { this.programmer = {}; this.progRefs = {}; }
  },

  // Cue list
  'cue.go'() {
    if (this.rt.cueIndex < this.show.cues.length - 1) this.gotoCue(this.rt.cueIndex + 1);
  },
  'cue.back'() {
    if (this.rt.cueIndex >= 0) this.gotoCue(this.rt.cueIndex - 1, Math.min(2, (this.show.cues[this.rt.cueIndex - 1] || {}).fade ?? 2));
  },
  'cue.goto'(a) {
    const i = this.findIndex(this.show.cues, a.id);
    this.gotoCue(i, a.fade);
  },
  'cue.release'() {
    this.gotoCue(-1, 3);
  },
  'cue.record'(a) {
    const cue = { id: uid(), name: String(a.name || '').trim() || `Cue ${this.show.cues.length + 1}`, fade: 3, notes: '', timing: this.captureTiming(a.fixtures), refs: this.captureRefs(this.computeLook(Date.now(), { live: false })), values: this.captureStage(), effects: this.captureEffects() };
    const at = this.rt.cueIndex + 1;
    this.show.cues.splice(at, 0, cue);
    this.rt.cueIndex = at;
    this.rt.base = { kind: 'cue' };
    this.cueFade = null;
    this.programmer = {};
    this.progRefs = {};
    this.progRefs = {};
    return { show: true };
  },
  'cue.update'(a) {
    const cue = this.show.cues[this.rt.cueIndex];
    if (!cue) throw new Error('No current cue to update');
    if (a.fixtures) cue.timing = this.captureTiming(a.fixtures);
    cue.refs = this.captureRefs(this.computeLook(Date.now(), { live: false }));
    cue.values = this.captureStage();
    cue.effects = this.captureEffects();
    this.rt.base = { kind: 'cue' };
    this.cueFade = null;
    this.programmer = {};
    this.progRefs = {};
    this.progRefs = {};
    return { show: true };
  },
  'cue.edit'(a) {
    const cue = this.show.cues[this.findIndex(this.show.cues, a.id)];
    if (a.name !== undefined) cue.name = String(a.name).slice(0, 80);
    if (a.notes !== undefined) cue.notes = String(a.notes).slice(0, 500);
    if (a.fade !== undefined) cue.fade = Math.max(0, Math.min(600, num(a.fade, 'Fade')));
    return { show: true };
  },
  'cue.delete'(a) {
    const i = this.findIndex(this.show.cues, a.id);
    this.show.cues.splice(i, 1);
    if (this.rt.cueIndex > i) this.rt.cueIndex--;
    else if (this.rt.cueIndex === i) {
      this.rt.cueIndex = Math.min(i, this.show.cues.length - 1);
      this.cueFade = null;
    }
    return { show: true };
  },
  'cue.move'(a) {
    const i = this.findIndex(this.show.cues, a.id);
    const j = i + (a.dir < 0 ? -1 : 1);
    if (j < 0 || j >= this.show.cues.length) return;
    const cues = this.show.cues;
    [cues[i], cues[j]] = [cues[j], cues[i]];
    if (this.rt.cueIndex === i) this.rt.cueIndex = j;
    else if (this.rt.cueIndex === j) this.rt.cueIndex = i;
    return { show: true };
  },

  // Scenes
  'scene.record'(a) {
    if (!Object.keys(this.programmer).length) throw new Error('Set some lights first, then save them as a scene');
    const values = JSON.parse(JSON.stringify(this.programmer));
    const scene = { id: uid(), name: String(a.name || '').trim() || `Scene ${this.show.scenes.length + 1}`, fade: 2, color: this.colorFor(values), values };
    this.show.scenes.push(scene);
    this.programmer = {};
    this.setSceneLevel(scene.id, 1);
    return { show: true };
  },
  'scene.update'(a) {
    const s = this.show.scenes[this.findIndex(this.show.scenes, a.id)];
    if (!Object.keys(this.programmer).length) throw new Error('The programmer is empty');
    s.values = JSON.parse(JSON.stringify(this.programmer));
    s.color = this.colorFor(s.values);
    this.programmer = {};
    this.setSceneLevel(s.id, 1);
    return { show: true };
  },
  'scene.toggle'(a) {
    const s = this.show.scenes[this.findIndex(this.show.scenes, a.id)];
    const cur = this.rt.sceneLevels[s.id] || 0;
    const fading = this.sceneFades[s.id];
    const to = fading ? (fading.to > 0 ? 0 : 1) : cur > 0 ? 0 : 1;
    if (to > 0 && cur === 0) this.setSceneLevel(s.id, 0.0001);
    this.sceneFades[s.id] = { from: Math.max(cur, to > 0 ? 0.0001 : 0), to, start: Date.now(), dur: (s.fade || 0) * 1000 };
  },
  'scene.level'(a) {
    this.findIndex(this.show.scenes, a.id);
    this.setSceneLevel(a.id, num(a.level, 'Level'));
  },
  'scene.releaseAll'() {
    const now = Date.now();
    for (const s of this.show.scenes) {
      const cur = this.rt.sceneLevels[s.id] || 0;
      if (cur > 0) this.sceneFades[s.id] = { from: cur, to: 0, start: now, dur: 2000 };
    }
  },
  'scene.edit'(a) {
    const s = this.show.scenes[this.findIndex(this.show.scenes, a.id)];
    if (a.name !== undefined) s.name = String(a.name).slice(0, 60);
    if (a.fade !== undefined) s.fade = Math.max(0, Math.min(600, num(a.fade, 'Fade')));
    if (a.color !== undefined && /^#[0-9a-f]{6}$/i.test(a.color)) s.color = a.color;
    return { show: true };
  },
  'scene.delete'(a) {
    const i = this.findIndex(this.show.scenes, a.id);
    this.show.scenes.splice(i, 1);
    this.setSceneLevel(a.id, 0);
    return { show: true };
  },
  'scene.move'(a) {
    const list = this.show.scenes;
    const i = this.findIndex(list, a.id);
    const j = i + (a.dir < 0 ? -1 : 1);
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    return { show: true };
  },

  // Looks (shared by songs)
  'look.record'(a) {
    const values = this.captureStage();
    const look = { id: uid(), name: String(a.name || '').trim() || `Look ${this.show.looks.length + 1}`, values, effects: this.captureEffects(), timing: this.captureTiming(a.fixtures), refs: this.captureRefs(this.computeLook(Date.now(), { live: false })) };
    look.color = this.colorFor(values);
    this.show.looks.push(look);
    this.programmer = {};
    this.progRefs = {};
    this.setBase({ kind: 'look', lookId: look.id }, 0);
    return { show: true };
  },
  'look.update'(a) {
    const look = this.show.looks[this.findIndex(this.show.looks, a.id)];
    if (a.fixtures) look.timing = this.captureTiming(a.fixtures);
    look.refs = this.captureRefs(this.computeLook(Date.now(), { live: false }));
    look.values = this.captureStage();
    look.effects = this.captureEffects();
    look.color = this.colorFor(look.values);
    this.programmer = {};
    this.progRefs = {};
    this.setBase({ kind: 'look', lookId: look.id }, 0);
    return { show: true };
  },
  'look.edit'(a) {
    const look = this.show.looks[this.findIndex(this.show.looks, a.id)];
    if (a.name !== undefined) look.name = String(a.name).slice(0, 60) || look.name;
    return { show: true };
  },
  'look.delete'(a) {
    this.show.looks.splice(this.findIndex(this.show.looks, a.id), 1);
    for (const s of this.show.songs) for (const sec of s.sections) if (sec.lookId === a.id) sec.lookId = null;
    if (this.rt.base.kind === 'look' && this.rt.base.lookId === a.id) {
      this.rt.cueIndex = -1;
      this.setBase({ kind: 'cue' }, 1);
    }
    return { show: true };
  },
  'look.apply'(a) {
    this.findIndex(this.show.looks, a.id);
    this.rt.sectionId = null;
    this.setBase({ kind: 'look', lookId: a.id }, a.fade ?? 1);
  },

  // Songs & sections
  'song.add'(a) {
    const song = normalizeSong({ id: uid(), name: String(a.name || '').trim() || `Song ${this.show.songs.length + 1}`, notes: '', trigger: null, sections: [] });
    for (const name of Array.isArray(a.sections) ? a.sections : []) {
      song.sections.push({ id: uid(), name: String(name).slice(0, 40), lookId: this.guessLook(name), fade: 1, trigger: null });
    }
    this.show.songs.push(song);
    this.rt.songId = song.id;
    this.rt.sectionId = null;
    return { show: true };
  },
  'song.edit'(a) {
    const s = this.show.songs[this.findIndex(this.show.songs, a.id)];
    if (a.name !== undefined) s.name = String(a.name).slice(0, 80) || s.name;
    if (a.notes !== undefined) s.notes = String(a.notes).slice(0, 300);
    if (a.bpm !== undefined) {
      const bpm = Number(a.bpm);
      s.bpm = bpm >= 30 && bpm <= 300 ? Math.round(bpm * 10) / 10 : null;
      if (s.bpm && this.rt.songId === s.id && !this.rt.clock) this.rt.bpm = s.bpm;
    }
    return { show: true };
  },
  'song.delete'(a) {
    this.show.songs.splice(this.findIndex(this.show.songs, a.id), 1);
    if (this.rt.songId === a.id) {
      this.rt.songId = null;
      this.rt.sectionId = null;
    }
    return { show: true };
  },
  'song.move'(a) {
    const list = this.show.songs;
    const i = this.findIndex(list, a.id);
    const j = i + (a.dir < 0 ? -1 : 1);
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    return { show: true };
  },
  'song.select'(a) {
    const song = this.show.songs[this.findIndex(this.show.songs, a.id)];
    if (song.bpm && !this.rt.clock) this.rt.bpm = song.targetBpm || song.bpm;
    if (song.vocal && song.id !== this.rt.songId) this.rt.vocal = mergeVocal(this.rt.vocal, song.vocal);
    if (song.id !== this.rt.songId) this.rt.paletteLive = {};
    if (this.rt.songId !== a.id) this.rt.sectionId = null;
    this.rt.songId = a.id;
  },
  'section.add'(a) {
    const song = this.show.songs[this.findIndex(this.show.songs, a.songId)];
    const names = Array.isArray(a.names) ? a.names : [a.name];
    for (const raw of names) {
      let name = String(raw || '').trim() || 'Section';
      // Number repeated sections: Verse, Verse 2, Verse 3 ...
      const count = song.sections.filter((x) => x.name.replace(/\s*\d+$/, '') === name).length;
      if (count) name = `${name} ${count + 1}`;
      song.sections.push({ id: uid(), name, lookId: a.lookId || this.guessLook(name), fade: 1, trigger: null });
    }
    return { show: true };
  },
  'section.edit'(a) {
    const song = this.show.songs[this.findIndex(this.show.songs, a.songId)];
    const sec = song.sections[this.findIndex(song.sections, a.id)];
    if (a.name !== undefined) sec.name = String(a.name).slice(0, 40) || sec.name;
    if (a.lookId !== undefined) {
      if (a.lookId && !this.show.looks.some((l) => l.id === a.lookId)) throw new Error('Unknown look');
      sec.lookId = a.lookId || null;
    }
    if (a.fade !== undefined) sec.fade = Math.max(0, Math.min(60, num(a.fade, 'Fade')));
    return { show: true };
  },
  'section.delete'(a) {
    const song = this.show.songs[this.findIndex(this.show.songs, a.songId)];
    song.sections.splice(this.findIndex(song.sections, a.id), 1);
    if (this.rt.sectionId === a.id) this.rt.sectionId = null;
    return { show: true };
  },
  'section.move'(a) {
    const list = this.show.songs[this.findIndex(this.show.songs, a.songId)].sections;
    const i = this.findIndex(list, a.id);
    const j = i + (a.dir < 0 ? -1 : 1);
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    return { show: true };
  },
  'section.go'(a) {
    if (this.rt.mode === 'auto' && !this.rt.hold) throw new Error('Auto mode: the tracks are in control. Switch to Hybrid or Manual, or press Hold.');
    const song = this.show.songs[this.findIndex(this.show.songs, a.songId)];
    let sec;
    if (a.id) sec = song.sections[this.findIndex(song.sections, a.id)];
    else {
      const i = song.sections.findIndex((x) => x.id === this.rt.sectionId);
      const j = this.rt.songId === song.id ? i + (a.dir < 0 ? -1 : 1) : 0;
      sec = song.sections[j];
      if (!sec) throw new Error(a.dir < 0 ? 'Already at the start' : 'End of the song');
    }
    this.goSection(song, sec);
  },
  // ----- backing tracks ------------------------------------------------------------
  'song.audio'(a) {
    const s = this.show.songs[this.findIndex(this.show.songs, a.id)];
    if ('key' in a) s.key = a.key === null || a.key === '' ? null : ((Math.floor(num(a.key, 'Key')) % 12) + 12) % 12;
    if ('minor' in a) s.minor = !!a.minor;
    if ('transpose' in a) s.transpose = Math.max(-12, Math.min(12, Math.round(num(a.transpose, 'Transpose'))));
    if ('targetBpm' in a) {
      const b = Number(a.targetBpm);
      s.targetBpm = a.targetBpm === null || a.targetBpm === '' || !(b >= 30 && b <= 300) ? null : Math.round(b * 10) / 10;
      if (this.rt.songId === s.id && !this.rt.clock && (s.targetBpm || s.bpm)) this.rt.bpm = s.targetBpm || s.bpm;
    }
    if ('midiOut' in a) {
      const m = a.midiOut;
      s.midiOut = m && m.pc !== '' && m.pc !== null && m.pc !== undefined ? { pc: Math.max(0, Math.min(127, Math.floor(num(m.pc, 'Program')))), ch: Math.max(1, Math.min(16, Math.floor(num(m.ch || 1, 'Channel')))) } : null;
    }
    return { show: true };
  },
  'stem.add'(a) {
    const s = this.show.songs[this.findIndex(this.show.songs, a.songId)];
    const name = String(a.name || 'Stem').replace(/\.[a-z0-9]+$/i, '').slice(0, 40);
    const file = String(a.file || '');
    if (!/^audio\/[A-Za-z0-9._-]+$/.test(file)) throw new Error('Upload the audio file first');
    // Click and guide tracks go to outputs 3-4 (the band's in-ear mix) by default.
    const cue = /click|clk|metro|cue|guide|count/i.test(name);
    // A click keeps its pitch when the key changes (it still follows the tempo).
    s.stems.push({ id: uid(), name, file, gain: 0, pan: 0, mute: false, solo: false, out: cue ? 1 : 0, keepPitch: /click|clk|metro/i.test(name) });
    return { show: true };
  },
  'stem.edit'(a) {
    const s = this.show.songs[this.findIndex(this.show.songs, a.songId)];
    const st = s.stems[this.findIndex(s.stems, a.id)];
    if (a.name !== undefined) st.name = String(a.name).slice(0, 40) || st.name;
    if (a.gain !== undefined) st.gain = Math.max(-60, Math.min(12, num(a.gain, 'Level')));
    if (a.pan !== undefined) st.pan = Math.max(-1, Math.min(1, num(a.pan, 'Pan')));
    if (a.mute !== undefined) st.mute = !!a.mute;
    if (a.solo !== undefined) st.solo = !!a.solo;
    if (a.out !== undefined) st.out = Math.max(0, Math.min(31, Math.floor(num(a.out, 'Output'))));
    if (a.keepPitch !== undefined) st.keepPitch = !!a.keepPitch;
    return { show: true };
  },
  'stem.delete'(a) {
    const s = this.show.songs[this.findIndex(this.show.songs, a.songId)];
    s.stems.splice(this.findIndex(s.stems, a.id), 1);
    return { show: true };
  },
  'marker.set'(a) {
    const s = this.show.songs[this.findIndex(this.show.songs, a.songId)];
    this.findIndex(s.sections, a.sectionId);
    s.markers = s.markers.filter((m) => m.sectionId !== a.sectionId);
    if (a.time !== null && a.time !== undefined && a.time !== '') s.markers.push({ sectionId: a.sectionId, time: Math.max(0, round4(num(a.time, 'Time'))) });
    s.markers.sort((x, y) => x.time - y.time);
    return { show: true };
  },
  // Transport commands go to whichever computer plays the audio.
  'transport'(a) {
    const cmds = ['play', 'stop', 'seek', 'loop', 'unloop', 'section'];
    if (!cmds.includes(a.cmd)) throw new Error('Unknown transport command');
    const songId = a.songId || this.rt.songId;
    if (!songId) throw new Error('Pick a song first');
    if (songId !== this.rt.songId) ACTIONS['song.select'].call(this, { id: songId });
    const t = this.rt.transport;
    this.rt.transport = { seq: t.seq + 1, cmd: a.cmd, songId, pos: a.pos === undefined ? null : Math.max(0, num(a.pos, 'Position')), sectionId: a.sectionId || null, at: Date.now() };
  },
  'transport.report'(a) {
    const prev = this.rt.playhead;
    this.rt.playhead = { songId: a.songId || null, pos: Math.max(0, Number(a.pos) || 0), dur: Math.max(0, Number(a.dur) || 0), playing: !!a.playing, looping: !!a.looping, ready: !!a.ready, status: String(a.status || '').slice(0, 80), at: Date.now() };
    // Send to everyone at most every 500 ms, or when play/stop changes.
    if (prev && prev.playing === this.rt.playhead.playing && prev.status === this.rt.playhead.status && Date.now() - (this.lastReportBroadcast || 0) < 450) return { runtime: false };
    this.lastReportBroadcast = Date.now();
  },
  // The playing tracks reached a section marker.
  'tracks.marker'(a) {
    const song = this.show.songs[this.findIndex(this.show.songs, a.songId)];
    const sec = song.sections[this.findIndex(song.sections, a.sectionId)];
    const info = { t: 'track', name: sec.name, at: Date.now() };
    if (this.rt.mode === 'manual') return void (this.rt.lastMidi = { ...info, result: `${sec.name} (ignored: Manual mode)` });
    if (this.rt.hold) return void (this.rt.lastMidi = { ...info, result: `${sec.name} (ignored: Hold is on)` });
    this.goSection(song, sec);
    this.rt.lastMidi = { ...info, result: `${song.name} · ${sec.name}` };
  },
  'audio.host'(a) {
    const id = String(a.id || '').slice(0, 40);
    if (a.on) this.rt.audioHost = { id, name: String(a.name || 'This computer').slice(0, 40), at: Date.now() };
    else if (this.rt.audioHost && this.rt.audioHost.id === id) this.rt.audioHost = null;
  },
  'vocal.set'(a) {
    this.rt.vocal = mergeVocal(this.rt.vocal, a.vocal || {});
  },
  'vocal.saveToSong'(a) {
    const s = this.show.songs[this.findIndex(this.show.songs, a.songId)];
    s.vocal = cloneVocal(this.rt.vocal);
    return { show: true };
  },
  'vocal.clearSong'(a) {
    const s = this.show.songs[this.findIndex(this.show.songs, a.songId)];
    delete s.vocal;
    return { show: true };
  },

  // ----- ProPresenter -----------------------------------------------------------------
  // The live slide changed: follow its group (Verse 1, Chorus...) with the lights.
  'pp.slide'(a) {
    const pp = this.show.settings.pp;
    const pres = a.presentation || {};
    const group = a.group || null;
    this.rt.pp = { presentation: pres, index: a.index, group: group && group.name, color: group && group.color, groups: (a.groups || []).slice(0, 100), result: '' };
    const note = (t) => { this.rt.pp.result = t; };
    // Song with the same name as the presentation
    let song = this.show.songs.find((x) => x.id === this.rt.songId);
    if (pp.songs && pres.name) {
      const match = this.show.songs.find((x) => nameKey(x.name) === nameKey(pres.name));
      if (match && match.id !== this.rt.songId) ACTIONS['song.select'].call(this, { id: match.id });
      if (match) song = match;
    }
    if (pp.colorMode === 'group' && group && group.color) this.applyScreenColor(group.color);
    if (!pp.sections || !group || !group.name) return note(group ? '' : 'slide has no group');
    if (this.rt.mode === 'manual') return note(`${group.name} (ignored: Manual mode)`);
    if (this.rt.hold) return note(`${group.name} (ignored: Hold is on)`);
    const sec = song && matchSection(song.sections, group.name);
    if (sec) {
      if (sec.id !== this.rt.sectionId) this.goSection(song, sec);
      return note(`${song.name} · ${sec.name}`);
    }
    // No song section: use a look with the same name (e.g. "Chorus")
    const look = this.show.looks.find((l) => nameKey(l.name) === nameKey(group.name)) || this.show.looks.find((l) => baseKey(l.name) === baseKey(group.name));
    if (look) {
      if (!(this.rt.base.kind === 'look' && this.rt.base.lookId === look.id)) {
        this.rt.sectionId = null;
        this.setBase({ kind: 'look', lookId: look.id }, 1);
      }
      return note(`look ${look.name}`);
    }
    note(`${group.name}: no matching section or look`);
  },
  // Colour taken from the slide image (computed by the app window)
  'pp.color'(a) {
    if (this.show.settings.pp.colorMode !== 'slide') return { runtime: false };
    const key = String(a.key || '');
    if (key && key === this.lastPpColorKey) return { runtime: false };
    this.lastPpColorKey = key;
    this.applyScreenColor((a.rgb || []).map((v) => clamp01(num(v, 'Colour'))));
  },
  'pp.status'(a) {
    this.rt.ppStatus = a.status || null;
  },
  // Make a song from the live presentation: same name, one section per group.
  'pp.importSong'() {
    const pp = this.rt.pp;
    if (!pp || !pp.presentation || !pp.presentation.name) throw new Error('No ProPresenter presentation is live');
    const names = [...new Set((pp.groups || []).filter(Boolean))];
    let song = this.show.songs.find((x) => nameKey(x.name) === nameKey(pp.presentation.name));
    if (!song) {
      ACTIONS['song.add'].call(this, { name: pp.presentation.name });
      song = this.show.songs.at(-1);
    }
    for (const n of names) if (!song.sections.some((x) => nameKey(x.name) === nameKey(n))) song.sections.push({ id: uid(), name: n.slice(0, 40), lookId: this.guessLook(n), fade: 1, trigger: null });
    this.rt.songId = song.id;
    return { show: true };
  },

  // ----- palette ------------------------------------------------------------------------
  // Set primary (0) / secondary (1) / tertiary (2). Goes into the current song's colours,
  // or the default colours when no song is picked (or scope 'show'). scope 'live' = until the song changes.
  'palette.set'(a) {
    const i = Number.isInteger(a.index) ? a.index : palIndex(a.role);
    if (!(i >= 0 && i < 3)) throw new Error('Choose primary, secondary or tertiary');
    const hex = Array.isArray(a.rgb) ? rgbToHex(a.rgb.map((v) => num(v, 'Colour'))) : String(a.color || '').toLowerCase();
    if (!isHex(hex)) throw new Error('Colour must be like #ff8800');
    if (a.scope === 'live') {
      this.rt.paletteLive[i] = hex;
      return;
    }
    const song = this.show.songs.find((x) => x.id === this.rt.songId);
    delete this.rt.paletteLive[i];
    if (song && a.scope !== 'show') {
      song.palette = [...(song.palette || this.show.palette)];
      song.palette[i] = hex;
    } else this.show.palette[i] = hex;
    return { show: true };
  },
  'palette.reset'(a) {
    const song = this.show.songs.find((x) => x.id === (a.songId || this.rt.songId));
    if (song) song.palette = null;
    this.rt.paletteLive = {};
    return { show: true };
  },
  'palette.release'() {
    this.rt.paletteLive = {};
  },

  // ----- OSC ----------------------------------------------------------------------------
  'osc.message'(a) {
    const address = String(a.address || '');
    const args = Array.isArray(a.args) ? a.args : [];
    const first = args[0];
    const press = args.length === 0 || !(first === 0 || first === false || first === '0' || first === 0.0);
    const lower = address.toLowerCase();
    this.rt.lastOsc = { address, args: args.slice(0, 4), at: Date.now(), result: '' };
    const res = (t, show = false) => { this.rt.lastOsc.result = t; return { show }; };
    const named = (list, x) => {
      if (typeof x === 'number' || /^\d+$/.test(String(x ?? ''))) return list[Number(x) - 1];
      return list.find((o) => nameKey(o.name) === nameKey(x)) || list.find((o) => baseKey(o.name) === baseKey(x));
    };
    const fwd = (type, payload) => { ACTIONS[type].call(this, payload); };

    // Learn: the next OSC message becomes the trigger
    if (this.rt.learn) {
      if (!press) return { runtime: false };
      const L = this.rt.learn;
      this.rt.learn = null;
      const song = this.song(L.songId);
      const target = L.sectionId ? song && song.sections.find((x) => x.id === L.sectionId) : song;
      if (!target) return res('learn target is gone');
      target.trigger = { t: 'osc', a: address, ...(typeof first === 'string' ? { v: first } : {}) };
      return res(`learned for ${target.name}`, true);
    }
    // Learned song / section triggers
    const same = (tr) => tr && tr.t === 'osc' && tr.a.toLowerCase() === lower && (tr.v === undefined || tr.v === first);
    const trigSong = this.show.songs.find((x) => same(x.trigger));
    let hit = null;
    const cur = this.song(this.rt.songId);
    if (cur) { const sec = cur.sections.find((x) => same(x.trigger)); if (sec) hit = [cur, sec]; }
    if (!hit) for (const sg of this.show.songs) { const sec = sg.sections.find((x) => same(x.trigger)); if (sec) { hit = [sg, sec]; break; } }
    if (trigSong || hit) {
      if (!press) return { runtime: false };
      if (trigSong && trigSong.id !== this.rt.songId) fwd('song.select', { id: trigSong.id });
      if (!hit) return res(`song: ${trigSong.name}`);
      if (this.rt.mode === 'manual') return res(`${hit[1].name} (ignored: Manual mode)`);
      if (this.rt.hold) return res(`${hit[1].name} (ignored: Hold is on)`);
      this.goSection(hit[0], hit[1]);
      return res(`${hit[0].name} · ${hit[1].name}`);
    }

    // Built-in addresses: /sl/...
    const parts = address.split('/').filter(Boolean);
    if (!parts.length || parts[0].toLowerCase() !== 'sl') return res('no match');
    const cmd = (parts[1] || '').toLowerCase();
    const val = (d = 1) => (typeof first === 'number' ? first : typeof first === 'boolean' ? (first ? 1 : 0) : first === undefined ? d : Number(first));
    const sectionGo = (sec, song) => {
      if (this.rt.mode === 'auto' && !this.rt.hold) { /* OSC acts like the tracks: allowed in auto */ }
      this.goSection(song, sec);
      return res(`${song.name} · ${sec.name}`);
    };
    switch (cmd) {
      case 'go': if (!press) return { runtime: false }; fwd('cue.go', {}); return res('GO');
      case 'back': if (!press) return { runtime: false }; fwd('cue.back', {}); return res('Back');
      case 'cue': { const c = named(this.show.cues, parts[2] ?? first); if (!c) return res('no such cue'); fwd('cue.goto', { id: c.id }); return res(`cue ${c.name}`); }
      case 'next': case 'prev': {
        if (!press) return { runtime: false };
        if (!cur) return res('no song picked');
        if (this.rt.mode === 'manual' && a.strict) return res('Manual mode');
        const i = cur.sections.findIndex((x) => x.id === this.rt.sectionId);
        const sec = cur.sections[cmd === 'next' ? i + 1 : Math.max(0, i - 1)];
        return sec ? sectionGo(sec, cur) : res('end of song');
      }
      case 'section': {
        if (!press && parts.length < 3) return { runtime: false };
        if (!cur) return res('no song picked');
        const sec = named(cur.sections, parts[2] ?? first);
        if (!sec) return res('no such section');
        if (this.rt.mode === 'manual') return res(`${sec.name} (ignored: Manual mode)`);
        if (this.rt.hold) return res(`${sec.name} (ignored: Hold is on)`);
        return sectionGo(sec, cur);
      }
      case 'song': { const sg = named(this.show.songs, parts[2] ?? first); if (!sg) return res('no such song'); fwd('song.select', { id: sg.id }); return res(`song ${sg.name}`); }
      case 'look': { const l = named(this.show.looks, parts[2] ?? first); if (!l) return res('no such look'); fwd('look.apply', { id: l.id }); return res(`look ${l.name}`); }
      case 'scene': {
        const sc = named(this.show.scenes, parts[2] ?? first);
        if (!sc) return res('no such scene');
        const lvl = parts[2] !== undefined ? val(1) : args.length > 1 ? Number(args[1]) : null;
        if (lvl === null || Number.isNaN(lvl)) fwd('scene.toggle', { id: sc.id });
        else fwd('scene.level', { id: sc.id, level: clamp01(lvl) });
        return res(`scene ${sc.name}`);
      }
      case 'pad': {
        const key = parts[2] ?? first;
        const pad = this.show.pads.find((p) => p.key && p.key === String(key).toLowerCase()) || named(this.show.pads, key);
        if (!pad) return res('no such pad');
        const down = parts[2] !== undefined ? press : args.length > 1 ? !(args[1] === 0 || args[1] === false) : true;
        fwd('pad.press', { id: pad.id, down });
        if (pad.mode === 'toggle' && parts[2] === undefined && args.length <= 1) fwd('pad.press', { id: pad.id, down: false });
        return res(`pad ${pad.name}`);
      }
      case 'gm': case 'master': fwd('gm.set', { value: clamp01(val(1)) }); return res(`master ${Math.round(clamp01(val(1)) * 100)}%`);
      case 'blackout': fwd('blackout.set', { on: args.length ? press : !this.rt.blackout }); return res('blackout');
      case 'strobe': fwd('strobe.hold', { on: press }); return res(press ? 'strobe on' : 'strobe off');
      case 'flash': fwd('flash.all', { on: press }); return res(press ? 'flash on' : 'flash off');
      case 'tap': if (!press) return { runtime: false }; fwd('tempo.tap', {}); return res('tap');
      case 'bpm': fwd('tempo.set', { bpm: val(120) }); return res(`${val(120)} BPM`);
      case 'mode': { const m = String(parts[2] ?? first).toLowerCase(); fwd('mode.set', { mode: m }); return res(`mode ${m}`); }
      case 'hold': fwd('hold.set', { on: press }); return res(press ? 'hold' : 'resume');
      case 'release': if (!press) return { runtime: false }; fwd('busk.release', {}); return res('released');
      case 'palette': {
        // /sl/palette/primary "#ff8800"  or  /sl/palette/secondary r g b (0..1)
        const i = palIndex(parts[2]);
        if (i < 0) return res('use /sl/palette/primary|secondary|tertiary');
        const rgb = args.length >= 3 ? args.slice(0, 3).map(Number) : null;
        fwd('palette.set', rgb ? { index: i, rgb, scope: 'live' } : { index: i, color: String(first), scope: 'live' });
        return res(`${PAL_NAMES[i]} colour`);
      }
      case 'group': {
        const g = named(this.show.groups, parts[2]);
        if (!g) return res('no such group');
        const what = (parts[3] || '').toLowerCase();
        if (what === 'level') fwd('busk.level', { groupId: g.id, level: clamp01(val(1)) });
        else if (what === 'flash') fwd('busk.flash', { groupId: g.id, on: press });
        else if (what === 'color' || what === 'colour') {
          const role = palIndex(first);
          if (role >= 0) fwd('busk.color', { groupId: g.id, role: role + 1 });
          else if (args.length >= 3) fwd('busk.color', { groupId: g.id, rgb: args.slice(0, 3).map(Number) });
          else if (isHex(first)) fwd('busk.color', { groupId: g.id, rgb: FX.hexToRgb(first) });
          else fwd('busk.color', { groupId: g.id, rgb: null });
        } else if (what === 'fx') {
          const fx = typeof first === 'string' ? FX.BUILTIN.concat(this.show.effects).find((e) => nameKey(e.name) === nameKey(first) || e.id === first) : null;
          fwd('busk.fx', { groupId: g.id, fx: fx ? fx.id : 'off' });
        } else return res('use /sl/group/<name>/level|color|flash|fx');
        return res(`group ${g.name} ${what}`);
      }
      default: return res('unknown /sl command');
    }
  },

  'mode.set'(a) {
    if (!['manual', 'hybrid', 'auto'].includes(a.mode)) throw new Error('Unknown mode');
    this.rt.mode = a.mode;
    this.rt.hold = false;
  },
  'hold.set'(a) {
    this.rt.hold = !!a.on;
  },
  'midi.learn'(a) {
    if (!a.songId) {
      this.rt.learn = null;
      return;
    }
    const song = this.show.songs[this.findIndex(this.show.songs, a.songId)];
    if (a.sectionId) this.findIndex(song.sections, a.sectionId);
    this.rt.learn = { songId: a.songId, sectionId: a.sectionId || null };
  },
  'midi.forget'(a) {
    const song = this.show.songs[this.findIndex(this.show.songs, a.songId)];
    const target = a.sectionId ? song.sections[this.findIndex(song.sections, a.sectionId)] : song;
    target.trigger = null;
    return { show: true };
  },
  'midi.message'(a) {
    if (!Array.isArray(a.data)) throw new Error('MIDI data must be an array of bytes');
    const r = this.handleMidi(a.data.map((x) => Number(x) & 0xff));
    if (!r) return { runtime: false };
    return r;
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

  // Presets (palettes): dimmer / colour / position / beam / all
  'preset.record'(a) {
    const kind = PRESET_ATTRS[a.kind] ? a.kind : 'color';
    const fids = ids(a).filter((id) => this.fixtureMap.has(id));
    if (!fids.length) throw new Error('Select the lights to take the values from');
    const look = this.computeLook(Date.now(), { live: false });
    const values = {};
    for (const fid of fids) {
      const v = {};
      for (const [k, x] of Object.entries(look[fid])) if (PRESET_ATTRS[kind](k)) v[k] = round4(x);
      if (Object.keys(v).length) values[fid] = v;
    }
    if (!Object.keys(values).length) throw new Error(`The selected lights have no ${kind === 'dim' ? 'dimmer' : kind} settings`);
    const universal = { ...values[fids.find((f) => values[f])] };
    let preset = a.id && this.show.presets.find((x) => x.id === a.id);
    if (preset) {
      preset.values = a.merge ? { ...preset.values, ...values } : values;
      preset.universal = universal;
    } else {
      preset = { id: uid(), kind, name: String(a.name || '').trim().slice(0, 40) || `${kind} ${this.show.presets.length + 1}`, values, universal };
      this.show.presets.push(preset);
    }
    preset.color = kind === 'color' ? this.colorFor(Object.fromEntries(Object.entries(values).map(([f, v]) => [f, { ...v, dim: 1 }]))) : null;
    return { show: true };
  },
  'preset.apply'(a) {
    const preset = this.getPreset(a.id);
    if (!preset) throw new Error('Not found');
    for (const fid of ids(a)) {
      const fx = this.fixtureMap.get(fid);
      if (!fx) continue;
      for (const attr of fx.prof.attrs) {
        if (!PRESET_ATTRS[preset.kind](attr)) continue;
        const v = this.presetValue(preset, fid, attr);
        if (v === undefined) continue;
        (this.programmer[fid] ||= {})[attr] = v;
        (this.progRefs[fid] ||= {})[attr] = preset.id;
      }
    }
  },
  'preset.edit'(a) {
    const preset = this.show.presets[this.findIndex(this.show.presets, a.id)];
    if (a.name !== undefined) preset.name = String(a.name).slice(0, 40) || preset.name;
    return { show: true };
  },
  'preset.delete'(a) {
    this.show.presets.splice(this.findIndex(this.show.presets, a.id), 1);
    for (const list of [this.show.cues, this.show.looks]) for (const c of list) for (const attrs of Object.values(c.refs || {})) for (const [k, pid] of Object.entries(attrs)) if (pid === a.id) delete attrs[k];
    for (const attrs of Object.values(this.progRefs)) for (const [k, pid] of Object.entries(attrs)) if (pid === a.id) delete attrs[k];
    for (const p of this.show.pads) if (p.presetId === a.id) p.presetId = null;
    return { show: true };
  },
  'preset.move'(a) {
    const list = this.show.presets;
    const i = this.findIndex(list, a.id);
    const j = i + (a.dir < 0 ? -1 : 1);
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    return { show: true };
  },

  // Effects library (custom effects; built-ins are fixed)
  'effect.save'(a) {
    const e = a.effect || {};
    const existing = e.id && this.show.effects.find((x) => x.id === e.id);
    const clean = cleanEffect(e, existing ? existing.id : `fx-${uid()}`);
    if (existing) Object.assign(existing, clean);
    else this.show.effects.push(clean);
    this.lastSavedEffect = clean.id;
    return { show: true };
  },
  'effect.delete'(a) {
    const i = this.findIndex(this.show.effects, a.id);
    this.show.effects.splice(i, 1);
    for (const [k, inst] of Object.entries(this.rt.running)) if (inst.effectId === a.id) delete this.rt.running[k];
    return { show: true };
  },
  // Run an effect on lights (in the given order) or a group
  'fx.run'(a) {
    if (!this.effectById(a.effectId)) throw new Error('Unknown effect');
    const key = String(a.key || `fx-${uid()}`).slice(0, 40);
    const inst = { effectId: a.effectId, rate: [0.25, 0.5, 1, 2, 4].includes(Number(a.rate)) ? Number(a.rate) : 1, size: clamp01(a.size ?? 1) };
    if (a.useTricks !== false && this.tricksUsed()) inst.tricks = { ...this.rt.tricks };
    if (a.groupId) {
      this.findIndex(this.show.groups, a.groupId);
      inst.groupId = a.groupId;
    } else {
      inst.fixtures = ids(a).filter((id) => this.fixtureMap.has(id));
      if (!inst.fixtures.length) throw new Error('Select some lights or a group first');
    }
    this.rt.running[key] = inst;
  },
  'fx.adjust'(a) {
    const inst = this.rt.running[a.key];
    if (!inst) throw new Error('That effect is not running');
    if (a.rate !== undefined) inst.rate = Math.max(0.125, Math.min(8, num(a.rate, 'Speed')));
    if (a.size !== undefined) inst.size = clamp01(num(a.size, 'Size'));
  },
  'fx.stop'(a) {
    if (a.key) delete this.rt.running[a.key];
    else this.rt.running = {};
    for (const k of Object.keys(this.rt.padsOn)) if (!this.rt.running[k] && !this.rt.livePresets[k] && !this.rt.padFlash[k]) delete this.rt.padsOn[k];
  },

  // Pads: live buttons with hotkeys
  'pad.save'(a) {
    const p = a.pad || {};
    const kind = ['effect', 'preset', 'flash'].includes(p.kind) ? p.kind : 'effect';
    if (kind === 'effect' && !this.effectById(p.effectId)) throw new Error('Choose an effect');
    if (kind === 'preset' && !this.getPreset(p.presetId)) throw new Error('Choose a preset');
    if (p.groupId) this.findIndex(this.show.groups, p.groupId);
    const key = String(p.key || '').slice(0, 1).toLowerCase();
    if (key && /[ tsfbr?]/.test(key)) throw new Error(`"${key}" is already used (Space, T, S, F, B, R, ?)`);
    const clash = key && this.show.pads.find((x) => x.key === key && x.id !== p.id);
    if (clash) clash.key = '';
    const clean = {
      id: p.id && this.show.pads.some((x) => x.id === p.id) ? p.id : uid(),
      name: String(p.name || '').trim().slice(0, 24) || 'Pad',
      kind, effectId: kind === 'effect' ? p.effectId : null, presetId: kind === 'preset' ? p.presetId : null,
      groupId: p.groupId || '', mode: p.mode === 'hold' ? 'hold' : 'toggle', key,
      rate: [0.25, 0.5, 1, 2, 4].includes(Number(p.rate)) ? Number(p.rate) : 1,
    };
    const i = this.show.pads.findIndex((x) => x.id === clean.id);
    if (i >= 0) this.show.pads[i] = clean;
    else this.show.pads.push(clean);
    this.padOff(clean.id);
    return { show: true };
  },
  'pad.delete'(a) {
    this.show.pads.splice(this.findIndex(this.show.pads, a.id), 1);
    this.padOff(a.id);
    return { show: true };
  },
  'pad.move'(a) {
    const list = this.show.pads;
    const i = this.findIndex(list, a.id);
    const j = i + (a.dir < 0 ? -1 : 1);
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    return { show: true };
  },
  'pad.press'(a) {
    const pad = this.show.pads[this.findIndex(this.show.pads, a.id)];
    const on = !!this.rt.padsOn[pad.id];
    if (pad.mode === 'hold') {
      if (a.down) this.padOn(pad, true);
      else this.padOff(pad.id);
    } else if (a.down) {
      if (on) this.padOff(pad.id);
      else this.padOn(pad, false);
    } else return { runtime: false };
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

  // Patch
  'fixture.add'(a) {
    const prof = this.profiles[a.profile];
    if (!prof) throw new Error('Choose a fixture type');
    const count = Math.max(1, Math.min(128, Math.floor(num(a.count ?? 1, 'Count'))));
    const universe = Math.floor(num(a.universe ?? 1, 'Universe'));
    let address = a.address ? Math.floor(num(a.address, 'Address')) : this.nextFreeAddress(universe, prof.footprint);
    if (!address) throw new Error(`No room left in universe ${universe}`);
    const baseName = String(a.name || '').trim() || prof.name.replace(/\s*\(.*\)$/, '');
    const rowY = Math.min(0.9, 0.15 + (new Set(this.show.fixtures.map((f) => f.y)).size % 6) * 0.15);
    const added = [];
    for (let i = 0; i < count; i++) {
      const f = {
        id: uid(),
        name: count > 1 ? `${baseName} ${i + 1}` : baseName,
        profile: a.profile,
        universe,
        address: address + i * prof.footprint,
        x: round4((i + 1) / (count + 1)),
        y: rowY,
      };
      this.validatePatch(f, prof);
      added.push(f);
    }
    this.show.fixtures.push(...added);
    return { show: true };
  },
  'fixture.edit'(a) {
    const f = this.show.fixtures[this.findIndex(this.show.fixtures, a.id)];
    const next = { ...f };
    if (a.name !== undefined) next.name = String(a.name).slice(0, 60) || f.name;
    if (a.profile !== undefined) next.profile = a.profile;
    if (a.universe !== undefined) next.universe = Math.floor(num(a.universe, 'Universe'));
    if (a.address !== undefined) next.address = Math.floor(num(a.address, 'Address'));
    if (a.x !== undefined) next.x = round4(clamp01(num(a.x, 'x')));
    if (a.y !== undefined) next.y = round4(clamp01(num(a.y, 'y')));
    const vec = (v, name) => {
      if (v === null) return undefined;
      const o = { x: num(v.x, name), y: num(v.y, name), z: num(v.z, name) };
      for (const k of 'xyz') if (Math.abs(o[k]) > 1000) throw new Error(`${name} is too far away`);
      return { x: round4(o.x), y: round4(o.y), z: round4(o.z) };
    };
    if (a.pos3d !== undefined) next.pos3d = vec(a.pos3d, 'Position');
    if (a.aim !== undefined) next.aim = vec(a.aim, 'Aim');
    if (a.beam !== undefined) next.beam = Math.max(2, Math.min(90, num(a.beam, 'Beam angle')));
    const prof = this.profiles[next.profile];
    if (!prof) throw new Error('Unknown fixture type');
    this.validatePatch(next, prof);
    Object.assign(f, next);
    if (a.profile !== undefined) delete this.programmer[f.id];
    return { show: true };
  },
  'fixture.delete'(a) {
    const del = new Set(ids(a));
    this.show.fixtures = this.show.fixtures.filter((f) => !del.has(f.id));
    for (const g of this.show.groups) g.fixtures = g.fixtures.filter((id) => !del.has(id));
    for (const list of [this.show.cues, this.show.scenes, this.show.looks]) for (const c of list) for (const id of del) delete c.values[id];
    for (const id of del) delete this.programmer[id];
    return { show: true };
  },
  'stage3d.set'(a) {
    const st = this.show.stage3d;
    if (a.stage) {
      const w = num(a.stage.w ?? st.stage.w, 'Width'), d = num(a.stage.d ?? st.stage.d, 'Depth'), h = num(a.stage.h ?? st.stage.h, 'Height');
      st.stage = { w: Math.max(1, Math.min(200, w)), d: Math.max(1, Math.min(200, d)), h: Math.max(0, Math.min(10, h)) };
    }
    if (a.screens) {
      if (!Array.isArray(a.screens)) throw new Error('screens must be a list');
      const n = (v, d, lo, hi) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Number(v))) : d);
      st.screens = a.screens.slice(0, 20).map((x) => ({
        id: x.id || uid(), name: String(x.name || 'Screen').slice(0, 40), kind: x.kind === 'led' ? 'led' : 'projector',
        x: n(x.x, 0, -200, 200), y: n(x.y, 3, -10, 60), z: n(x.z, -5.9, -200, 200),
        w: n(x.w, 4, 0.2, 60), h: n(x.h, 2.25, 0.2, 40), rotY: n(x.rotY, 0, -360, 360), rotX: n(x.rotX, 0, -90, 90),
        protect: x.protect !== false, slides: x.slides !== false,
      }));
    }
    if (a.models) {
      if (!Array.isArray(a.models)) throw new Error('models must be a list');
      st.models = a.models.slice(0, 200).map((m) => ({
        file: String(m.file).replace(/[^a-zA-Z0-9._\/-]/g, '').replace(/\.\.+/g, '.'),
        name: String(m.name || m.file).slice(0, 80),
        x: Number(m.x) || 0, y: Number(m.y) || 0, z: Number(m.z) || 0,
        rotX: Number(m.rotX) || 0, rotY: Number(m.rotY) || 0,
        scale: Number(m.scale) > 0 ? Number(m.scale) : 1,
        matrix: Array.isArray(m.matrix) && m.matrix.length === 16 ? m.matrix.map(Number) : null,
      }));
    }
    return { show: true };
  },
  // Apply an imported MVR (fixtures with positions and patch, plus stage geometry).
  'mvr.apply'(a) {
    if (!Array.isArray(a.fixtures)) throw new Error('Nothing to import');
    if (a.replace) {
      ACTIONS['fixture.delete'].call(this, { fixtures: this.show.fixtures.map((f) => f.id) });
      for (const g of this.show.groups.filter((x) => !x.fixtures.length)) delete this.rt.busk[g.id];
      this.show.groups = this.show.groups.filter((x) => x.fixtures.length);
      this.compile();
    }
    const xs = a.fixtures.map((f) => f.pos3d.x), zs = a.fixtures.map((f) => f.pos3d.z);
    const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    const skipped = [];
    for (const f of a.fixtures) {
      const prof = this.profiles[f.profile];
      if (!prof) { skipped.push(f.name); continue; }
      const fx = {
        id: uid(), name: String(f.name).slice(0, 60), profile: f.profile,
        universe: Math.floor(num(f.universe || 1, 'Universe')), address: Math.floor(num(f.address || 1, 'Address')),
        x: round4(maxX > minX ? 0.05 + 0.9 * (f.pos3d.x - minX) / (maxX - minX) : 0.5),
        y: round4(maxZ > minZ ? 0.1 + 0.8 * (f.pos3d.z - minZ) / (maxZ - minZ) : 0.5),
        pos3d: f.pos3d, aim: f.aim || null, beam: f.beam || 25,
      };
      try {
        this.validatePatch(fx, prof);
      } catch {
        skipped.push(f.name);
        continue;
      }
      this.show.fixtures.push(fx);
    }
    if (Array.isArray(a.models)) ACTIONS['stage3d.set'].call(this, { models: [...(a.keepModels ? this.show.stage3d.models : []), ...a.models] });
    this.lastImportSkipped = skipped;
    return { show: true };
  },
  'profile.save'(a) {
    const name = String(a.name || '').trim();
    if (!name) throw new Error('Give the fixture type a name');
    parseChannels(a.channels); // throws if invalid
    const id = a.id && this.show.profiles[a.id] ? a.id : `custom-${uid()}`;
    const old = this.show.profiles[id];
    if (old) {
      const footprint = parseChannels(a.channels).length;
      for (const f of this.show.fixtures) if (f.profile === id && f.address + footprint - 1 > 512) throw new Error(`${f.name} would run past channel 512`);
    }
    this.show.profiles[id] = { name, channels: String(a.channels).trim() };
    return { show: true };
  },
  'profile.delete'(a) {
    if (!this.show.profiles[a.id]) throw new Error('Only custom types can be deleted');
    if (this.show.fixtures.some((f) => f.profile === a.id)) throw new Error('Fixtures still use this type');
    delete this.show.profiles[a.id];
    return { show: true };
  },
  'group.save'(a) {
    const name = String(a.name || '').trim();
    if (!name) throw new Error('Give the group a name');
    const fixtures = ids(a).filter((id) => this.fixtureMap.has(id));
    if (!fixtures.length) throw new Error('Select some fixtures first');
    const existing = a.id && this.show.groups.find((g) => g.id === a.id);
    if (existing) Object.assign(existing, { name, fixtures });
    else this.show.groups.push({ id: uid(), name, fixtures });
    return { show: true };
  },
  'group.delete'(a) {
    this.show.groups.splice(this.findIndex(this.show.groups, a.id), 1);
    delete this.rt.busk[a.id];
    return { show: true };
  },

  // Settings & show
  'settings.update'(a) {
    const s = this.show.settings;
    const v = a.settings || {};
    for (const k of ['artnet', 'sacn', 'enttec']) if (k in v) s[k] = !!v[k];
    for (const k of ['artnetTarget', 'sacnInterface', 'sacnUnicast', 'enttecPort', 'sourceName']) if (k in v) s[k] = String(v[k]).trim();
    if ('artnetBase' in v) s.artnetBase = num(v.artnetBase, 'Art-Net base') ? 1 : 0;
    if ('sacnPriority' in v) s.sacnPriority = Math.max(0, Math.min(200, Math.floor(num(v.sacnPriority, 'Priority'))));
    if ('enttecUniverse' in v) s.enttecUniverse = Math.max(1, Math.floor(num(v.enttecUniverse, 'Universe')));
    if ('midiInput' in v) s.midiInput = String(v.midiInput);
    if ('midiOutput' in v) s.midiOutput = String(v.midiOutput);
    if ('midiChannel' in v) s.midiChannel = Math.max(0, Math.min(16, Math.floor(num(v.midiChannel, 'MIDI channel'))));
    if ('noteBase' in v) s.noteBase = Math.max(0, Math.min(127, Math.floor(num(v.noteBase, 'Note'))));
    if ('pcSelectsSong' in v) s.pcSelectsSong = !!v.pcSelectsSong;
    if (v.pp && typeof v.pp === 'object') {
      const pp = { ...s.pp };
      if ('enabled' in v.pp) pp.enabled = !!v.pp.enabled;
      if ('host' in v.pp) pp.host = String(v.pp.host).trim().replace(/^https?:\/\//, '').replace(/[/:].*$/, '').slice(0, 100);
      if ('port' in v.pp) pp.port = Math.max(1, Math.min(65535, Math.floor(num(v.pp.port, 'Port'))));
      if ('sections' in v.pp) pp.sections = !!v.pp.sections;
      if ('songs' in v.pp) pp.songs = !!v.pp.songs;
      if ('colorMode' in v.pp) pp.colorMode = ['off', 'group', 'slide'].includes(v.pp.colorMode) ? v.pp.colorMode : 'off';
      if ('colorTarget' in v.pp) pp.colorTarget = v.pp.colorTarget === 'groups' ? 'groups' : 'primary';
      if ('colorGroups' in v.pp) pp.colorGroups = (Array.isArray(v.pp.colorGroups) ? v.pp.colorGroups : []).filter((id) => this.show.groups.some((g) => g.id === id));
      s.pp = pp;
    }
    if (v.osc && typeof v.osc === 'object') {
      const o = { ...(s.osc || { enabled: true, port: 8000 }) };
      if ('enabled' in v.osc) o.enabled = !!v.osc.enabled;
      if ('port' in v.osc) o.port = Math.max(1024, Math.min(65535, Math.floor(num(v.osc.port, 'OSC port'))));
      s.osc = o;
    }
    if ('screenProtect' in v) s.screenProtect = ['off', 'warn', 'block'].includes(v.screenProtect) ? v.screenProtect : 'warn';
    if ('fps' in v) s.fps = Math.max(10, Math.min(44, Math.floor(num(v.fps, 'Frame rate'))));
    if ('name' in a) this.show.name = String(a.name).slice(0, 80);
    return { show: true };
  },
  'show.load'(a) {
    const s = a.show;
    if (!s || !Array.isArray(s.fixtures) || !Array.isArray(s.cues)) throw new Error('That file is not a show file');
    const cid = this.show.settings.cid;
    this.loadShow({ ...s, settings: { ...s.settings, cid } });
    return { show: true };
  },
  'show.new'(a) {
    const cid = this.show.settings.cid;
    const settings = { ...this.show.settings, cid };
    this.loadShow(a.demo ? { ...demoShow(), settings } : { ...emptyShow(), settings });
    return { show: true };
  },
};

module.exports = { Engine, emptyShow, demoShow, defaultSettings };
