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


  // Change what drives the base layer (a cue or a look) with a fade.
  // opts: { down: fade-down seconds for intensity, delay: seconds before the fade starts }
  setBase(base, fadeSec, from = this.cueLayer(Date.now()), opts = {}) {
    const now = Date.now();
    this.rt.base = base;
    this.rt.followAt = null;
    // Per-light fade/delay (from selection tricks) stretch the fade if needed.
    const src = this.baseSource();
    const timing = (src && src.timing) || null;
    const up = Math.max(0, fadeSec || 0) * 1000;
    const down = opts.down === undefined || opts.down === null ? null : Math.max(0, opts.down) * 1000;
    const delay = Math.max(0, opts.delay || 0) * 1000;
    let dur = Math.max(up, down ?? 0);
    if (timing) for (const tm of Object.values(timing)) dur = Math.max(dur, ((tm.delay || 0) + (tm.fade ?? fadeSec ?? 0)) * 1000);
    dur += delay;
    this.cueFade = dur > 0 ? { from, start: now, dur, base: up, down, delay, timing } : null;
    return dur;
  },


  gotoCue(index, fadeSec) {
    const from = this.cueLayer(Date.now());
    this.rt.cueIndex = index;
    const cue = this.show.cues[index];
    const timed = fadeSec === undefined && cue;
    const dur = this.setBase({ kind: 'cue' }, fadeSec ?? (cue ? cue.fade : 2), from, timed ? { down: cue.fadeDown, delay: cue.delay } : {});
    this.rt.cueAt = Date.now();
    // Auto-follow: go to the next cue `follow` seconds after this one has finished
    if (cue && Number.isFinite(cue.follow) && index < this.show.cues.length - 1) this.rt.followAt = Date.now() + dur + cue.follow * 1000;
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
