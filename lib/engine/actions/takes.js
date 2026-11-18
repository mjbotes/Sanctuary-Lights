'use strict';
// Actions – Live takes: record what you do live (group faders, colours, effects, flashes, pads,
// strobe, live palette) against a song's timeline in rehearsal, and play it back the same way on
// Sunday. Times are in the song's ORIGINAL timeline (like section markers), so a take stays in
// time when the tempo is changed. Playback runs on the server (lib/server/takes.js).
// Each action runs with `this` = the engine.

// What a take records
const RECORDABLE = /^(busk\.(level|color|fx|flash|release)|pad\.press|strobe\.hold|flash\.all|palette\.set|scene\.(toggle|level))$/;
// Momentary actions: left out when catching up after a jump (they only make sense in the moment)
const MOMENTARY = (a) => /^(busk\.flash|strobe\.hold|flash\.all)$/.test(a.type) || (a.type === 'pad.press');

const clean = (a) => {
  const out = {};
  for (const [k, v] of Object.entries(a)) if (!k.startsWith('_')) out[k] = v;
  return JSON.parse(JSON.stringify(out));
};

module.exports = {
  RECORDABLE,
  MOMENTARY,

  methods: {
    // Where the song is now, in seconds of its original timeline, or null if it is not playing:
    // from the tracks player (Tracks tab) or MIDI timecode (with the song's start timecode).
    songPosition(songId, now = Date.now()) {
      const song = this.song(songId);
      if (!song) return null;
      const tempo = song.targetBpm && song.bpm ? song.targetBpm / song.bpm : 1;
      const ph = this.rt.playhead;
      if (ph && ph.songId === songId && ph.playing) return (ph.pos + (now - ph.at) / 1000) * tempo;
      const tc = this.rt.tc;
      if (tc && tc.running && Number.isFinite(song.tcStart)) {
        const rel = tc.seconds + (now - tc.at) / 1000 - song.tcStart;
        if (rel >= 0) return rel;
      }
      return null;
    },

    // Called for every action while recording; true when it was recorded
    recordTake(action) {
      const rec = this.rt.recording;
      if (!rec || !action || action._take || !RECORDABLE.test(action.type)) return false;
      if (action.type === 'palette.set' && action.scope !== 'live') return false; // only live colour changes
      const pos = this.songPosition(rec.songId);
      if (pos === null) {
        rec.waiting = true; // the song is not playing: nothing to record against
        return false;
      }
      rec.waiting = false;
      this.takeBuffer.push({ t: Math.round(pos * 1000) / 1000, a: clean(action) });
      rec.count = this.takeBuffer.length;
      return true;
    },
  },

  actions: {
    // on: start recording a take for the current song (or songId); on: false stops: save keeps it
    'take.record'(a) {
      if (a.on) {
        const songId = a.songId || this.rt.songId;
        if (!this.song(songId)) throw new Error('Pick a song first');
        this.rt.recording = { songId, since: Date.now(), count: 0, waiting: this.songPosition(songId) === null };
        this.takeBuffer = [];
        return;
      }
      const rec = this.rt.recording;
      if (!rec) return;
      this.rt.recording = null;
      const song = this.song(rec.songId);
      const events = (this.takeBuffer || []).sort((x, y) => x.t - y.t);
      this.takeBuffer = [];
      if (!a.save || !song || !events.length) {
        this.lastResult = { saved: false, events: events.length };
        return;
      }
      song.take = { events, recordedAt: new Date().toISOString(), on: true };
      this.lastResult = { saved: true, events: events.length };
      return { show: true };
    },

    'take.set'(a) {
      const song = this.show.songs[this.findIndex(this.show.songs, a.songId)];
      if (!song.take) throw new Error('This song has no live take');
      song.take.on = !!a.on;
      return { show: true };
    },

    'take.delete'(a) {
      const song = this.show.songs[this.findIndex(this.show.songs, a.songId)];
      delete song.take;
      return { show: true };
    },
  },
};
