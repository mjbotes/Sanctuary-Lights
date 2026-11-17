'use strict';
// Engine methods – Selection tricks: order, steps, spreads, per-light timing.
const FX = require('../../public/fxmath');
const Geom = require('../../public/geom');
const { round4, ids } = require('./util');

module.exports = {

  // ----- selection tricks ------------------------------------------------------
  // 3D position (the same defaults the 3D view uses for lights not placed yet).
  stagePos(fid) {
    const fx = this.fixtureMap.get(fid);
    if (!fx) return { x: 0, y: 0, z: 0 };
    return Geom.placement(fx.fixture, this.show.stage3d.stage).pos;
  },


  // Spread value From -> To for a light in a trick layout (by step, or by real distance).
  spreadFor(from, to, item, full = false) {
    if (item.f === undefined) return FX.spread(from, to, item.k, item.m, full);
    if (!FX.hasValue(from) && !FX.hasValue(to)) return null;
    const a = FX.hasValue(from) ? Number(from) : Number(to);
    const b = FX.hasValue(to) ? Number(to) : Number(from);
    const f = full && item.m > 1 ? item.f * (item.m - 1) / item.m : item.f;
    return a + (b - a) * f;
  },


  tricksUsed(t = this.rt.tricks) {
    return !!t && t.active !== false && Object.entries(t).some(([k, v]) => k !== 'active' && (k === 'order' ? v && v !== 'tap' : FX.hasValue(v)));
  },


  // Lights in trick order with their step: [{ fid, k, m }]
  trickLayout(ids, t = this.rt.tricks) {
    const list = ids.filter((id) => this.fixtureMap.has(id));
    if (!this.tricksUsed(t)) return list.map((fid, i) => ({ fid, k: i, m: list.length }));
    const posOf = (id) => this.stagePos(id);
    const ordered = FX.trickOrder(list, t, posOf);
    const steps = FX.trickSteps(ordered.length, t);
    const fr = FX.trickFractions(ordered, t, posOf);
    return ordered.map((fid, i) => ({ fid, ...steps[i], ...(fr ? { f: fr[i] } : {}) }));
  },


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
  },
};
