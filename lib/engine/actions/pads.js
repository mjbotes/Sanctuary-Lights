'use strict';
// Actions – Pads (live buttons with hotkeys). Each action runs with `this` = the engine; return { show: true } when the saved show changed.
const { uid } = require('../util');

module.exports = {

  // Pads: live buttons with hotkeys
  'pad.save'(a) {
    const p = a.pad || {};
    const kind = ['effect', 'preset', 'flash'].includes(p.kind) ? p.kind : 'effect';
    if (kind === 'effect' && !this.effectById(p.effectId)) throw new Error('Choose an effect');
    if (kind === 'preset' && !this.getPreset(p.presetId)) throw new Error('Choose a preset');
    if (p.groupId) this.findIndex(this.show.groups, p.groupId);
    const key = String(p.key || '').slice(0, 1).toLowerCase();
    if (key && /[ tsfbr?]/.test(key)) throw new Error(`"${key}" is already used (Space, T, S, F, B, R, ?)`);
    const clash = key && this.show.pads.find((x) => x.key === key && x.id !== p.id);
    if (clash) clash.key = '';
    const clean = {
      id: p.id && this.show.pads.some((x) => x.id === p.id) ? p.id : uid(),
      name: String(p.name || '').trim().slice(0, 24) || 'Pad',
      kind, effectId: kind === 'effect' ? p.effectId : null, presetId: kind === 'preset' ? p.presetId : null,
      groupId: p.groupId || '', mode: p.mode === 'hold' ? 'hold' : 'toggle', key,
      rate: [0.25, 0.5, 1, 2, 4].includes(Number(p.rate)) ? Number(p.rate) : 1,
    };
    const i = this.show.pads.findIndex((x) => x.id === clean.id);
    if (i >= 0) this.show.pads[i] = clean;
    else this.show.pads.push(clean);
    this.padOff(clean.id);
    return { show: true };
  },

  'pad.delete'(a) {
    this.show.pads.splice(this.findIndex(this.show.pads, a.id), 1);
    this.padOff(a.id);
    return { show: true };
  },

  'pad.move'(a) {
    const list = this.show.pads;
    const i = this.findIndex(list, a.id);
    const j = i + (a.dir < 0 ? -1 : 1);
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    return { show: true };
  },

  'pad.press'(a) {
    const pad = this.show.pads[this.findIndex(this.show.pads, a.id)];
    const on = !!this.rt.padsOn[pad.id];
    if (pad.mode === 'hold') {
      if (a.down) this.padOn(pad, true);
      else this.padOff(pad.id);
    } else if (a.down) {
      if (on) this.padOff(pad.id);
      else this.padOn(pad, false);
    } else return { runtime: false };
  },
};
