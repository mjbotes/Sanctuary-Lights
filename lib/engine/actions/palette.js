'use strict';
// Actions – Primary / secondary / tertiary colours. Each action runs with `this` = the engine; return { show: true } when the saved show changed.
const { isHex, rgbToHex, palIndex, num } = require('../util');

module.exports = {

  // ----- palette ------------------------------------------------------------------------
  // Set primary (0) / secondary (1) / tertiary (2). Goes into the current song's colours,
  // or the default colours when no song is picked (or scope 'show'). scope 'live' = until the song changes.
  'palette.set'(a) {
    const i = Number.isInteger(a.index) ? a.index : palIndex(a.role);
    if (!(i >= 0 && i < 3)) throw new Error('Choose primary, secondary or tertiary');
    const hex = Array.isArray(a.rgb) ? rgbToHex(a.rgb.map((v) => num(v, 'Colour'))) : String(a.color || '').toLowerCase();
    if (!isHex(hex)) throw new Error('Colour must be like #ff8800');
    if (a.scope === 'live') {
      this.rt.paletteLive[i] = hex;
      return;
    }
    const song = this.show.songs.find((x) => x.id === this.rt.songId);
    delete this.rt.paletteLive[i];
    if (song && a.scope !== 'show') {
      song.palette = [...(song.palette || this.show.palette)];
      song.palette[i] = hex;
    } else this.show.palette[i] = hex;
    return { show: true };
  },

  'palette.reset'(a) {
    const song = this.show.songs.find((x) => x.id === (a.songId || this.rt.songId));
    if (song) song.palette = null;
    this.rt.paletteLive = {};
    return { show: true };
  },

  'palette.release'() {
    this.rt.paletteLive = {};
  },
};
