'use strict';
// Engine methods – Projector screens / LED walls: which lights would shine on them.
const Geom = require('../../public/geom');

module.exports = {

  // ----- screens: lights must not shine on projector screens / LED walls ------------------
  beamAngle(fx, vals) {
    return fx.prof.attrs.includes('zoom') ? 8 + 42 * (vals.zoom ?? 0.5) : fx.fixture.beam || 25;
  },


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
  },
};
