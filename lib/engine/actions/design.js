'use strict';
// Actions – Automatic lighting design and demo songs. Each action runs with `this` = the engine; return { show: true } when the saved show changed.
const { DEMOS } = require('../design');
const { normalizeSong } = require('../defaults');
const { uid } = require('../util');

module.exports = {
  // "Light this song for me": looks for every section, from the rig and the song's palette
  'song.design'(a) {
    const song = this.show.songs[this.findIndex(this.show.songs, a.id)];
    if (!song.sections.length) throw new Error('Add the song\'s sections first (Intro, Verse, Chorus…)');
    this.designSong(song);
    // Show the result if this song is on stage
    if (this.rt.songId === song.id && this.rt.sectionId) {
      const sec = song.sections.find((x) => x.id === this.rt.sectionId);
      if (sec) this.goSection(song, sec);
    }
    return { show: true };
  },

  // Add a demo song with its own designed looks (e.g. "graves-into-gardens")
  'demo.addSong'(a) {
    const demo = DEMOS[a.id];
    if (!demo) throw new Error('Unknown demo song');
    let song = this.show.songs.find((s) => s.name === demo.name);
    if (!song) {
      song = normalizeSong({ id: uid(), name: demo.name, notes: demo.notes, trigger: null, sections: demo.sections.map((n) => ({ id: uid(), name: n, lookId: null, fade: 1, trigger: null })) });
      this.show.songs.push(song);
    }
    song.palette = [...demo.palette];
    this.designSong(song, demo.designs);
    if (a.select !== false) this.actions['song.select'].call(this, { id: song.id });
    return { show: true };
  },
};
