'use strict';
// Actions – Looks library (used by song sections). Each action runs with `this` = the engine; return { show: true } when the saved show changed.
const { uid } = require('../util');

module.exports = {

  // Looks (shared by songs)
  'look.record'(a) {
    const values = this.captureStage();
    const look = { id: uid(), name: String(a.name || '').trim() || `Look ${this.show.looks.length + 1}`, values, effects: this.captureEffects(), timing: this.captureTiming(a.fixtures), refs: this.captureRefs(this.computeLook(Date.now(), { live: false })) };
    look.color = this.colorFor(values);
    this.show.looks.push(look);
    this.programmer = {};
    this.progRefs = {};
    this.setBase({ kind: 'look', lookId: look.id }, 0);
    return { show: true };
  },

  'look.update'(a) {
    const look = this.show.looks[this.findIndex(this.show.looks, a.id)];
    if (a.fixtures) look.timing = this.captureTiming(a.fixtures);
    look.refs = this.captureRefs(this.computeLook(Date.now(), { live: false }));
    look.values = this.captureStage();
    look.effects = this.captureEffects();
    look.color = this.colorFor(look.values);
    this.programmer = {};
    this.progRefs = {};
    this.setBase({ kind: 'look', lookId: look.id }, 0);
    return { show: true };
  },

  'look.edit'(a) {
    const look = this.show.looks[this.findIndex(this.show.looks, a.id)];
    if (a.name !== undefined) look.name = String(a.name).slice(0, 60) || look.name;
    return { show: true };
  },

  'look.delete'(a) {
    this.show.looks.splice(this.findIndex(this.show.looks, a.id), 1);
    for (const s of this.show.songs) for (const sec of s.sections) if (sec.lookId === a.id) sec.lookId = null;
    if (this.rt.base.kind === 'look' && this.rt.base.lookId === a.id) {
      this.rt.cueIndex = -1;
      this.setBase({ kind: 'cue' }, 1);
    }
    return { show: true };
  },

  'look.apply'(a) {
    this.findIndex(this.show.looks, a.id);
    this.rt.sectionId = null;
    this.setBase({ kind: 'look', lookId: a.id }, a.fade ?? 1);
  },
};
