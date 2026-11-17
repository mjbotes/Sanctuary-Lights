'use strict';
// Actions – Cue list. Each action runs with `this` = the engine; return { show: true } when the saved show changed.
const { uid, num } = require('../util');

module.exports = {

  // Cue list
  'cue.go'() {
    if (this.rt.cueIndex < this.show.cues.length - 1) this.gotoCue(this.rt.cueIndex + 1);
  },

  'cue.back'() {
    if (this.rt.cueIndex >= 0) this.gotoCue(this.rt.cueIndex - 1, Math.min(2, (this.show.cues[this.rt.cueIndex - 1] || {}).fade ?? 2));
  },

  'cue.goto'(a) {
    const i = this.findIndex(this.show.cues, a.id);
    this.gotoCue(i, a.fade);
  },

  'cue.release'() {
    this.gotoCue(-1, 3);
  },

  'cue.record'(a) {
    const cue = { id: uid(), name: String(a.name || '').trim() || `Cue ${this.show.cues.length + 1}`, fade: 3, notes: '', timing: this.captureTiming(a.fixtures), refs: this.captureRefs(this.computeLook(Date.now(), { live: false })), values: this.captureStage(), effects: this.captureEffects() };
    const at = this.rt.cueIndex + 1;
    this.show.cues.splice(at, 0, cue);
    this.rt.cueIndex = at;
    this.rt.base = { kind: 'cue' };
    this.cueFade = null;
    this.programmer = {};
    this.progRefs = {};
    this.progRefs = {};
    return { show: true };
  },

  'cue.update'(a) {
    const cue = this.show.cues[this.rt.cueIndex];
    if (!cue) throw new Error('No current cue to update');
    if (a.fixtures) cue.timing = this.captureTiming(a.fixtures);
    cue.refs = this.captureRefs(this.computeLook(Date.now(), { live: false }));
    cue.values = this.captureStage();
    cue.effects = this.captureEffects();
    this.rt.base = { kind: 'cue' };
    this.cueFade = null;
    this.programmer = {};
    this.progRefs = {};
    this.progRefs = {};
    return { show: true };
  },

  'cue.edit'(a) {
    const cue = this.show.cues[this.findIndex(this.show.cues, a.id)];
    if (a.name !== undefined) cue.name = String(a.name).slice(0, 80);
    if (a.notes !== undefined) cue.notes = String(a.notes).slice(0, 500);
    if (a.fade !== undefined) cue.fade = Math.max(0, Math.min(600, num(a.fade, 'Fade')));
    return { show: true };
  },

  'cue.delete'(a) {
    const i = this.findIndex(this.show.cues, a.id);
    this.show.cues.splice(i, 1);
    if (this.rt.cueIndex > i) this.rt.cueIndex--;
    else if (this.rt.cueIndex === i) {
      this.rt.cueIndex = Math.min(i, this.show.cues.length - 1);
      this.cueFade = null;
    }
    return { show: true };
  },

  'cue.move'(a) {
    const i = this.findIndex(this.show.cues, a.id);
    const j = i + (a.dir < 0 ? -1 : 1);
    if (j < 0 || j >= this.show.cues.length) return;
    const cues = this.show.cues;
    [cues[i], cues[j]] = [cues[j], cues[i]];
    if (this.rt.cueIndex === i) this.rt.cueIndex = j;
    else if (this.rt.cueIndex === j) this.rt.cueIndex = i;
    return { show: true };
  },
};
