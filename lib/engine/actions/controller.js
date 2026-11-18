'use strict';
// Actions – Hardware controller settings and Learn (the controller itself is lib/controller.js).
// Each action runs with `this` = the engine; return { show: true } when the saved show changed.

module.exports = {
  // Admin: which controller, on which MIDI port
  'settings.controller'(a) {
    const c = a.controller || {};
    const cur = this.show.settings.controller;
    if ('enabled' in c) cur.enabled = !!c.enabled;
    if ('port' in c) cur.port = String(c.port || '').slice(0, 120);
    if ('profile' in c) cur.profile = ['launchpad', 'apcmini', 'generic'].includes(c.profile) ? c.profile : 'launchpad';
    return { show: true };
  },

  // Learn: the next button pressed on the controller does `key`
  'controller.learn'(a) {
    this.rt.controllerLearn = a.key ? String(a.key) : null;
  },

  'controller.learned'(a) {
    const t = a.trigger || {};
    if (!a.key || !['note', 'cc'].includes(t.t)) throw new Error('Nothing to learn');
    const learned = this.show.settings.controller.learned;
    // One button, one job
    for (const [k, v] of Object.entries(learned)) if (v && v.t === t.t && v.n === t.n && v.ch === t.ch) delete learned[k];
    learned[a.key] = { t: t.t, ch: Number(t.ch) || 0, n: Number(t.n) || 0 };
    this.rt.controllerLearn = null;
    return { show: true };
  },

  'controller.forget'(a) {
    delete this.show.settings.controller.learned[a.key];
    return { show: true };
  },
};
