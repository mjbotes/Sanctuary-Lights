'use strict';
// Engine methods – DMX rendering and the state sent to screens / saved between restarts.
const { displayColor } = require('../profiles');
const { clamp01, round4 } = require('./util');

module.exports = {

  // ----- DMX rendering ----------------------------------------------------
  render(look) {
    const universes = new Map();
    const master = this.rt.blackout ? 0 : this.rt.gm;
    for (const [fid, { fixture, prof }] of this.fixtureMap) {
      const vals = look[fid];
      if (!vals) continue;
      let data = universes.get(fixture.universe);
      if (!data) universes.set(fixture.universe, (data = new Uint8Array(512)));
      const dimEff = prof.curveFn(clamp01((vals.dim ?? 0) * this.masterFor(fid, master)));
      prof.channels.forEach((ch, i) => {
        const idx = fixture.address - 1 + i;
        if (idx < 0 || idx >= 512) return;
        if (ch.fixed !== undefined) {
          data[idx] = ch.fixed;
          return;
        }
        let v;
        if (ch.attr === 'dim') v = dimEff;
        else if (!prof.hasDimChannel && prof.additive.includes(ch.attr)) v = (vals[ch.attr] ?? 0) * dimEff; // virtual dimmer
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
  },


  liveState(look) {
    const master = this.rt.blackout ? 0 : this.rt.gm;
    const fixtures = {};
    for (const [fid, { prof }] of this.fixtureMap) {
      const vals = look[fid];
      const m = this.masterFor(fid, master);
      const c = displayColor({ ...vals, dim: (vals.dim ?? 0) * m }, prof);
      const o = { c, d: round4((vals.dim ?? 0) * m) };
      if ('pan' in vals) o.p = round4(vals.pan);
      if ('tilt' in vals) o.t = round4(vals.tilt);
      if ('zoom' in vals) o.z = round4(vals.zoom);
      if (this.blocked && this.blocked.has(fid)) o.x = 1; // would hit a screen
      fixtures[fid] = o;
    }
    const now = Date.now();
    const f = this.cueFade;
    return {
      fixtures,
      cueProgress: f && f.dur > 0 ? clamp01((now - f.start) / f.dur) : 1,
      sceneLevels: Object.fromEntries(Object.entries(this.rt.sceneLevels).map(([k, v]) => [k, round4(v)])),
      tc: this.rt.tc ? { s: round4(this.rt.tc.seconds), fps: this.rt.tc.fps, running: this.rt.tc.running && Date.now() - this.rt.tc.at < 1000 } : null,
      beat: round4((((Date.now() - this.rt.beatT0) / (60000 / this.rt.bpm)) % 1 + 1) % 1),
    };
  },


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
      running: this.rt.running,
      padsOn: this.rt.padsOn,
      strobe: this.rt.strobe,
      flashAll: this.rt.flashAll,
      progRefs: this.progRefs,
      tricks: this.rt.tricks,
      transport: this.rt.transport,
      playhead: this.rt.playhead,
      audioHost: this.rt.audioHost,
      vocal: this.rt.vocal,
      pp: this.rt.pp,
      palette: this.paletteNow(),
      paletteSource: this.paletteSource(),
      paletteLive: this.rt.paletteLive,
      lastOsc: this.rt.lastOsc,
      bpm: Math.round(this.rt.bpm * 10) / 10,
      clock: this.rt.clock,
      gm: this.rt.gm,
      blackout: this.rt.blackout,
      programmer: this.programmer,
      sceneLevels: this.rt.sceneLevels,
    };
  },


  persistentRuntime() {
    const { cueIndex, gm, sceneLevels, base, songId, sectionId, mode, bpm, tricks, vocal } = this.rt; // kept between restarts
    const busk = Object.fromEntries(Object.entries(this.rt.busk).map(([k, b]) => [k, { level: b.level, color: b.color, fx: b.fx }]));
    return { cueIndex, gm, sceneLevels, base, songId, sectionId, mode, busk, bpm, tricks, vocal };
  },
};
