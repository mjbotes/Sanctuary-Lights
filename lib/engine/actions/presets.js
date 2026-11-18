'use strict';
// Actions – Presets (dimmer / colour / position / beam). Each action runs with `this` = the engine; return { show: true } when the saved show changed.
const { uid, round4, ids } = require('../util');
const { PRESET_ATTRS } = require('../defaults');

module.exports = {

  // Presets (palettes): dimmer / colour / position / beam / all
  'preset.record'(a) {
    const kind = PRESET_ATTRS[a.kind] ? a.kind : 'color';
    const fids = ids(a).filter((id) => this.fixtureMap.has(id));
    if (!fids.length) throw new Error('Select the lights to take the values from');
    const look = this.computeLook(Date.now(), { live: false });
    const values = {};
    for (const fid of fids) {
      const v = {};
      for (const [k, x] of Object.entries(look[fid])) if (PRESET_ATTRS[kind](k)) v[k] = round4(x);
      if (Object.keys(v).length) values[fid] = v;
    }
    if (!Object.keys(values).length) throw new Error(`The selected lights have no ${kind === 'dim' ? 'dimmer' : kind} settings`);
    const universal = { ...values[fids.find((f) => values[f])] };
    let preset = a.id && this.show.presets.find((x) => x.id === a.id);
    if (preset) {
      preset.values = a.merge ? { ...preset.values, ...values } : values;
      preset.universal = universal;
    } else {
      preset = { id: uid(), kind, name: String(a.name || '').trim().slice(0, 40) || `${kind} ${this.show.presets.length + 1}`, values, universal };
      this.show.presets.push(preset);
    }
    preset.color = kind === 'color' ? this.colorFor(Object.fromEntries(Object.entries(values).map(([f, v]) => [f, { ...v, dim: 1 }]))) : null;
    return { show: true };
  },

  'preset.apply'(a) {
    const preset = this.getPreset(a.id);
    if (!preset) throw new Error('Not found');
    for (const fid of ids(a)) {
      const fx = this.fixtureMap.get(fid);
      if (!fx) continue;
      for (const attr of fx.prof.attrs) {
        if (!PRESET_ATTRS[preset.kind](attr)) continue;
        const v = this.presetValue(preset, fid, attr);
        if (v === undefined) continue;
        (this.programmer[fid] ||= {})[attr] = v;
        (this.progRefs[fid] ||= {})[attr] = preset.id;
      }
    }
  },

  'preset.edit'(a) {
    const preset = this.show.presets[this.findIndex(this.show.presets, a.id)];
    if (a.name !== undefined) preset.name = String(a.name).slice(0, 40) || preset.name;
    return { show: true };
  },

  'preset.delete'(a) {
    this.show.presets.splice(this.findIndex(this.show.presets, a.id), 1);
    for (const list of [this.show.cues, this.show.looks]) for (const c of list) for (const attrs of Object.values(c.refs || {})) for (const [k, pid] of Object.entries(attrs)) if (pid === a.id) delete attrs[k];
    for (const attrs of Object.values(this.progRefs)) for (const [k, pid] of Object.entries(attrs)) if (pid === a.id) delete attrs[k];
    for (const p of this.show.pads) if (p.presetId === a.id) p.presetId = null;
    return { show: true };
  },

  'preset.move'(a) {
    const list = this.show.presets;
    const i = this.findIndex(list, a.id);
    const j = i + (a.dir < 0 ? -1 : 1);
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    return { show: true };
  },
};
