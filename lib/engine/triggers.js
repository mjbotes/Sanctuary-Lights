'use strict';
// Engine methods – MIDI triggers for songs and sections.


module.exports = {

  // ----- MIDI ---------------------------------------------------------------
  // Returns null for messages we ignore (clock, note off, ...), so they are not broadcast.
  handleMidi(bytes) {
    const [status, d1 = 0, d2 = 0] = bytes;
    const kind = status & 0xf0;
    const ch = (status & 0x0f) + 1;
    let msg = null;
    if (kind === 0x90 && d2 > 0) msg = { t: 'note', ch, n: d1 };
    else if (kind === 0xb0 && d2 > 0) msg = { t: 'cc', ch, n: d1 };
    else if (kind === 0xc0) msg = { t: 'pc', ch, n: d1 };
    if (!msg) return null;
    this.rt.lastMidi = { ...msg, at: Date.now(), result: '' };
    const res = (text, show = false) => {
      this.rt.lastMidi.result = text;
      return { show };
    };
    const filter = this.show.settings.midiChannel;
    if (filter && ch !== filter) return res(`ignored (listening on channel ${filter} only)`);

    if (this.rt.learn) {
      const L = this.rt.learn;
      this.rt.learn = null;
      const song = this.song(L.songId);
      const target = L.sectionId ? song && song.sections.find((x) => x.id === L.sectionId) : song;
      if (!target) return res('learn target is gone');
      target.trigger = { t: msg.t, ch: msg.ch, n: msg.n };
      return res(`learned for ${target.name}`, true);
    }
    if (this.rt.hold) return res('ignored (Hold is on)');

    const same = (tr) => tr && tr.t === msg.t && tr.ch === msg.ch && tr.n === msg.n;
    const songs = this.show.songs;
    // 1. Song select
    let song = songs.find((s) => same(s.trigger));
    if (!song && msg.t === 'pc' && this.show.settings.pcSelectsSong && !songs.some((s) => s.trigger && s.trigger.t === 'pc')) song = this.setList()[msg.n];
    if (song) {
      if (song.id !== this.rt.songId) {
        this.rt.songId = song.id;
        this.rt.sectionId = null;
        if (song.bpm && !this.rt.clock) this.rt.bpm = song.bpm;
      }
      return res(`song: ${song.name}`);
    }
    // 2. Section trigger: current song first, then any song
    const cur = this.song(this.rt.songId);
    let hit = null;
    if (cur) {
      const sec = cur.sections.find((x) => same(x.trigger));
      if (sec) hit = [cur, sec];
    }
    if (!hit) {
      for (const s of songs) {
        const sec = s.sections.find((x) => same(x.trigger));
        if (sec) { hit = [s, sec]; break; }
      }
    }
    // 3. Default note map: note (base + i) = section i of the current song
    if (!hit && cur && msg.t === 'note') {
      const i = msg.n - (this.show.settings.noteBase ?? 36);
      if (i >= 0 && i < cur.sections.length) hit = [cur, cur.sections[i]];
    }
    if (!hit) return res('no match');
    if (this.rt.mode === 'manual') return res(`${hit[1].name} (ignored: Manual mode)`);
    if (this.sectionsBlocked()) return res(`${hit[1].name} (${this.sectionsBlocked()})`);
    this.goSection(hit[0], hit[1]);
    return res(`${hit[0].name} · ${hit[1].name}`);
  },
};
