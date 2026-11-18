'use strict';
// Follow the band by sound: an app window listens to a microphone (or a desk feed), finds the beat
// and how loud the music is (public/audio/beatcore.js), and sends it here.
//  - The beat sets the tempo for effects, pads and busking, unless MIDI clock or the tracks are playing.
//  - The loudness scales the chosen groups during parts that follow the songs (Worship):
//    quiet verse = softer, full chorus = full. Never during the sermon, hosting or a video.
// settings.sound = { tempo: true, energy: true, groups: [] (none = all lights), depth: 0.5 }

const STALE = 3000; // ms without news from the listener = not listening
const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));

function cleanSound(v, show) {
  const s = v && typeof v === 'object' ? v : {};
  return {
    tempo: s.tempo !== false,
    energy: s.energy !== false,
    groups: (Array.isArray(s.groups) ? s.groups : []).filter((id) => show.groups.some((g) => g.id === id)),
    depth: Number.isFinite(Number(s.depth)) && s.depth !== null && s.depth !== '' ? clamp01(s.depth) : 0.5,
  };
}

const methods = {
  // Is a listener sending right now?
  soundActive(now = Date.now()) {
    const s = this.rt.sound;
    return !!(s && now - s.at < STALE);
  },

  // Does the beat set the tempo now? (MIDI clock and playing tracks know better)
  soundFollowsTempo() {
    return this.show.settings.sound.tempo && !this.rt.clock && !(this.rt.transport && this.rt.transport.cmd === 'play');
  },

  // Brightness factor from the loudness (1 = as programmed), or null when it does not apply
  soundFactor(now = Date.now()) {
    const cfg = this.show.settings.sound;
    if (!cfg.energy || !this.soundActive(now)) return null;
    const part = this.part(this.rt.partId);
    if (part && part.sections === false) return null; // sermon, hosting, video…
    return 1 - cfg.depth * (1 - clamp01(this.rt.sound.level));
  },

  applySound(look, now) {
    const f = this.soundFactor(now);
    if (f === null || f >= 1) return;
    const groups = this.show.settings.sound.groups;
    const ids = groups.length ? [...new Set(groups.flatMap((gid) => (this.show.groups.find((g) => g.id === gid) || { fixtures: [] }).fixtures))] : Object.keys(look);
    for (const fid of ids) if (look[fid] && 'dim' in look[fid]) look[fid].dim *= f;
  },
};

const actions = {
  // A beat heard: { bpm, confidence?, host? }
  'sound.beat'(a) {
    const bpm = Number(a.bpm);
    if (!(bpm >= 30 && bpm <= 300)) throw new Error('BPM must be 30 to 300');
    const now = Date.now();
    const wasActive = this.soundActive(now);
    const s = (this.rt.sound ||= { level: 0, at: now, host: '', bpm: 0, beats: 0 });
    s.at = now;
    s.bpm = bpm;
    s.beats++;
    if (a.host) s.host = String(a.host).slice(0, 40);
    if (Number.isFinite(Number(a.level))) s.level = clamp01(a.level);
    const prev = this.rt.bpm;
    s.tempo = this.soundFollowsTempo();
    if (s.tempo) {
      this.rt.bpm = bpm;
      this.rt.beatT0 = now;
    }
    // Only tell the screens when something they show changes
    if (wasActive && Math.abs(prev - this.rt.bpm) < 0.5) return { runtime: false };
  },

  // How loud (0-1), a few times a second: { level, host? }
  'sound.level'(a) {
    const now = Date.now();
    const wasActive = this.soundActive(now);
    const s = (this.rt.sound ||= { level: 0, at: now, host: '', bpm: 0, beats: 0 });
    s.at = now;
    s.level = clamp01(a.level);
    if (a.host) s.host = String(a.host).slice(0, 40);
    if (wasActive) return { runtime: false };
  },

  'sound.stop'() {
    this.rt.sound = null;
  },

  // { tempo?, energy?, groups?, depth? }
  'sound.settings'(a) {
    this.show.settings.sound = cleanSound({ ...this.show.settings.sound, ...(a.settings || a) }, this.show);
    return { show: true };
  },
};

module.exports = { methods, actions, cleanSound, STALE };
