'use strict';
// Actions – Building a look from a description (used by the MCP server, so an AI assistant can
// program looks in plain terms): "the back wash at 80% in the primary colour, pulsing; the front
// lights at 70% warm white". Each action runs with `this` = the engine.
const FX = require('../../../public/fxmath');
const { uid, nameKey, round4, colorValues, num } = require('../util');

const NAMED = {
  white: '#ffffff', 'warm white': '#ffd69e', warm: '#ffd69e', 'cool white': '#dfe8ff', cool: '#dfe8ff',
  red: '#ff0000', orange: '#ff7a00', amber: '#ffb000', gold: '#ffb347', yellow: '#ffe000', green: '#00d040',
  teal: '#00c0a0', cyan: '#00e0ff', blue: '#0040ff', 'deep blue': '#1020a0', purple: '#8020ff', violet: '#5a2ad0',
  magenta: '#ff00c0', pink: '#ff60a0', uv: '#4000ff',
};
const PAL = { primary: 1, p: 1, secondary: 2, s: 2, tertiary: 3, t: 3 };

module.exports = {
  NAMED,

  // Which lights a description means: group names, roles (front, back, movers, house, special,
  // haze), "all", or light names; a string or a list; case does not matter.
  resolveLights(spec) {
    const roles = this.rigRoles();
    const out = new Set();
    const unknown = [];
    for (const raw of Array.isArray(spec) ? spec : [spec]) {
      const k = nameKey(raw);
      if (!k) continue;
      if (k === 'all' || k === 'everything') { for (const f of this.show.fixtures) out.add(f.id); continue; }
      const role = roles[k] || roles[k.replace(/s$/, '')] || (k === 'movingheads' ? roles.movers : null);
      if (role) { role.forEach((id) => out.add(id)); continue; }
      const g = this.show.groups.find((x) => nameKey(x.name) === k);
      if (g) { g.fixtures.forEach((id) => out.add(id)); continue; }
      const fs = this.show.fixtures.filter((f) => nameKey(f.name) === k || nameKey(f.name).startsWith(k));
      if (fs.length) { fs.forEach((f) => out.add(f.id)); continue; }
      unknown.push(String(raw));
    }
    if (unknown.length) throw new Error(`Unknown lights: ${unknown.join(', ')}. Use group names, light names, or front / back / movers / house / all.`);
    return [...out].filter((id) => this.fixtureMap.has(id));
  },

  // An effect by id or name ("pulse", "Palette chase")
  findEffect(name) {
    const k = nameKey(name);
    const all = [...FX.BUILTIN, ...(this.show.effects || [])];
    const e = all.find((x) => nameKey(x.id) === k) || all.find((x) => nameKey(x.name) === k) || all.find((x) => nameKey(x.name).startsWith(k));
    if (!e) throw new Error(`Unknown effect "${name}". Effects: ${all.map((x) => x.name).join(', ')}`);
    return e;
  },

  // Set a song's sections to this order of names, keeping all the lighting (see library.js)
  'song.arrange'(a) {
    const song = this.show.songs[this.findIndex(this.show.songs, a.id)];
    const names = (Array.isArray(a.sections) ? a.sections : []).map((n) => String(n || '').trim().slice(0, 40)).filter(Boolean);
    if (!names.length) throw new Error('Give the sections in order');
    this.applyArrangement(song, names);
    return { show: true };
  },

  // look.compose { name, start: 'dark' | 'current' | <look name>, parts: [{ lights, intensity 0-100,
  //   color: '#rrggbb' | 'primary' | 'secondary' | 'tertiary' | a colour name, pan, tilt, zoom 0-100,
  //   effect, effect_speed (0.25-4), effect_size 0-100 }], show: bool }
  'look.compose'(a) {
    const name = String(a.name || '').trim().slice(0, 60);
    if (!name) throw new Error('Give the look a name');
    let look = this.show.looks.find((l) => nameKey(l.name) === nameKey(name));
    const startName = String(a.start || 'dark');
    const base = startName === 'dark' ? null
      : startName === 'current' ? look
        : this.show.looks.find((l) => nameKey(l.name) === nameKey(startName));
    if (startName !== 'dark' && startName !== 'current' && !base) throw new Error(`No look called "${startName}"`);
    const values = JSON.parse(JSON.stringify((base && base.values) || {}));
    const refs = JSON.parse(JSON.stringify((base && base.refs) || {}));
    const effects = JSON.parse(JSON.stringify((base && base.effects) || []));
    const parts = Array.isArray(a.parts) ? a.parts.slice(0, 40) : [];
    if (!parts.length && !base) throw new Error('Say what the lights should do (parts)');
    for (const p of parts) {
      const ids = this.resolveLights(p.lights);
      for (const fid of ids) {
        const prof = this.fixtureMap.get(fid).prof;
        const v = (values[fid] ||= {});
        const has = (attr) => prof.attrs.includes(attr);
        if (p.intensity !== undefined && has('dim')) v.dim = round4(Math.max(0, Math.min(100, num(p.intensity, 'Intensity'))) / 100);
        if (p.intensity !== undefined && !has('dim') && prof.colorAttrs.length && Number(p.intensity) === 0) for (const c of prof.colorAttrs) v[c] = 0;
        for (const attr of ['pan', 'tilt', 'zoom']) if (p[attr] !== undefined && has(attr)) v[attr] = round4(Math.max(0, Math.min(100, num(p[attr], attr))) / 100);
        if (p.color !== undefined && p.color !== null && prof.colorAttrs.length) {
          const c = String(p.color).trim().toLowerCase();
          const slot = PAL[c];
          const hex = slot ? this.paletteNow()[slot - 1] : /^#[0-9a-f]{6}$/.test(c) ? c : NAMED[c];
          if (!hex) throw new Error(`Unknown colour "${p.color}". Use #rrggbb, primary / secondary / tertiary, or: ${Object.keys(NAMED).join(', ')}`);
          const cv = colorValues(prof, FX.hexToRgb(hex));
          for (const [k, x] of Object.entries(cv)) v[k] = round4(x);
          if (refs[fid]) for (const k of Object.keys(cv)) delete refs[fid][k];
          if (slot) for (const k of Object.keys(cv)) (refs[fid] ||= {})[k] = `pal:${slot}`;
        }
      }
      if (p.effect) {
        const e = this.findEffect(p.effect);
        // One effect per set of lights: replace an effect on exactly these lights
        const key = [...ids].sort().join(',');
        const i = effects.findIndex((x) => x.fixtures && [...x.fixtures].sort().join(',') === key);
        const inst = { effectId: e.id, fixtures: ids, rate: Math.max(0.125, Math.min(8, Number(p.effect_speed) || 1)), size: p.effect_size === undefined ? 1 : Math.max(0, Math.min(1, Number(p.effect_size) / 100)) };
        if (i >= 0) effects[i] = inst; else effects.push(inst);
      } else if (p.effect === null || p.effect === 'none' || p.effect === '') {
        const key = [...ids].sort().join(',');
        for (let i = effects.length - 1; i >= 0; i--) if (effects[i].fixtures && [...effects[i].fixtures].sort().join(',') === key) effects.splice(i, 1);
      }
    }
    if (!look) {
      look = { id: uid(), name };
      this.show.looks.push(look);
    }
    Object.assign(look, { values, refs, effects, timing: look.timing || {} });
    look.color = this.colorFor(values);
    if (a.show) this.actions['look.apply'].call(this, { id: look.id, fade: a.fade ?? 1 });
    this.lastResult = { look: look.name, id: look.id, lights: Object.keys(values).length, effects: effects.length };
    return { show: true };
  },
};
