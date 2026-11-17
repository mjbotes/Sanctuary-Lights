'use strict';
// Actions – ProPresenter: slide groups, colour sync, importing songs. Each action runs with `this` = the engine; return { show: true } when the saved show changed.
const { uid, clamp01, nameKey, baseKey, matchSection, num } = require('../util');

module.exports = {

  // ----- ProPresenter -----------------------------------------------------------------
  // The live slide changed: follow its group (Verse 1, Chorus...) with the lights.
  'pp.slide'(a) {
    const pp = this.show.settings.pp;
    const pres = a.presentation || {};
    const group = a.group || null;
    this.rt.pp = { presentation: pres, index: a.index, group: group && group.name, color: group && group.color, groups: (a.groups || []).slice(0, 100), result: '' };
    const note = (t) => { this.rt.pp.result = t; };
    // Song with the same name as the presentation
    let song = this.show.songs.find((x) => x.id === this.rt.songId);
    if (pp.songs && pres.name) {
      const match = this.show.songs.find((x) => nameKey(x.name) === nameKey(pres.name));
      if (match && match.id !== this.rt.songId) this.actions['song.select'].call(this, { id: match.id });
      if (match) song = match;
    }
    if (pp.colorMode === 'group' && group && group.color) this.applyScreenColor(group.color);
    if (!pp.sections || !group || !group.name) return note(group ? '' : 'slide has no group');
    if (this.rt.mode === 'manual') return note(`${group.name} (ignored: Manual mode)`);
    if (this.rt.hold) return note(`${group.name} (ignored: Hold is on)`);
    const sec = song && matchSection(song.sections, group.name);
    if (sec) {
      if (sec.id !== this.rt.sectionId) this.goSection(song, sec);
      return note(`${song.name} · ${sec.name}`);
    }
    // No song section: use a look with the same name (e.g. "Chorus")
    const look = this.show.looks.find((l) => nameKey(l.name) === nameKey(group.name)) || this.show.looks.find((l) => baseKey(l.name) === baseKey(group.name));
    if (look) {
      if (!(this.rt.base.kind === 'look' && this.rt.base.lookId === look.id)) {
        this.rt.sectionId = null;
        this.setBase({ kind: 'look', lookId: look.id }, 1);
      }
      return note(`look ${look.name}`);
    }
    note(`${group.name}: no matching section or look`);
  },

  // Colour taken from the slide image (computed by the app window)
  'pp.color'(a) {
    if (this.show.settings.pp.colorMode !== 'slide') return { runtime: false };
    const key = String(a.key || '');
    if (key && key === this.lastPpColorKey) return { runtime: false };
    this.lastPpColorKey = key;
    this.applyScreenColor((a.rgb || []).map((v) => clamp01(num(v, 'Colour'))));
  },

  'pp.status'(a) {
    this.rt.ppStatus = a.status || null;
  },

  // Make a song from the live presentation: same name, one section per group.
  'pp.importSong'() {
    const pp = this.rt.pp;
    if (!pp || !pp.presentation || !pp.presentation.name) throw new Error('No ProPresenter presentation is live');
    const names = [...new Set((pp.groups || []).filter(Boolean))];
    let song = this.show.songs.find((x) => nameKey(x.name) === nameKey(pp.presentation.name));
    if (!song) {
      this.actions['song.add'].call(this, { name: pp.presentation.name });
      song = this.show.songs.at(-1);
    }
    for (const n of names) if (!song.sections.some((x) => nameKey(x.name) === nameKey(n))) song.sections.push({ id: uid(), name: n.slice(0, 40), lookId: this.guessLook(n), fade: 1, trigger: null });
    this.rt.songId = song.id;
    return { show: true };
  },
};
