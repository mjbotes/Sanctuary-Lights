'use strict';
// Actions – Effects library and running effects. Each action runs with `this` = the engine; return { show: true } when the saved show changed.
const { uid, clamp01, num, ids } = require('../util');
const { cleanEffect } = require('../defaults');

module.exports = {

  // Effects library (custom effects; built-ins are fixed)
  'effect.save'(a) {
    const e = a.effect || {};
    const existing = e.id && this.show.effects.find((x) => x.id === e.id);
    const clean = cleanEffect(e, existing ? existing.id : `fx-${uid()}`);
    if (existing) Object.assign(existing, clean);
    else this.show.effects.push(clean);
    this.lastSavedEffect = clean.id;
    return { show: true };
  },

  'effect.delete'(a) {
    const i = this.findIndex(this.show.effects, a.id);
    this.show.effects.splice(i, 1);
    for (const [k, inst] of Object.entries(this.rt.running)) if (inst.effectId === a.id) delete this.rt.running[k];
    return { show: true };
  },

  // Run an effect on lights (in the given order) or a group
  'fx.run'(a) {
    if (!this.effectById(a.effectId)) throw new Error('Unknown effect');
    const key = String(a.key || `fx-${uid()}`).slice(0, 40);
    const inst = { effectId: a.effectId, rate: [0.25, 0.5, 1, 2, 4].includes(Number(a.rate)) ? Number(a.rate) : 1, size: clamp01(a.size ?? 1) };
    if (a.useTricks !== false && this.tricksUsed()) inst.tricks = { ...this.rt.tricks };
    if (a.groupId) {
      this.findIndex(this.show.groups, a.groupId);
      inst.groupId = a.groupId;
    } else {
      inst.fixtures = ids(a).filter((id) => this.fixtureMap.has(id));
      if (!inst.fixtures.length) throw new Error('Select some lights or a group first');
    }
    this.rt.running[key] = inst;
  },

  'fx.adjust'(a) {
    const inst = this.rt.running[a.key];
    if (!inst) throw new Error('That effect is not running');
    if (a.rate !== undefined) inst.rate = Math.max(0.125, Math.min(8, num(a.rate, 'Speed')));
    if (a.size !== undefined) inst.size = clamp01(num(a.size, 'Size'));
  },

  'fx.stop'(a) {
    if (a.key) delete this.rt.running[a.key];
    else this.rt.running = {};
    for (const k of Object.keys(this.rt.padsOn)) if (!this.rt.running[k] && !this.rt.livePresets[k] && !this.rt.padFlash[k]) delete this.rt.padsOn[k];
  },
};
