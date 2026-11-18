'use strict';
// Engine methods – The song library: a song you have lit stays lit.
//
// - Songs are never thrown away by accident: removing a song from the set list keeps it in the
//   library (song.archived), with its sections, looks, colours, tracks and triggers.
// - Every way a song comes in (+ Song, Planning Center, ProPresenter, the demo, a shared file,
//   MIDI / OSC) finds the programmed song first: by Planning Center id, then by name, ignoring
//   things like "(Live)" or "- Acoustic".
// - A new arrangement keeps the lighting: sections with the same name keep their look, fade,
//   trigger and markers; a new "Chorus 4" gets the Chorus look; a section that comes back after a
//   few weeks gets the look it had (song.memory remembers every section name's look).
const { uid, nameKey, baseKey } = require('./util');
const { kindOf } = require('./design');

// "Graves Into Gardens (Live)", "Graves into Gardens - Acoustic" -> "gravesintogardens"
function looseKey(name) {
  return nameKey(String(name || '')
    .toLowerCase()
    .replace(/[([{].*?[)\]}]/g, ' ')
    .replace(/\s[-–—|:]\s.*$/, ' ')
    .replace(/\b(live|acoustic|radio edit|edit|version|remix|reprise|feat\.?.*|ft\.?.*)\b/g, ' '));
}

module.exports = {
  looseKey,

  methods: {
    // The set list: songs that are not in the library only
    setList() {
      return this.show.songs.filter((s) => !s.archived);
    },

    // Find a song however it is named (library included)
    findSong(name, extId) {
      const songs = this.show.songs;
      if (extId) {
        const byId = songs.find((s) => s.pcoId && s.pcoId === String(extId));
        if (byId) return byId;
      }
      const k = nameKey(name);
      if (!k) return null;
      const exact = songs.find((s) => nameKey(s.name) === k);
      if (exact) return exact;
      const loose = looseKey(name);
      return loose ? songs.find((s) => looseKey(s.name) === loose) || null : null;
    },

    // Back from the library into the set list (at the end)
    restoreSong(song) {
      if (!song.archived) return false;
      song.archived = false;
      this.show.songs = [...this.show.songs.filter((s) => s !== song && !s.archived), song, ...this.show.songs.filter((s) => s !== song && s.archived)];
      return true;
    },

    // Remember the look of every section (by name and by base name), so it can come back later
    rememberSections(song) {
      const mem = (song.memory ||= {});
      for (const s of song.sections) {
        if (!s.lookId) continue;
        const entry = { lookId: s.lookId, fade: s.fade };
        mem[nameKey(s.name)] = entry;
        if (!mem[`base:${baseKey(s.name)}`]) mem[`base:${baseKey(s.name)}`] = entry;
      }
      // Forget looks that no longer exist
      for (const [k, v] of Object.entries(mem)) if (!this.show.looks.some((l) => l.id === v.lookId)) delete mem[k];
    },

    // Put the song's sections in this order (names), keeping all the lighting that was set up.
    applyArrangement(song, names) {
      if (!names.length) return false;
      if (song.sections.map((s) => s.name).join('|') === names.join('|')) return false;
      this.rememberSections(song);
      const mem = song.memory || {};
      const pool = [...song.sections];
      const out = names.map((name) => {
        // 1. the same section (keeps its id, so markers and triggers stay)
        const i = pool.findIndex((s) => nameKey(s.name) === nameKey(name));
        if (i >= 0) return pool.splice(i, 1)[0];
        // 2. remembered: this name, then the same kind of section in this song ("Chorus 4" -> Chorus)
        const same = mem[nameKey(name)] || mem[`base:${baseKey(name)}`];
        const sib = song.sections.find((s) => s.lookId && baseKey(s.name) === baseKey(name))
          || song.sections.find((s) => s.lookId && kindOf(s.name) === kindOf(name));
        const from = same || (sib && { lookId: sib.lookId, fade: sib.fade });
        return { id: uid(), name: String(name).slice(0, 40), lookId: from ? from.lookId : this.guessLook(name), fade: from ? from.fade ?? 1 : 1, trigger: null };
      });
      const kept = new Set(out.map((s) => s.id));
      song.markers = (song.markers || []).filter((m) => kept.has(m.sectionId));
      song.sections = out;
      return true;
    },
  },
};
