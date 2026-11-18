'use strict';
// Actions – Aiming moving heads at a point on stage (tap it in the 3D view), and focus points:
// position presets that store the PLACE (e.g. the pulpit) instead of pan/tilt numbers, so they stay
// right when a light is moved or re-hung. Each action runs with `this` = the engine.
const Geom = require('../../../public/geom');
const { uid, round4, num } = require('../util');

const point = (p) => {
  if (!p || typeof p !== 'object') throw new Error('Tap a point on the stage');
  return { x: num(p.x, 'x'), y: num(p.y, 'y'), z: num(p.z, 'z') };
};

module.exports = {
  methods: {
    // pan/tilt that point fixture `fid` at `target` (cached per placement and target)
    aimValues(fid, target) {
      const fx = this.fixtureMap.get(fid);
      if (!fx || !fx.prof.attrs.includes('pan') || !fx.prof.attrs.includes('tilt')) return null;
      const { pos, aim } = Geom.placement(fx.fixture, this.show.stage3d.stage);
      const key = JSON.stringify([fid, pos, aim, target]);
      this.aimCache = this.aimCache || new Map();
      let v = this.aimCache.get(key);
      if (!v) {
        v = Geom.aimAt(pos, aim, target);
        if (this.aimCache.size > 2000) this.aimCache.clear();
        this.aimCache.set(key, v);
      }
      return v;
    },
  },

  actions: {
    // Point the selected moving heads at a place: { fixtures, point: {x,y,z} (metres), height }
    // height: added to the point's height (e.g. 1.2 m for a person standing there)
    'prog.aim'(a) {
      const target = point(a.point);
      target.y = round4(target.y + (Number(a.height) || 0));
      const fids = (Array.isArray(a.fixtures) ? a.fixtures : []).filter((id) => this.fixtureMap.has(id));
      let aimed = 0, worst = 0;
      for (const fid of fids) {
        const v = this.aimValues(fid, target);
        if (!v) continue;
        const p = (this.programmer[fid] ||= {});
        p.pan = round4(v.pan);
        p.tilt = round4(v.tilt);
        if (this.progRefs[fid]) { delete this.progRefs[fid].pan; delete this.progRefs[fid].tilt; }
        aimed++;
        worst = Math.max(worst, v.errorDeg);
      }
      if (!aimed) throw new Error('Select moving heads first (lights with pan and tilt)');
      this.lastResult = { aimed, worstErrorDeg: worst, point: target };
    },

    // Save a focus point (a position preset that aims at a place) and apply it to the lights:
    // { name, point, height, fixtures, id (to move an existing focus point) }
    'preset.focus'(a) {
      const target = point(a.point);
      target.y = round4(target.y + (Number(a.height) || 0));
      let preset = a.id && this.show.presets.find((x) => x.id === a.id);
      if (preset) {
        preset.target = target;
      } else {
        preset = { id: uid(), kind: 'position', name: String(a.name || '').trim().slice(0, 40) || `Focus ${this.show.presets.length + 1}`, values: {}, universal: {}, target };
        this.show.presets.push(preset);
      }
      this.aimCache = null;
      // Linked like any preset: looks and cues using it follow when the point (or a light) moves
      const fids = (Array.isArray(a.fixtures) ? a.fixtures : []).filter((id) => this.fixtureMap.has(id));
      if (fids.length) this.actions['preset.apply'].call(this, { id: preset.id, fixtures: fids });
      this.lastResult = { id: preset.id, name: preset.name };
      return { show: true };
    },
  },
};
