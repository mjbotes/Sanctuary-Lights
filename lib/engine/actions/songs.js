'use strict';
// Actions – Songs and sections, follow modes, MIDI learn. Each action runs with `this` = the engine; return { show: true } when the saved show changed.
const { uid, num } = require('../util');
const { normalizeSong, mergeVocal } = require('../defaults');

module.exports = {
  // ----- timecode (MTC) -------------------------------------------------------------
  // Cues with a timecode go when the timecode passes them; songs with a start timecode are picked
  // and their section markers (relative to the song start) change the lights.
  'tc.update'(a) {
    const now = num(a.seconds, 'Timecode');
    const prev = this.rt.tc ? this.rt.tc.seconds : null;
    this.rt.tc = { seconds: now, fps: Number(a.fps) || 30, at: Date.now(), running: true };
    if (!this.show.settings.tcEnabled) return { runtime: false };
    const jumped = prev === null || now < prev - 0.25 || now - prev > 2;
    let changed = false;
    // Cue list
    const timed = this.show.cues.map((c, i) => ({ i, tc: c.tc })).filter((c) => Number.isFinite(c.tc));
    if (timed.length) {
      const passed = jumped ? timed.filter((c) => c.tc <= now) : timed.filter((c) => c.tc > prev && c.tc <= now);
      const last = passed[passed.length - 1];
      if (last && !(this.rt.base.kind === 'cue' && this.rt.cueIndex === last.i)) {
        this.gotoCue(last.i, jumped ? 0 : undefined);
        changed = true;
      }
    }
    // Songs with a start timecode
    const songs = this.show.songs.filter((s) => Number.isFinite(s.tcStart) && s.tcStart <= now).sort((x, y) => y.tcStart - x.tcStart);
    const song = songs[0];
    if (song) {
      if (song.id !== this.rt.songId) {
        this.actions['song.select'].call(this, { id: song.id });
        changed = true;
      }
      const rel = now - song.tcStart, prevRel = prev === null ? -1 : prev - song.tcStart;
      const marks = song.markers.slice().sort((x, y) => x.time - y.time);
      const hits = jumped ? marks.filter((m) => m.time <= rel) : marks.filter((m) => m.time > prevRel && m.time <= rel);
      const m = hits[hits.length - 1];
      const sec = m && song.sections.find((s) => s.id === m.sectionId);
      if (sec && sec.id !== this.rt.sectionId && this.rt.mode !== 'manual' && !this.rt.hold && !this.sectionsBlocked()) {
        this.goSection(song, sec);
        this.rt.lastMidi = { t: 'track', name: sec.name, at: Date.now(), result: `${song.name} · ${sec.name} (timecode)` };
        changed = true;
      }
    }
    return changed ? undefined : { runtime: false };
  },
  'tc.stop'() {
    if (this.rt.tc) this.rt.tc.running = false;
  },

  // Songs & sections
  'song.add'(a) {
    const song = normalizeSong({ id: uid(), name: String(a.name || '').trim() || `Song ${this.show.songs.length + 1}`, notes: '', trigger: null, sections: [] });
    for (const name of Array.isArray(a.sections) ? a.sections : []) {
      song.sections.push({ id: uid(), name: String(name).slice(0, 40), lookId: this.guessLook(name), fade: 1, trigger: null });
    }
    this.show.songs.push(song);
    this.rt.songId = song.id;
    this.rt.sectionId = null;
    return { show: true };
  },

  'song.edit'(a) {
    const s = this.show.songs[this.findIndex(this.show.songs, a.id)];
    if (a.name !== undefined) s.name = String(a.name).slice(0, 80) || s.name;
    if (a.notes !== undefined) s.notes = String(a.notes).slice(0, 300);
    if (a.bpm !== undefined) {
      const bpm = Number(a.bpm);
      s.bpm = bpm >= 30 && bpm <= 300 ? Math.round(bpm * 10) / 10 : null;
      if (s.bpm && this.rt.songId === s.id && !this.rt.clock) this.rt.bpm = s.bpm;
    }
    return { show: true };
  },

  'song.delete'(a) {
    this.show.songs.splice(this.findIndex(this.show.songs, a.id), 1);
    if (this.rt.songId === a.id) {
      this.rt.songId = null;
      this.rt.sectionId = null;
    }
    return { show: true };
  },

  'song.move'(a) {
    const list = this.show.songs;
    const i = this.findIndex(list, a.id);
    const j = i + (a.dir < 0 ? -1 : 1);
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    return { show: true };
  },

  'song.select'(a) {
    const song = this.show.songs[this.findIndex(this.show.songs, a.id)];
    if (song.bpm && !this.rt.clock) this.rt.bpm = song.targetBpm || song.bpm;
    if (song.vocal && song.id !== this.rt.songId) this.rt.vocal = mergeVocal(this.rt.vocal, song.vocal);
    if (song.id !== this.rt.songId) this.rt.paletteLive = {};
    if (this.rt.songId !== a.id) this.rt.sectionId = null;
    this.rt.songId = a.id;
  },

  'section.add'(a) {
    const song = this.show.songs[this.findIndex(this.show.songs, a.songId)];
    const names = Array.isArray(a.names) ? a.names : [a.name];
    for (const raw of names) {
      let name = String(raw || '').trim() || 'Section';
      // Number repeated sections: Verse, Verse 2, Verse 3 ...
      const count = song.sections.filter((x) => x.name.replace(/\s*\d+$/, '') === name).length;
      if (count) name = `${name} ${count + 1}`;
      song.sections.push({ id: uid(), name, lookId: a.lookId || this.guessLook(name), fade: 1, trigger: null });
    }
    return { show: true };
  },

  'section.edit'(a) {
    const song = this.show.songs[this.findIndex(this.show.songs, a.songId)];
    const sec = song.sections[this.findIndex(song.sections, a.id)];
    if (a.name !== undefined) sec.name = String(a.name).slice(0, 40) || sec.name;
    if (a.lookId !== undefined) {
      if (a.lookId && !this.show.looks.some((l) => l.id === a.lookId)) throw new Error('Unknown look');
      sec.lookId = a.lookId || null;
    }
    if (a.fade !== undefined) sec.fade = Math.max(0, Math.min(60, num(a.fade, 'Fade')));
    return { show: true };
  },

  'section.delete'(a) {
    const song = this.show.songs[this.findIndex(this.show.songs, a.songId)];
    song.sections.splice(this.findIndex(song.sections, a.id), 1);
    if (this.rt.sectionId === a.id) this.rt.sectionId = null;
    return { show: true };
  },

  'section.move'(a) {
    const list = this.show.songs[this.findIndex(this.show.songs, a.songId)].sections;
    const i = this.findIndex(list, a.id);
    const j = i + (a.dir < 0 ? -1 : 1);
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    return { show: true };
  },

  'section.go'(a) {
    if (this.rt.mode === 'auto' && !this.rt.hold) throw new Error('Auto mode: the tracks are in control. Switch to Hybrid or Manual, or press Hold.');
    const song = this.show.songs[this.findIndex(this.show.songs, a.songId)];
    let sec;
    if (a.id) sec = song.sections[this.findIndex(song.sections, a.id)];
    else {
      const i = song.sections.findIndex((x) => x.id === this.rt.sectionId);
      const j = this.rt.songId === song.id ? i + (a.dir < 0 ? -1 : 1) : 0;
      sec = song.sections[j];
      if (!sec) throw new Error(a.dir < 0 ? 'Already at the start' : 'End of the song');
    }
    // Tapping a section during the sermon or hosting brings the worship lights back
    this.partForSections();
    this.goSection(song, sec);
  },


  'mode.set'(a) {
    if (!['manual', 'hybrid', 'auto'].includes(a.mode)) throw new Error('Unknown mode');
    this.rt.mode = a.mode;
    this.rt.hold = false;
  },

  'hold.set'(a) {
    this.rt.hold = !!a.on;
  },

  'midi.learn'(a) {
    if (!a.songId) {
      this.rt.learn = null;
      return;
    }
    const song = this.show.songs[this.findIndex(this.show.songs, a.songId)];
    if (a.sectionId) this.findIndex(song.sections, a.sectionId);
    this.rt.learn = { songId: a.songId, sectionId: a.sectionId || null };
  },

  'midi.forget'(a) {
    const song = this.show.songs[this.findIndex(this.show.songs, a.songId)];
    const target = a.sectionId ? song.sections[this.findIndex(song.sections, a.sectionId)] : song;
    target.trigger = null;
    return { show: true };
  },

  'midi.message'(a) {
    if (!Array.isArray(a.data)) throw new Error('MIDI data must be an array of bytes');
    const r = this.handleMidi(a.data.map((x) => Number(x) & 0xff));
    if (!r) return { runtime: false };
    return r;
  },
};
