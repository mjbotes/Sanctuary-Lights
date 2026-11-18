'use strict';
// Actions – Settings and whole-show operations. Each action runs with `this` = the engine; return { show: true } when the saved show changed.
const { num } = require('../util');
const { emptyShow, demoShow } = require('../defaults');

module.exports = {

  // Settings & show
  'settings.update'(a) {
    const s = this.show.settings;
    const v = a.settings || {};
    for (const k of ['artnet', 'sacn', 'enttec']) if (k in v) s[k] = !!v[k];
    for (const k of ['artnetTarget', 'sacnInterface', 'sacnUnicast', 'enttecPort', 'sourceName']) if (k in v) s[k] = String(v[k]).trim();
    if ('artnetBase' in v) s.artnetBase = num(v.artnetBase, 'Art-Net base') ? 1 : 0;
    if ('sacnPriority' in v) s.sacnPriority = Math.max(0, Math.min(200, Math.floor(num(v.sacnPriority, 'Priority'))));
    if ('enttecUniverse' in v) s.enttecUniverse = Math.max(1, Math.floor(num(v.enttecUniverse, 'Universe')));
    if ('midiInput' in v) s.midiInput = String(v.midiInput);
    if ('midiOutput' in v) s.midiOutput = String(v.midiOutput);
    if ('midiChannel' in v) s.midiChannel = Math.max(0, Math.min(16, Math.floor(num(v.midiChannel, 'MIDI channel'))));
    if ('noteBase' in v) s.noteBase = Math.max(0, Math.min(127, Math.floor(num(v.noteBase, 'Note'))));
    if ('pcSelectsSong' in v) s.pcSelectsSong = !!v.pcSelectsSong;
    if (v.pp && typeof v.pp === 'object') {
      const pp = { ...s.pp };
      if ('enabled' in v.pp) pp.enabled = !!v.pp.enabled;
      if ('host' in v.pp) pp.host = String(v.pp.host).trim().replace(/^https?:\/\//, '').replace(/[/:].*$/, '').slice(0, 100);
      if ('port' in v.pp) pp.port = Math.max(1, Math.min(65535, Math.floor(num(v.pp.port, 'Port'))));
      if ('sections' in v.pp) pp.sections = !!v.pp.sections;
      if ('songs' in v.pp) pp.songs = !!v.pp.songs;
      if ('colorMode' in v.pp) pp.colorMode = ['off', 'group', 'slide'].includes(v.pp.colorMode) ? v.pp.colorMode : 'off';
      if ('colorTarget' in v.pp) pp.colorTarget = v.pp.colorTarget === 'groups' ? 'groups' : 'primary';
      if ('videoPart' in v.pp) pp.videoPart = !!v.pp.videoPart;
      if ('autoParts' in v.pp) pp.autoParts = !!v.pp.autoParts;
      if ('colorGroups' in v.pp) pp.colorGroups = (Array.isArray(v.pp.colorGroups) ? v.pp.colorGroups : []).filter((id) => this.show.groups.some((g) => g.id === id));
      s.pp = pp;
    }
    if (v.osc && typeof v.osc === 'object') {
      const o = { ...(s.osc || { enabled: true, port: 8000 }) };
      if ('enabled' in v.osc) o.enabled = !!v.osc.enabled;
      if ('port' in v.osc) o.port = Math.max(1024, Math.min(65535, Math.floor(num(v.osc.port, 'OSC port'))));
      s.osc = o;
    }
    if ('tracking' in v) s.tracking = !!v.tracking;
    if (v.input && typeof v.input === 'object') {
      const i = { ...(s.input || {}) };
      if ('enabled' in v.input) i.enabled = !!v.input.enabled;
      if ('protocol' in v.input) i.protocol = v.input.protocol === 'sacn' ? 'sacn' : 'artnet';
      if ('mode' in v.input) i.mode = v.input.mode === 'backup' ? 'backup' : 'merge';
      s.input = i;
    }
    if ('tcEnabled' in v) s.tcEnabled = !!v.tcEnabled;
    if ('setupDone' in v) s.setupDone = !!v.setupDone;
    if ('safeLookId' in v) s.safeLookId = this.show.looks.some((l) => l.id === v.safeLookId) ? v.safeLookId : null;
    if ('screenProtect' in v) s.screenProtect = ['off', 'warn', 'block'].includes(v.screenProtect) ? v.screenProtect : 'warn';
    if ('fps' in v) s.fps = Math.max(10, Math.min(44, Math.floor(num(v.fps, 'Frame rate'))));
    if ('name' in a) this.show.name = String(a.name).slice(0, 80);
    return { show: true };
  },

  'show.load'(a) {
    const s = a.show;
    if (!s || !Array.isArray(s.fixtures) || !Array.isArray(s.cues)) throw new Error('That file is not a show file');
    const cid = this.show.settings.cid;
    this.loadShow({ ...s, settings: { ...s.settings, cid } });
    return { show: true };
  },

  'show.new'(a) {
    const cid = this.show.settings.cid;
    // Keep the connections (output, MIDI, ProPresenter); offer the setup wizard again for an empty show
    const settings = { ...this.show.settings, cid, setupDone: !!a.demo };
    this.loadShow(a.demo ? { ...demoShow(), settings } : { ...emptyShow(), settings });
    if (a.demo) this.actions['demo.addSong'].call(this, { id: 'graves-into-gardens', select: false });
    return { show: true };
  },
};
