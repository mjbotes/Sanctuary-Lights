'use strict';
// Engine methods – Building the look: cue/look base layer with fades, presets and palette, scenes, programmer.
const FX = require('../../public/fxmath');
const { clamp01, lerp, ease, colorValues, isHex, palIndex } = require('./util');
const { PRESET_ATTRS, PAL_NAMES } = require('./defaults');

module.exports = {

  // ----- looks ------------------------------------------------------------
  defaultsLook() {
    const look = {};
    for (const [id, { prof }] of this.fixtureMap) look[id] = { ...prof.defaults };
    return look;
  },


  // Values of whatever drives the base layer: the cue list or a song look.
  baseValues() {
    if (this.rt.base.kind === 'look') {
      const look = this.show.looks.find((l) => l.id === this.rt.base.lookId);
      return look ? look.values : {};
    }
    return this.cueState(this.rt.cueIndex).values;
  },

  // A cue's values and preset links. In a tracking cue list, each cue only holds what it changes:
  // everything else carries on from the cues before it (back to a cue marked "block").
  cueState(index) {
    const cues = this.show.cues;
    if (!cues[index]) return { values: {}, refs: {} };
    if (!this.show.settings.tracking) return { values: cues[index].values || {}, refs: cues[index].refs || {} };
    let start = index;
    while (start > 0 && !cues[start].block) start--;
    const values = {}, refs = {};
    for (let i = start; i <= index; i++) {
      for (const [fid, v] of Object.entries(cues[i].values || {})) {
        values[fid] = { ...values[fid], ...v };
        if (refs[fid]) for (const a of Object.keys(v)) delete refs[fid][a]; // a plain value replaces an older preset link
      }
      for (const [fid, r] of Object.entries(cues[i].refs || {})) refs[fid] = { ...refs[fid], ...r };
    }
    return { values, refs };
  },


  baseTarget() {
    const look = this.defaultsLook();
    for (const [fid, vals] of Object.entries(this.baseValues() || {})) {
      if (!look[fid]) continue;
      for (const [a, v] of Object.entries(vals)) if (a in look[fid]) look[fid][a] = v;
    }
    this.applyRefs(look, this.baseRefs());
    return look;
  },


  baseRefs() {
    if (this.rt.base.kind !== 'look') return this.cueState(this.rt.cueIndex).refs;
    const src = this.show.looks.find((x) => x.id === this.rt.base.lookId);
    return (src && src.refs) || {};
  },


  // ----- palette -------------------------------------------------------------------
  paletteSource() {
    const song = this.show.songs.find((x) => x.id === this.rt.songId);
    return song && song.palette ? 'song' : 'show';
  },

  paletteNow() {
    const song = this.show.songs.find((x) => x.id === this.rt.songId);
    const base = (song && song.palette) || this.show.palette;
    return base.map((c, i) => this.rt.paletteLive[i] || c);
  },

  palRgb(i) {
    return FX.hexToRgb(this.paletteNow()[i] || '#ffffff');
  },

  // Colour token -> rgb 0..1: '#rrggbb', 'pal:1'..'pal:3', or [r,g,b]
  colorRgb(c) {
    if (Array.isArray(c)) return c;
    const i = palIndex(c);
    if (i >= 0) return this.palRgb(i);
    return FX.hexToRgb(isHex(c) ? c : '#ffffff');
  },

  // Presets, including the three built-in palette presets 'pal:1'..'pal:3' (always there)
  getPreset(pid) {
    const i = palIndex(pid);
    if (i >= 0 && String(pid).startsWith('pal:')) return { id: pid, kind: 'color', name: PAL_NAMES[i], palette: i };
    return this.show.presets.find((x) => x.id === pid);
  },


  presetValue(preset, fid, attr) {
    if (preset.palette !== undefined) {
      const fx = this.fixtureMap.get(fid);
      if (!fx || !fx.prof.colorAttrs.length) return undefined;
      return colorValues(fx.prof, this.palRgb(preset.palette))[attr];
    }
    const own = preset.values && preset.values[fid];
    if (own && attr in own) return own[attr];
    return preset.universal ? preset.universal[attr] : undefined;
  },


  // refs: { fixtureId: { attr: presetId } } -> use the preset's current value
  applyRefs(look, refs) {
    for (const [fid, attrs] of Object.entries(refs || {})) {
      if (!look[fid]) continue;
      for (const [a, pid] of Object.entries(attrs)) {
        const preset = this.getPreset(pid);
        const v = preset && this.presetValue(preset, fid, a);
        if (v !== undefined && a in look[fid]) look[fid][a] = v;
      }
    }
  },


  applyPresetTo(look, preset, fids) {
    for (const fid of fids) {
      const cur = look[fid];
      if (!cur) continue;
      for (const a of Object.keys(cur)) {
        if (!PRESET_ATTRS[preset.kind](a)) continue;
        const v = this.presetValue(preset, fid, a);
        if (v !== undefined) cur[a] = v;
      }
    }
  },


  cueLayer(now) {
    const target = this.baseTarget();
    const f = this.cueFade;
    if (!f) return target;
    const elapsed = now - f.start;
    if (elapsed >= f.dur) {
      this.cueFade = null;
      return target;
    }
    // Cue delay, then fade. Intensity going down uses the fade-down time (if the cue has one).
    const t = elapsed - (f.delay || 0);
    const kUp = t <= 0 ? 0 : ease(f.base > 0 ? clamp01(t / f.base) : 1);
    const down = f.down ?? f.base;
    const kDown = t <= 0 ? 0 : ease(down > 0 ? clamp01(t / down) : 1);
    for (const [fid, vals] of Object.entries(target)) {
      const from = f.from[fid];
      if (!from) continue;
      const tm = f.timing && f.timing[fid];
      let kTm = null;
      if (tm) {
        const local = t - (tm.delay || 0) * 1000;
        const fadeMs = tm.fade === undefined ? f.base : tm.fade * 1000;
        kTm = local <= 0 ? 0 : fadeMs > 0 ? ease(clamp01(local / fadeMs)) : 1;
      }
      for (const a of Object.keys(vals)) {
        if (!(a in from)) continue;
        const k = kTm ?? (a === 'dim' && vals[a] < from[a] ? kDown : kUp);
        vals[a] = lerp(from[a], vals[a], k);
      }
    }
    return target;
  },


  baseSource() {
    return this.rt.base.kind === 'look' ? this.show.looks.find((x) => x.id === this.rt.base.lookId) : this.show.cues[this.rt.cueIndex];
  },


  updateSceneFades(now) {
    for (const [id, f] of Object.entries(this.sceneFades)) {
      const t = f.dur > 0 ? clamp01((now - f.start) / f.dur) : 1;
      this.setSceneLevel(id, lerp(f.from, f.to, ease(t)), true);
      if (t >= 1) delete this.sceneFades[id];
    }
  },


  // Full look before grand master / blackout.
  // opts.live = false leaves out live trims (group faders, effects, flash), e.g. when recording.
  computeLook(now = Date.now(), opts = {}) {
    // Auto-follow: the next cue goes by itself
    if (this.rt.followAt && now >= this.rt.followAt) {
      this.rt.followAt = null;
      if (this.rt.base.kind === 'cue' && this.rt.cueIndex < this.show.cues.length - 1) {
        this.gotoCue(this.rt.cueIndex + 1);
        this.emit('changed');
      }
    }
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
    // Presets switched on from pads (recorded like live colours).
    for (const lp of Object.values(this.rt.livePresets)) {
      const preset = this.getPreset(lp.presetId);
      if (preset) this.applyPresetTo(look, preset, this.fixturesOf(lp));
    }
    // Live group colours are part of the look (they get recorded).
    for (const g of this.show.groups) {
      const b = this.rt.busk[g.id];
      if (!b || !b.color) continue;
      for (const fid of g.fixtures) {
        const fx = this.fixtureMap.get(fid);
        if (fx && look[fid]) Object.assign(look[fid], colorValues(fx.prof, this.colorRgb(b.color)));
      }
    }
    for (const [fid, vals] of Object.entries(this.programmer)) {
      const cur = look[fid];
      if (!cur) continue;
      for (const [a, v] of Object.entries(vals)) if (a in cur) cur[a] = v;
    }
    // Values applied from presets stay linked while editing (e.g. change Primary -> the lights follow).
    this.applyRefs(look, this.progRefs);
    // Live effects and group faders work on top of everything, including the programmer.
    if (live) this.applyEffects(look, now);
    if (live) this.applyGroupLevels(look);
    if (live) {
      const full = (fids) => { for (const fid of fids) if (look[fid] && 'dim' in look[fid]) look[fid].dim = 1; };
      for (const g of this.show.groups) {
        const b = this.rt.busk[g.id];
        if (b && b.flash) full(g.fixtures);
      }
      for (const pf of Object.values(this.rt.padFlash)) full(this.fixturesOf(pf));
      if (this.rt.flashAll) full(Object.keys(look));
      // Screen protection: lights that would shine on a projector screen or LED wall
      const mode = this.show.settings.screenProtect || 'warn';
      this.blocked = mode === 'off' ? new Set() : this.screenHits(look);
      if (mode === 'block') for (const fid of this.blocked) look[fid].dim = 0;
    }
    return look;
  },
};
