'use strict';
// The lighting engine: show data, playback, mixing and DMX rendering.
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { BUILTIN_PROFILES, compileProfile, displayColor, parseChannels } = require('./profiles');

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
    midiChannel: 0,
    noteBase: 36,
    pcSelectsSong: true,
    cid: crypto.randomBytes(16).toString('hex'),
  };
}

function emptyShow() {
  return { version: 1, name: 'My Church', settings: defaultSettings(), profiles: {}, fixtures: [], groups: [], cues: [], scenes: [], looks: [], songs: [], stage3d: { stage: { w: 12, d: 6, h: 0.6 }, models: [] } };
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
    this.cueFade = null;
    this.sceneFades = {};
    this.compile();
    if (!this.show.stage3d || typeof this.show.stage3d !== 'object') this.show.stage3d = { stage: { w: 12, d: 6, h: 0.6 }, models: [] };
    for (const k of ['looks', 'songs']) if (!Array.isArray(this.show[k])) this.show[k] = [];
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
    return look;
  }

  cueLayer(now) {
    const target = this.baseTarget();
    const f = this.cueFade;
    if (!f) return target;
    const t = f.dur > 0 ? clamp01((now - f.start) / f.dur) : 1;
    if (t >= 1) {
      this.cueFade = null;
      return target;
    }
    const k = ease(t);
    for (const [fid, vals] of Object.entries(target)) {
      const from = f.from[fid];
      if (!from) continue;
      for (const a of Object.keys(vals)) if (a in from) vals[a] = lerp(from[a], vals[a], k);
    }
    return target;
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
    // Live group colours are part of the look (they get recorded).
    for (const g of this.show.groups) {
      const b = this.rt.busk[g.id];
      if (!b || !b.color) continue;
      for (const fid of g.fixtures) {
        const fx = this.fixtureMap.get(fid);
        if (fx && look[fid]) Object.assign(look[fid], colorValues(fx.prof, b.color));
      }
    }
    for (const [fid, vals] of Object.entries(this.programmer)) {
      const cur = look[fid];
      if (!cur) continue;
      for (const [a, v] of Object.entries(vals)) if (a in cur) cur[a] = v;
    }
    // Live effects and group faders work on top of everything, including the programmer.
    if (live) this.applyEffects(look, now);
    if (live) this.applyGroupLevels(look);
    if (live) {
      for (const g of this.show.groups) {
        const b = this.rt.busk[g.id];
        if (b && b.flash) for (const fid of g.fixtures) if (look[fid] && 'dim' in look[fid]) look[fid].dim = 1;
      }
    }
    return look;
  }

  // ----- live layer: effects and group faders --------------------------------
  activeEffects() {
    // Effects stored in the current cue/look, overridden per group by live choices.
    const out = new Map();
    let stored = [];
    if (this.rt.base.kind === 'look') {
      const l = this.show.looks.find((x) => x.id === this.rt.base.lookId);
      stored = (l && l.effects) || [];
    } else {
      const c = this.show.cues[this.rt.cueIndex];
      stored = (c && c.effects) || [];
    }
    for (const e of stored) out.set(e.groupId, e);
    for (const [gid, b] of Object.entries(this.rt.busk)) {
      if (b.fx === 'off') out.delete(gid);
      else if (b.fx) out.set(gid, { groupId: gid, ...b.fx });
    }
    return [...out.values()];
  }

  applyEffects(look, now) {
    const effects = this.activeEffects();
    if (!effects.length) return;
    const beatMs = 60000 / this.rt.bpm;
    for (const e of effects) {
      const g = this.show.groups.find((x) => x.id === e.groupId);
      if (!g) continue;
      const members = g.fixtures.filter((fid) => look[fid]);
      const n = members.length;
      if (!n) continue;
      const phase = ((now - this.rt.beatT0) / beatMs) * (e.rate || 1);
      const frac = phase - Math.floor(phase);
      members.forEach((fid, i) => {
        const v = look[fid];
        if (!('dim' in v)) return; // hazers etc.
        const prof = this.fixtureMap.get(fid).prof;
        if (e.type === 'pulse') {
          v.dim *= 0.25 + 0.75 * Math.pow(1 - frac, 2);
        } else if (e.type === 'chase') {
          const pos = ((phase % n) + n) % n;
          let d = Math.abs(pos - i);
          d = Math.min(d, n - d);
          v.dim *= Math.max(0, 1 - d);
        } else if (e.type === 'sparkle') {
          const beat = Math.floor(phase * 2);
          const r = Math.sin((beat + 1) * 12.9898 + i * 78.233) * 43758.5453;
          v.dim *= r - Math.floor(r) > 0.55 ? 1 : 0.1;
        } else if (e.type === 'rainbow' && prof.colorAttrs.length) {
          Object.assign(v, colorValues(prof, hsvToRgb((phase / 8 + i / n) % 1, 1, 1)));
        } else if (e.type === 'wave' && ('pan' in v || 'tilt' in v)) {
          if ('tilt' in v) v.tilt = clamp01(v.tilt + 0.08 * Math.sin((phase / 2 + i / n) * Math.PI * 2));
          if ('pan' in v) v.pan = clamp01(v.pan + 0.06 * Math.cos((phase / 2 + i / n) * Math.PI * 2));
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

  captureEffects() {
    return this.activeEffects().map(({ groupId, type, rate }) => ({ groupId, type, rate: rate || 1 }));
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
      bpm: Math.round(this.rt.bpm * 10) / 10,
      clock: this.rt.clock,
      gm: this.rt.gm,
      blackout: this.rt.blackout,
      programmer: this.programmer,
      sceneLevels: this.rt.sceneLevels,
    };
  }

  persistentRuntime() {
    const { cueIndex, gm, sceneLevels, base, songId, sectionId, mode, bpm } = this.rt;
    const busk = Object.fromEntries(Object.entries(this.rt.busk).map(([k, b]) => [k, { level: b.level, color: b.color, fx: b.fx }]));
    return { cueIndex, gm, sceneLevels, base, songId, sectionId, mode, busk, bpm };
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
    this.cueFade = fadeSec > 0 ? { from, start: now, dur: fadeSec * 1000 } : null;
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
      for (const [attr, v] of Object.entries(a.values || {})) if (fx.prof.attrs.includes(attr)) p[attr] = clamp01(num(v, attr));
    }
  },
  'prog.color'(a) {
    const [r, g, b] = (a.rgb || []).map((v) => clamp01(num(v, 'colour')));
    for (const fid of ids(a)) {
      const fx = this.fixtureMap.get(fid);
      if (!fx || !fx.prof.colorAttrs.length) continue;
      Object.assign((this.programmer[fid] ||= {}), colorValues(fx.prof, [r, g, b]));
    }
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
    if (Array.isArray(a.fixtures)) for (const fid of a.fixtures) delete this.programmer[fid];
    else this.programmer = {};
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
    const cue = { id: uid(), name: String(a.name || '').trim() || `Cue ${this.show.cues.length + 1}`, fade: 3, notes: '', values: this.captureStage(), effects: this.captureEffects() };
    const at = this.rt.cueIndex + 1;
    this.show.cues.splice(at, 0, cue);
    this.rt.cueIndex = at;
    this.rt.base = { kind: 'cue' };
    this.cueFade = null;
    this.programmer = {};
    return { show: true };
  },
  'cue.update'() {
    const cue = this.show.cues[this.rt.cueIndex];
    if (!cue) throw new Error('No current cue to update');
    cue.values = this.captureStage();
    cue.effects = this.captureEffects();
    this.rt.base = { kind: 'cue' };
    this.cueFade = null;
    this.programmer = {};
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
    const look = { id: uid(), name: String(a.name || '').trim() || `Look ${this.show.looks.length + 1}`, values, effects: this.captureEffects() };
    look.color = this.colorFor(values);
    this.show.looks.push(look);
    this.programmer = {};
    this.setBase({ kind: 'look', lookId: look.id }, 0);
    return { show: true };
  },
  'look.update'(a) {
    const look = this.show.looks[this.findIndex(this.show.looks, a.id)];
    look.values = this.captureStage();
    look.effects = this.captureEffects();
    look.color = this.colorFor(look.values);
    this.programmer = {};
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
    const song = { id: uid(), name: String(a.name || '').trim() || `Song ${this.show.songs.length + 1}`, notes: '', trigger: null, sections: [] };
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
    if (song.bpm && !this.rt.clock) this.rt.bpm = song.bpm;
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
    this.buskFor(a.groupId).color = a.rgb ? a.rgb.map((v) => clamp01(num(v, 'Colour'))) : null;
  },
  'busk.fx'(a) {
    this.findIndex(this.show.groups, a.groupId);
    const types = ['pulse', 'chase', 'sparkle', 'rainbow', 'wave'];
    let fx = null;
    if (a.fx === 'off') fx = 'off';
    else if (types.includes(a.fx)) fx = { type: a.fx, rate: [0.25, 0.5, 1, 2, 4].includes(Number(a.rate)) ? Number(a.rate) : 1 };
    this.buskFor(a.groupId).fx = fx;
  },
  'busk.flash'(a) {
    this.findIndex(this.show.groups, a.groupId);
    this.buskFor(a.groupId).flash = !!a.on;
  },
  'busk.release'(a) {
    if (a.groupId) delete this.rt.busk[a.groupId];
    else this.rt.busk = {};
  },
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
    if ('midiChannel' in v) s.midiChannel = Math.max(0, Math.min(16, Math.floor(num(v.midiChannel, 'MIDI channel'))));
    if ('noteBase' in v) s.noteBase = Math.max(0, Math.min(127, Math.floor(num(v.noteBase, 'Note'))));
    if ('pcSelectsSong' in v) s.pcSelectsSong = !!v.pcSelectsSong;
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
