'use strict';
// Actions – Backing tracks: key/tempo, stems, markers, transport, vocal. Each action runs with `this` = the engine; return { show: true } when the saved show changed.
const { uid, round4, num } = require('../util');
const { cloneVocal, mergeVocal } = require('../defaults');

module.exports = {
  // ----- backing tracks ------------------------------------------------------------
  'song.audio'(a) {
    const s = this.show.songs[this.findIndex(this.show.songs, a.id)];
    if ('key' in a) s.key = a.key === null || a.key === '' ? null : ((Math.floor(num(a.key, 'Key')) % 12) + 12) % 12;
    if ('minor' in a) s.minor = !!a.minor;
    if ('transpose' in a) s.transpose = Math.max(-12, Math.min(12, Math.round(num(a.transpose, 'Transpose'))));
    if ('targetBpm' in a) {
      const b = Number(a.targetBpm);
      s.targetBpm = a.targetBpm === null || a.targetBpm === '' || !(b >= 30 && b <= 300) ? null : Math.round(b * 10) / 10;
      if (this.rt.songId === s.id && !this.rt.clock && (s.targetBpm || s.bpm)) this.rt.bpm = s.targetBpm || s.bpm;
    }
    if ('tcStart' in a) {
      const v = a.tcStart === null || a.tcStart === '' ? null : num(a.tcStart, 'Start timecode');
      s.tcStart = v === null ? undefined : Math.max(0, Math.min(86400, v));
      if (s.tcStart === undefined) delete s.tcStart;
    }
    if ('midiOut' in a) {
      const m = a.midiOut;
      s.midiOut = m && m.pc !== '' && m.pc !== null && m.pc !== undefined ? { pc: Math.max(0, Math.min(127, Math.floor(num(m.pc, 'Program')))), ch: Math.max(1, Math.min(16, Math.floor(num(m.ch || 1, 'Channel')))) } : null;
    }
    return { show: true };
  },

  'stem.add'(a) {
    const s = this.show.songs[this.findIndex(this.show.songs, a.songId)];
    const name = String(a.name || 'Stem').replace(/\.[a-z0-9]+$/i, '').slice(0, 40);
    const file = String(a.file || '');
    if (!/^audio\/[A-Za-z0-9._-]+$/.test(file)) throw new Error('Upload the audio file first');
    // Click and guide tracks go to outputs 3-4 (the band's in-ear mix) by default.
    const cue = /click|clk|metro|cue|guide|count/i.test(name);
    // A click keeps its pitch when the key changes (it still follows the tempo).
    s.stems.push({ id: uid(), name, file, gain: 0, pan: 0, mute: false, solo: false, out: cue ? 1 : 0, keepPitch: /click|clk|metro/i.test(name) });
    return { show: true };
  },

  'stem.edit'(a) {
    const s = this.show.songs[this.findIndex(this.show.songs, a.songId)];
    const st = s.stems[this.findIndex(s.stems, a.id)];
    if (a.name !== undefined) st.name = String(a.name).slice(0, 40) || st.name;
    if (a.gain !== undefined) st.gain = Math.max(-60, Math.min(12, num(a.gain, 'Level')));
    if (a.pan !== undefined) st.pan = Math.max(-1, Math.min(1, num(a.pan, 'Pan')));
    if (a.mute !== undefined) st.mute = !!a.mute;
    if (a.solo !== undefined) st.solo = !!a.solo;
    if (a.out !== undefined) st.out = Math.max(0, Math.min(31, Math.floor(num(a.out, 'Output'))));
    if (a.keepPitch !== undefined) st.keepPitch = !!a.keepPitch;
    return { show: true };
  },

  'stem.delete'(a) {
    const s = this.show.songs[this.findIndex(this.show.songs, a.songId)];
    s.stems.splice(this.findIndex(s.stems, a.id), 1);
    return { show: true };
  },

  'marker.set'(a) {
    const s = this.show.songs[this.findIndex(this.show.songs, a.songId)];
    this.findIndex(s.sections, a.sectionId);
    s.markers = s.markers.filter((m) => m.sectionId !== a.sectionId);
    if (a.time !== null && a.time !== undefined && a.time !== '') s.markers.push({ sectionId: a.sectionId, time: Math.max(0, round4(num(a.time, 'Time'))) });
    s.markers.sort((x, y) => x.time - y.time);
    return { show: true };
  },

  // Transport commands go to whichever computer plays the audio.
  'transport'(a) {
    const cmds = ['play', 'stop', 'seek', 'loop', 'unloop', 'section'];
    if (!cmds.includes(a.cmd)) throw new Error('Unknown transport command');
    const songId = a.songId || this.rt.songId;
    if (!songId) throw new Error('Pick a song first');
    if (songId !== this.rt.songId) this.actions['song.select'].call(this, { id: songId });
    const t = this.rt.transport;
    this.rt.transport = { seq: t.seq + 1, cmd: a.cmd, songId, pos: a.pos === undefined ? null : Math.max(0, num(a.pos, 'Position')), sectionId: a.sectionId || null, at: Date.now() };
  },

  'transport.report'(a) {
    const prev = this.rt.playhead;
    this.rt.playhead = { songId: a.songId || null, pos: Math.max(0, Number(a.pos) || 0), dur: Math.max(0, Number(a.dur) || 0), playing: !!a.playing, looping: !!a.looping, ready: !!a.ready, status: String(a.status || '').slice(0, 80), at: Date.now() };
    // Send to everyone at most every 500 ms, or when play/stop changes.
    if (prev && prev.playing === this.rt.playhead.playing && prev.status === this.rt.playhead.status && Date.now() - (this.lastReportBroadcast || 0) < 450) return { runtime: false };
    this.lastReportBroadcast = Date.now();
  },

  // The playing tracks reached a section marker.
  'tracks.marker'(a) {
    const song = this.show.songs[this.findIndex(this.show.songs, a.songId)];
    const sec = song.sections[this.findIndex(song.sections, a.sectionId)];
    const info = { t: 'track', name: sec.name, at: Date.now() };
    if (this.rt.mode === 'manual') return void (this.rt.lastMidi = { ...info, result: `${sec.name} (ignored: Manual mode)` });
    if (this.rt.hold) return void (this.rt.lastMidi = { ...info, result: `${sec.name} (ignored: Hold is on)` });
    this.goSection(song, sec);
    this.rt.lastMidi = { ...info, result: `${song.name} · ${sec.name}` };
  },

  'audio.host'(a) {
    const id = String(a.id || '').slice(0, 40);
    if (a.on) this.rt.audioHost = { id, name: String(a.name || 'This computer').slice(0, 40), at: Date.now() };
    else if (this.rt.audioHost && this.rt.audioHost.id === id) this.rt.audioHost = null;
  },

  'vocal.set'(a) {
    this.rt.vocal = mergeVocal(this.rt.vocal, a.vocal || {});
  },

  'vocal.saveToSong'(a) {
    const s = this.show.songs[this.findIndex(this.show.songs, a.songId)];
    s.vocal = cloneVocal(this.rt.vocal);
    return { show: true };
  },

  'vocal.clearSong'(a) {
    const s = this.show.songs[this.findIndex(this.show.songs, a.songId)];
    delete s.vocal;
    return { show: true };
  },
};
