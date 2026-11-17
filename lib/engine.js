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
    cid: crypto.randomBytes(16).toString('hex'),
  };
}

function emptyShow() {
  return { version: 1, name: 'My Church', settings: defaultSettings(), profiles: {}, fixtures: [], groups: [], cues: [], scenes: [] };
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
    const cueIndex = Number.isInteger(runtime.cueIndex) ? runtime.cueIndex : -1;
    this.rt = {
      cueIndex: cueIndex < this.show.cues.length ? cueIndex : -1,
      sceneLevels: {},
      sceneOrder: {},
      gm: typeof runtime.gm === 'number' ? clamp01(runtime.gm) : 1,
      blackout: false,
    };
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

  cueTarget(index) {
    const look = this.defaultsLook();
    const cue = this.show.cues[index];
    if (!cue) return look;
    for (const [fid, vals] of Object.entries(cue.values || {})) {
      if (!look[fid]) continue;
      for (const [a, v] of Object.entries(vals)) if (a in look[fid]) look[fid][a] = v;
    }
    return look;
  }

  cueLayer(now) {
    const target = this.cueTarget(this.rt.cueIndex);
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
  computeLook(now = Date.now()) {
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
    for (const [fid, vals] of Object.entries(this.programmer)) {
      const cur = look[fid];
      if (!cur) continue;
      for (const [a, v] of Object.entries(vals)) if (a in cur) cur[a] = v;
    }
    return look;
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
      fixtures[fid] = { c, d: round4(vals.dim ?? 0) };
    }
    const now = Date.now();
    const f = this.cueFade;
    return {
      fixtures,
      cueProgress: f && f.dur > 0 ? clamp01((now - f.start) / f.dur) : 1,
      sceneLevels: Object.fromEntries(Object.entries(this.rt.sceneLevels).map(([k, v]) => [k, round4(v)])),
    };
  }

  runtimeState() {
    return {
      cueIndex: this.rt.cueIndex,
      gm: this.rt.gm,
      blackout: this.rt.blackout,
      programmer: this.programmer,
      sceneLevels: this.rt.sceneLevels,
    };
  }

  persistentRuntime() {
    return { cueIndex: this.rt.cueIndex, gm: this.rt.gm, sceneLevels: this.rt.sceneLevels };
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

  gotoCue(index, fadeSec) {
    const now = Date.now();
    const from = this.cueLayer(now);
    this.rt.cueIndex = index;
    const cue = this.show.cues[index];
    const sec = fadeSec ?? (cue ? cue.fade : 2);
    this.cueFade = sec > 0 ? { from, start: now, dur: sec * 1000 } : null;
  }

  // Capture what is on stage (before grand master) as compact cue values.
  captureStage() {
    const look = this.computeLook();
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
      const p = (this.programmer[fid] ||= {});
      const has = (x) => fx.prof.attrs.includes(x);
      let w = 0;
      if (has('white') && a.extractWhite !== false) w = Math.min(r, g, b);
      if (has('red')) p.red = round4(r - w);
      if (has('green')) p.green = round4(g - w);
      if (has('blue')) p.blue = round4(b - w);
      if (has('white')) p.white = round4(w);
      if (has('amber')) p.amber = 0;
      if (has('uv')) p.uv = 0;
      if (!has('red') && !has('green') && !has('blue') && has('white')) p.white = Math.max(r, g, b);
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
    const cue = { id: uid(), name: String(a.name || '').trim() || `Cue ${this.show.cues.length + 1}`, fade: 3, notes: '', values: this.captureStage() };
    const at = this.rt.cueIndex + 1;
    this.show.cues.splice(at, 0, cue);
    this.rt.cueIndex = at;
    this.cueFade = null;
    this.programmer = {};
    return { show: true };
  },
  'cue.update'() {
    const cue = this.show.cues[this.rt.cueIndex];
    if (!cue) throw new Error('No current cue to update');
    cue.values = this.captureStage();
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
    for (const list of [this.show.cues, this.show.scenes]) for (const c of list) for (const id of del) delete c.values[id];
    for (const id of del) delete this.programmer[id];
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
