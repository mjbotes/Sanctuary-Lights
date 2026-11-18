'use strict';
// Actions – Practice mode: rehearse without touching the real lights.
// While it is on, the DMX output keeps sending exactly what was on stage when practice started
// (see Devices), MIDI program changes to other apps are not sent, and every screen shows what
// WOULD happen. Leaving practice either puts everything back to where the stage was (no jump on
// the real lights), or keeps what was practised and sends it to the lights.
// Each action runs with `this` = the engine.

// Runtime state that practice can change and that is put back afterwards
const KEYS = ['cueIndex', 'cueAt', 'base', 'followAt', 'songId', 'sectionId', 'mode', 'hold', 'gm', 'blackout', 'busk', 'running', 'livePresets',
  'padFlash', 'padsOn', 'strobe', 'flashAll', 'sceneLevels', 'sceneOrder', 'paletteLive', 'partId', 'partFade', 'partAuto', 'partReturn', 'partBase',
  'screenColored', 'orderItemId', 'bpm', 'beatT0', 'identify'];

const copy = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

module.exports = {
  'practice.set'(a) {
    if (a.on) {
      if (this.rt.practice) return;
      this.practiceSnap = {
        rt: Object.fromEntries(KEYS.map((k) => [k, copy(this.rt[k])])),
        programmer: copy(this.programmer), progRefs: copy(this.progRefs),
        cueFade: copy(this.cueFade), sceneFades: copy(this.sceneFades),
      };
      this.rt.practice = { since: Date.now() };
      return;
    }
    if (!this.rt.practice) return;
    const snap = this.practiceSnap;
    // keep: the practised state becomes the real one (the lights fade to it); otherwise put it all back
    if (!a.keep && snap) {
      for (const k of KEYS) this.rt[k] = copy(snap.rt[k]);
      this.programmer = snap.programmer || {};
      this.progRefs = snap.progRefs || {};
      this.cueFade = snap.cueFade;
      this.sceneFades = snap.sceneFades || {};
    }
    this.practiceSnap = null;
    this.rt.practice = null;
  },
};
