'use strict';
// Actions – Programmer: setting lights by hand, value spreads, selection tricks. Each action runs with `this` = the engine; return { show: true } when the saved show changed.
const FX = require('../../../public/fxmath');
const { clamp01, round4, colorValues, num, ids } = require('../util');

module.exports = {
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
};
