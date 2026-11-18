'use strict';
// Actions – Scenes (add-on looks with faders). Each action runs with `this` = the engine; return { show: true } when the saved show changed.
const { uid, num } = require('../util');

module.exports = {

  // Scenes
  'scene.record'(a) {
    if (!Object.keys(this.programmer).length) throw new Error('Set some lights first, then save them as a scene');
    const values = JSON.parse(JSON.stringify(this.programmer));
    const scene = { id: uid(), name: String(a.name || '').trim() || `Scene ${this.show.scenes.length + 1}`, fade: 2, color: this.colorFor(values), values };
    this.show.scenes.push(scene);
    this.programmer = {};
    this.setSceneLevel(scene.id, 1);
    return { show: true };
  },

  'scene.update'(a) {
    const s = this.show.scenes[this.findIndex(this.show.scenes, a.id)];
    if (!Object.keys(this.programmer).length) throw new Error('The programmer is empty');
    s.values = JSON.parse(JSON.stringify(this.programmer));
    s.color = this.colorFor(s.values);
    this.programmer = {};
    this.setSceneLevel(s.id, 1);
    return { show: true };
  },

  'scene.toggle'(a) {
    const s = this.show.scenes[this.findIndex(this.show.scenes, a.id)];
    const cur = this.rt.sceneLevels[s.id] || 0;
    const fading = this.sceneFades[s.id];
    const to = fading ? (fading.to > 0 ? 0 : 1) : cur > 0 ? 0 : 1;
    if (to > 0 && cur === 0) this.setSceneLevel(s.id, 0.0001);
    this.sceneFades[s.id] = { from: Math.max(cur, to > 0 ? 0.0001 : 0), to, start: Date.now(), dur: (s.fade || 0) * 1000 };
  },

  'scene.level'(a) {
    this.findIndex(this.show.scenes, a.id);
    this.setSceneLevel(a.id, num(a.level, 'Level'));
  },

  'scene.releaseAll'() {
    const now = Date.now();
    for (const s of this.show.scenes) {
      const cur = this.rt.sceneLevels[s.id] || 0;
      if (cur > 0) this.sceneFades[s.id] = { from: cur, to: 0, start: now, dur: 2000 };
    }
  },

  'scene.edit'(a) {
    const s = this.show.scenes[this.findIndex(this.show.scenes, a.id)];
    if (a.name !== undefined) s.name = String(a.name).slice(0, 60);
    if (a.fade !== undefined) s.fade = Math.max(0, Math.min(600, num(a.fade, 'Fade')));
    if (a.color !== undefined && /^#[0-9a-f]{6}$/i.test(a.color)) s.color = a.color;
    return { show: true };
  },

  'scene.delete'(a) {
    const i = this.findIndex(this.show.scenes, a.id);
    this.show.scenes.splice(i, 1);
    this.setSceneLevel(a.id, 0);
    return { show: true };
  },

  'scene.move'(a) {
    const list = this.show.scenes;
    const i = this.findIndex(list, a.id);
    const j = i + (a.dir < 0 ? -1 : 1);
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    return { show: true };
  },
};
