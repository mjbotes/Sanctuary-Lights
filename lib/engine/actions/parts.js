'use strict';
// Actions – Service parts (Worship, Hosting, Sermon, Video). Each action runs with `this` = the engine; return { show: true } when the saved show changed.
const { cleanPart } = require('../parts');
const { uid, num } = require('../util');

const wordsOf = (m) => String(m || '').split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);

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
    // A new part from a template can name its look: use a look with that name if there is one
    if (p.lookName && !('lookId' in p)) {
      const l = this.show.looks.find((x) => x.name.toLowerCase() === String(p.lookName).toLowerCase());
      if (l) merged.lookId = l.id;
    }
    delete merged.lookName;
    const clean = cleanPart(merged, this.show.looks);
    if (i >= 0) list[i] = clean;
    else list.push(clean);
    // Each word picks one part: "offering" moves from Hosting to a new Offering part
    const words = wordsOf(clean.match);
    if (words.length) {
      for (const other of list) {
        if (other === clean) continue;
        const kept = wordsOf(other.match).filter((w) => !words.includes(w));
        if (kept.length !== wordsOf(other.match).length) other.match = kept.join(', ');
      }
    }
    // Changing the running part takes effect straight away
    if (clean.id === this.rt.partId) this.rt.partFade = { from: this.partLevelAt(), to: clean.level, start: Date.now(), dur: 500 };
    return { show: true };
  },

  'part.move'(a) {
    const list = this.show.parts;
    const i = this.findIndex(list, a.id);
    const j = i + (a.dir < 0 ? -1 : 1);
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    return { show: true };
  },

  // Record what is on stage now as this part's look (a look with the part's name), and switch to the part.
  'part.recordLook'(a) {
    const part = this.show.parts[this.findIndex(this.show.parts, a.id)];
    const before = { ...this.rt.base }; // the song / cue lights to come back to
    let look = this.show.looks.find((l) => l.id === part.lookId) || this.show.looks.find((l) => l.name.toLowerCase() === part.name.toLowerCase());
    if (look) this.actions['look.update'].call(this, { id: look.id });
    else {
      this.actions['look.record'].call(this, { name: part.name });
      look = this.show.looks.at(-1);
    }
    part.lookId = look.id;
    if (this.rt.partId !== part.id) {
      // The look is already on stage: just make this the running part
      if (!this.currentPart().lookId) this.rt.partBase = before;
      this.rt.partFade = { from: this.partLevelAt(), to: part.level, start: Date.now(), dur: 500 };
      this.rt.partId = part.id;
      this.rt.partAuto = false;
    }
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
