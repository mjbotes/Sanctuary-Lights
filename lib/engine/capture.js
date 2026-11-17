'use strict';
// Engine methods – Recording: what is on stage, preset links, scene colours.
const { displayColor } = require('../profiles');
const { round4 } = require('./util');

module.exports = {

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
  },


  captureStage() {
    const look = this.computeLook(Date.now(), { live: false });
    const values = {};
    for (const [fid, { prof }] of this.fixtureMap) {
      const diff = {};
      for (const [a, v] of Object.entries(look[fid])) if (Math.abs(v - prof.defaults[a]) > 0.0005) diff[a] = round4(v);
      if (Object.keys(diff).length) values[fid] = diff;
    }
    return values;
  },


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
  },
};
