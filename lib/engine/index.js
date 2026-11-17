'use strict';
// Sanctuary Lights engine: show data, playback, mixing and DMX rendering.
const { EventEmitter } = require('events');
const { BUILTIN_PROFILES, compileProfile } = require('../profiles');
const { clamp01 } = require('./util');
const { defaultPads, normalizeSong, VOCAL_DEFAULT, mergeVocal, normPalette, emptyShow, demoShow, defaultSettings } = require('./defaults');

// The lighting engine. State lives in two places:
//   this.show  - the saved show (patch, cues, songs, looks, settings...)
//   this.rt    - runtime state (what is playing now, live changes, tempo...)
// Every change goes through dispatch(action); actions live in ./actions/*.js
// and the engine's methods are split by topic into the mixin files listed below.
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
  // Use another version of the show (undo, snapshots) but keep what is playing and live changes.
  replaceShow(show) {
    const keep = { programmer: this.programmer, progRefs: this.progRefs, rt: this.rt };
    this.loadShow(show, this.persistentRuntime());
    const songs = new Set(this.show.songs.map((x) => x.id));
    const groups = new Set(this.show.groups.map((x) => x.id));
    this.programmer = Object.fromEntries(Object.entries(keep.programmer).filter(([fid]) => this.fixtureMap.has(fid)));
    this.progRefs = Object.fromEntries(Object.entries(keep.progRefs).filter(([fid]) => this.fixtureMap.has(fid)));
    for (const k of ['running', 'livePresets', 'padFlash', 'padsOn', 'strobe', 'flashAll', 'bpm', 'beatT0', 'clock', 'vocal', 'transport', 'playhead', 'audioHost', 'tricks', 'paletteLive', 'blackout', 'hold', 'mode']) this.rt[k] = keep.rt[k];
    this.rt.busk = Object.fromEntries(Object.entries(keep.rt.busk).filter(([gid]) => groups.has(gid)));
    if (!songs.has(this.rt.songId)) this.rt.songId = null;
  }

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


  // ----- actions ----------------------------------------------------------
  // Returns { show: bool, runtime: bool } describing what changed.
  dispatch(action) {
    const fn = this.actions[action && action.type];
    if (!fn) throw new Error(`Unknown action ${action && action.type}`);
    const res = fn.call(this, action) || {};
    if (res.show) this.compile();
    return { show: !!res.show, runtime: res.runtime !== false };
  }
}

Object.assign(
  Engine.prototype,
  require('./looks'),
  require('./live'),
  require('./state'),
  require('./playback'),
  require('./tricks'),
  require('./screens'),
  require('./triggers'),
  require('./capture'),
  require('./patch'),
);

// All actions, by name ('cue.go', 'song.select', ...)
const ACTIONS = Object.assign(
  {},
  require('./actions/programmer'),
  require('./actions/cues'),
  require('./actions/scenes'),
  require('./actions/looks'),
  require('./actions/songs'),
  require('./actions/tracks'),
  require('./actions/propresenter'),
  require('./actions/palette'),
  require('./actions/osc'),
  require('./actions/live'),
  require('./actions/presets'),
  require('./actions/effects'),
  require('./actions/pads'),
  require('./actions/patch'),
  require('./actions/show'),
);
Engine.prototype.actions = ACTIONS;

module.exports = { Engine, emptyShow, demoShow, defaultSettings };
