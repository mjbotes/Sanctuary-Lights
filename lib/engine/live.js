'use strict';
// Engine methods – Live layer: effects, group faders, pads, live colours.
const FX = require('../../public/fxmath');
const { clamp01, lerp, round4, colorValues, rgbToHex, ids } = require('./util');

module.exports = {

  // ----- live layer: effects and group faders --------------------------------
  effectById(id) {
    return FX.BUILTIN.find((e) => e.id === id) || this.show.effects.find((e) => e.id === id);
  },


  fixturesOf(inst) {
    if (inst.groupId) {
      const g = this.show.groups.find((x) => x.id === inst.groupId);
      return g ? g.fixtures : [];
    }
    if (Array.isArray(inst.fixtures)) return inst.fixtures;
    return this.show.fixtures.map((f) => f.id); // "all"
  },


  // Every effect that should run now, in order (later ones win on the same attribute).
  activeEffects() {
    const out = new Map();
    const base = this.rt.base.kind === 'look' ? this.show.looks.find((x) => x.id === this.rt.base.lookId) : this.show.cues[this.rt.cueIndex];
    ((base && base.effects) || []).forEach((e, i) => {
      const effectId = e.effectId || e.type;
      out.set(e.groupId ? `g:${e.groupId}` : `stored:${i}`, { ...e, effectId });
    });
    for (const [gid, b] of Object.entries(this.rt.busk)) {
      if (b.fx === 'off') out.delete(`g:${gid}`);
      else if (b.fx) out.set(`g:${gid}`, { groupId: gid, effectId: b.fx.type, rate: b.fx.rate || 1, size: 1 });
    }
    for (const [key, inst] of Object.entries(this.rt.running)) out.set(`run:${key}`, inst);
    if (this.rt.strobe) out.set('strobe', { effectId: 'strobe', groupId: this.rt.strobe === true ? null : this.rt.strobe, rate: 1, size: 1 });
    return [...out.values()];
  },


  applyEffects(look, now) {
    const list = this.activeEffects();
    if (!list.length) return;
    const beats = (now - this.rt.beatT0) / (60000 / this.rt.bpm);
    const seconds = now / 1000;
    for (const inst of list) {
      const fx = this.effectById(inst.effectId);
      if (!fx) continue;
      let members = this.fixturesOf(inst).filter((fid) => look[fid]);
      const t = inst.tricks;
      let steps = null;
      if (t && this.tricksUsed(t)) {
        const lay = this.trickLayout(members, t);
        members = lay.map((x) => x.fid);
        steps = lay;
      }
      const n = members.length;
      if (!n) continue;
      const size = inst.size ?? 1;
      const cycles = FX.cyclesAt(fx, beats, seconds, inst.rate || 1);
      members.forEach((fid, i) => {
        const v = look[fid];
        const prof = this.fixtureMap.get(fid).prof;
        let ov;
        if (steps) {
          const { k, m } = steps[i];
          const item = steps[i];
          const pFrom = FX.hasValue(t.phaseFrom) || FX.hasValue(t.phaseTo) ? t.phaseFrom : fx.phaseFrom;
          const pTo = FX.hasValue(t.phaseFrom) || FX.hasValue(t.phaseTo) ? t.phaseTo : fx.phaseTo;
          const a = FX.hasValue(pFrom) ? Number(pFrom) : FX.hasValue(pTo) ? Number(pTo) : 0;
          const b = FX.hasValue(pTo) ? Number(pTo) : a;
          const full = b - a !== 0 && Math.abs(b - a) % 360 === 0;
          ov = { phase: this.spreadFor(a, b, item, full) / 360, slots: m, speed: this.spreadFor(t.speedFrom, t.speedTo, item) || undefined };
        }
        for (const { layer, w, value } of FX.evaluate(fx, i, n, cycles, ov)) {
          const a = layer.attr;
          if (a === 'hue' || a === 'color' || a === 'palette') {
            if (!prof.colorAttrs.length) continue;
            let rgb;
            if (a === 'hue') rgb = FX.hsvToRgb(((value % 1) + 1) % 1, 1, 1);
            else if (a === 'palette') {
              const x = ((value % 1) + 1) % 1 * 3;
              const i0 = Math.floor(x) % 3;
              const c0 = this.palRgb(i0), c1 = this.palRgb((i0 + 1) % 3);
              rgb = layer.smooth ? c0.map((c, k) => lerp(c, c1[k], x - Math.floor(x))) : c0;
            } else {
              const ca = this.colorRgb(layer.colorA), cb = this.colorRgb(layer.colorB);
              rgb = ca.map((c, k) => lerp(c, cb[k], w));
            }
            for (const [ca, cv] of Object.entries(colorValues(prof, rgb))) v[ca] = lerp(v[ca] ?? 0, cv, size);
            continue;
          }
          if (!(a in v)) continue;
          if (layer.mode === 'scale') v[a] *= lerp(1, value, size);
          else if (layer.mode === 'rel') v[a] = clamp01(v[a] + (w - 0.5) * ((layer.high ?? 1) - (layer.low ?? 0)) * size);
          else v[a] = lerp(v[a], value, size);
        }
      });
    }
  },


  applyGroupLevels(look) {
    for (const g of this.show.groups) {
      const b = this.rt.busk[g.id];
      if (!b || b.level >= 1) continue;
      for (const fid of g.fixtures) if (look[fid] && 'dim' in look[fid]) look[fid].dim *= b.level;
    }
  },


  // Effects saved with a cue or look: what is running now, except momentary ones.
  captureEffects() {
    const out = [];
    for (const [gid, b] of Object.entries(this.rt.busk)) if (b.fx && b.fx !== 'off') out.push({ groupId: gid, effectId: b.fx.type, rate: b.fx.rate || 1, size: 1 });
    for (const inst of Object.values(this.rt.running)) {
      if (inst.hold) continue;
      const e = { effectId: inst.effectId, rate: inst.rate || 1, size: inst.size ?? 1 };
      if (inst.tricks) e.tricks = { ...inst.tricks };
      if (inst.groupId) e.groupId = inst.groupId;
      else if (inst.fixtures) e.fixtures = [...inst.fixtures];
      out.push(e);
    }
    // Keep effects of the current cue/look that were not switched off live.
    const base = this.rt.base.kind === 'look' ? this.show.looks.find((x) => x.id === this.rt.base.lookId) : this.show.cues[this.rt.cueIndex];
    for (const e of (base && base.effects) || []) {
      if (e.groupId && (this.rt.busk[e.groupId] || {}).fx) continue;
      if (!out.some((o) => o.groupId && o.groupId === e.groupId)) out.push({ ...e, effectId: e.effectId || e.type });
    }
    return out;
  },


  padOn(pad, hold) {
    const target = pad.groupId ? { groupId: pad.groupId } : {};
    if (pad.kind === 'effect') this.rt.running[pad.id] = { effectId: pad.effectId, rate: pad.rate || 1, size: 1, hold, ...target };
    else if (pad.kind === 'preset') this.rt.livePresets[pad.id] = { presetId: pad.presetId, ...target };
    else if (pad.kind === 'flash') this.rt.padFlash[pad.id] = { ...target };
    this.rt.padsOn[pad.id] = true;
  },


  padOff(id) {
    delete this.rt.running[id];
    delete this.rt.livePresets[id];
    delete this.rt.padFlash[id];
    delete this.rt.padsOn[id];
  },


  // Screen colour -> live colour of the chosen light groups (all groups if none chosen)
  // Not during parts that don't follow the screen (e.g. Sermon, Hosting).
  applyScreenColor(rgb) {
    if (!rgb || rgb.length < 3) return;
    if (!this.currentPart().screenColor) return;
    if ((this.show.settings.pp.colorTarget || 'primary') === 'primary') {
      this.rt.paletteLive[0] = rgbToHex(rgb);
      this.rt.screenColored = { primary: true, groups: [] };
      return;
    }
    const ids = (this.show.settings.pp.colorGroups.length ? this.show.settings.pp.colorGroups : this.show.groups.map((g) => g.id)).filter((gid) => this.show.groups.some((g) => g.id === gid));
    for (const gid of ids) this.buskFor(gid).color = rgb.map((v) => round4(clamp01(v)));
    this.rt.screenColored = { primary: false, groups: ids };
  },


  buskFor(gid) {
    return (this.rt.busk[gid] ||= { level: 1, color: null, fx: null, flash: false });
  },
};
