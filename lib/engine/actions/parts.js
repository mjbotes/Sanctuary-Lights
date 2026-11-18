'use strict';
// Actions – Service parts (Worship, Hosting, Sermon, Video). Each action runs with `this` = the engine; return { show: true } when the saved show changed.
const { cleanPart } = require('../parts');
const { uid, num } = require('../util');

module.exports = {
  'part.go'(a) {
    this.goPart(a.id);
  },

  'part.save'(a) {
    const p = a.part || {};
    const list = this.show.parts;
    const i = list.findIndex((x) => x.id === p.id);
    const cur = i >= 0 ? list[i] : { id: uid() };
    const merged = { ...cur, ...p, id: cur.id, video: cur.video };
    if ('level' in p) merged.level = num(p.level, 'Level');
    if ('fade' in p) merged.fade = num(p.fade, 'Fade');
    const clean = cleanPart(merged, this.show.looks);
    if (i >= 0) list[i] = clean;
    else list.push(clean);
    // Changing the running part takes effect straight away
    if (clean.id === this.rt.partId) this.rt.partFade = { from: this.partLevelAt(), to: clean.level, start: Date.now(), dur: 500 };
    return { show: true };
  },

  'part.delete'(a) {
    const list = this.show.parts;
    const i = this.findIndex(list, a.id);
    if (list[i].video) throw new Error('The Video part is used while videos play. Set its level to 100% if videos should not dim the lights.');
    if (list.filter((p) => p.sections && !p.video).length === 1 && list[i].sections) throw new Error('Keep at least one part where songs change the lights');
    if (this.rt.partId === a.id) this.goPart(list.find((p) => p.id !== a.id && p.sections && !p.video).id);
    list.splice(i, 1);
    return { show: true };
  },

  // ProPresenter started or stopped a video on the main screen
  'pp.video'(a) {
    const pp = this.show.settings.pp;
    const vp = this.show.parts.find((p) => p.video);
    this.rt.ppVideo = a.playing ? { name: String(a.name || '').slice(0, 80), at: Date.now() } : null;
    if (!vp || pp.videoPart === false) return;
    const cur = this.currentPart();
    if (a.playing && cur.id !== vp.id) {
      this.rt.partReturn = cur.id;
      this.goPart(vp.id, { auto: true, reason: `video: ${a.name || 'playing'}` });
    } else if (!a.playing && cur.id === vp.id && this.rt.partAuto) {
      this.goPart(this.rt.partReturn && this.part(this.rt.partReturn) ? this.rt.partReturn : this.show.parts.find((p) => p.sections && !p.video).id, { auto: true, reason: 'video ended' });
    }
  },
};
