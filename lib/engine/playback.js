'use strict';
// Engine methods – Playback helpers: scene levels, base layer changes, cues, songs and sections.
const { clamp01 } = require('./util');

module.exports = {

  // ----- helpers for actions ----------------------------------------------
  setSceneLevel(id, level, fromFade = false) {
    level = clamp01(level);
    const prev = this.rt.sceneLevels[id] || 0;
    if (prev === 0 && level > 0) this.rt.sceneOrder[id] = (this.orderCounter = (this.orderCounter || 0) + 1);
    if (level === 0) delete this.rt.sceneLevels[id];
    else this.rt.sceneLevels[id] = level;
    if (!fromFade) delete this.sceneFades[id];
  },


  setBase(base, fadeSec, from = this.cueLayer(Date.now())) {
    const now = Date.now();
    this.rt.base = base;
    // Per-light fade/delay (from selection tricks) stretch the fade if needed.
    const src = this.baseSource();
    const timing = (src && src.timing) || null;
    let dur = Math.max(0, fadeSec || 0) * 1000;
    if (timing) for (const tm of Object.values(timing)) dur = Math.max(dur, ((tm.delay || 0) + (tm.fade ?? fadeSec ?? 0)) * 1000);
    this.cueFade = dur > 0 ? { from, start: now, dur, base: Math.max(0, fadeSec || 0) * 1000, timing } : null;
  },


  gotoCue(index, fadeSec) {
    const from = this.cueLayer(Date.now());
    this.rt.cueIndex = index;
    const cue = this.show.cues[index];
    this.setBase({ kind: 'cue' }, fadeSec ?? (cue ? cue.fade : 2), from);
  },


  // ----- songs ------------------------------------------------------------
  song(id) {
    return this.show.songs.find((x) => x.id === id);
  },


  goSection(song, section) {
    this.rt.songId = song.id;
    this.rt.sectionId = section.id;
    const look = section.lookId && this.show.looks.find((l) => l.id === section.lookId);
    // A section without a look just marks the position and leaves the lights alone.
    if (look) this.setBase({ kind: 'look', lookId: look.id }, section.fade ?? 1);
  },


  // Pick a look whose name matches a section name ("Verse 2" -> "Verse").
  guessLook(name) {
    const n = String(name).toLowerCase().replace(/\s*\d+$/, '').trim();
    const looks = this.show.looks;
    return (looks.find((l) => l.name.toLowerCase() === n) || looks.find((l) => l.name.toLowerCase().startsWith(n)) || {}).id || null;
  },
};
