'use strict';
// Defaults and data clean-up: settings, empty/demo show, pads, effects, songs, vocal, palette.
const crypto = require('crypto');
const FX = require('../../public/fxmath');
const { uid, isHex } = require('./util');


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


// Primary / secondary / tertiary colours. Each song can have its own.
const PALETTE_DEFAULT = ['#ffb070', '#2050ff', '#a020f0'];

const PAL_NAMES = ['Primary', 'Secondary', 'Tertiary'];

const normPalette = (p) => (Array.isArray(p) && p.length === 3 && p.every(isHex) ? p.map((c) => c.toLowerCase()) : null);


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

module.exports = { COLOR_SET, PRESET_ATTRS, defaultPads, cleanEffect, normalizeSong, VOCAL_DEFAULT, cloneVocal, mergeVocal, PALETTE_DEFAULT, PAL_NAMES, normPalette, defaultSettings, emptyShow, demoShow };
