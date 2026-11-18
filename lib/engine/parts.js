'use strict';
// Engine methods – Service parts: Worship, Hosting, Sermon, Video…
// A part decides what drives the lights during that part of the service:
//   lookId       the look to show (null = keep the song / cue lights, e.g. Worship)
//   level        overall brightness (Video: 0.1 = almost blackout)
//   fade         seconds to change into this part
//   sections     song sections (MIDI, tracks, ProPresenter groups, timecode) change the lights
//   screenColor  lights follow the ProPresenter screen colour
//   match        words in a ProPresenter presentation name that pick this part ("sermon, message")
//   video        the part used while a ProPresenter video plays
const { uid } = require('./util');

function defaultParts() {
  return [
    { id: 'worship', name: 'Worship', lookId: null, level: 1, fade: 2, sections: true, screenColor: true, match: '' },
    { id: 'hosting', name: 'Hosting', lookId: null, level: 1, fade: 2, sections: false, screenColor: false, match: 'welcome, announcement, notices, offering, giving, host' },
    { id: 'sermon', name: 'Sermon', lookId: null, level: 1, fade: 3, sections: false, screenColor: false, match: 'sermon, message, preach, scripture, reading, notes' },
    { id: 'video', name: 'Video', lookId: null, level: 0.1, fade: 1.5, sections: false, screenColor: false, match: '', video: true },
  ];
}

const clean = (p, looks) => ({
  id: String(p.id || uid()),
  name: String(p.name || 'Part').slice(0, 30),
  lookId: looks.some((l) => l.id === p.lookId) ? p.lookId : null,
  level: Number.isFinite(p.level) ? Math.max(0, Math.min(1, p.level)) : 1,
  fade: Number.isFinite(p.fade) ? Math.max(0, Math.min(30, p.fade)) : 2,
  sections: p.sections !== false,
  screenColor: p.screenColor !== false,
  match: String(p.match || '').slice(0, 200),
  ...(p.video ? { video: true } : {}),
});

function normalizeParts(show) {
  const looks = show.looks || [];
  if (!Array.isArray(show.parts) || !show.parts.length) {
    show.parts = defaultParts();
    // Use looks that are already called "Hosting", "Sermon" or "Video"
    for (const p of show.parts) {
      const l = looks.find((x) => x.name.toLowerCase() === p.name.toLowerCase());
      if (l) p.lookId = l.id;
    }
  }
  show.parts = show.parts.map((p) => clean(p, looks));
  return show.parts;
}

module.exports = {
  defaultParts,
  normalizeParts,
  cleanPart: clean,

  methods: {
    part(id) {
      return this.show.parts.find((p) => p.id === id) || null;
    },

    // The part running now (Worship-like defaults if there is none)
    currentPart() {
      return this.part(this.rt.partId) || this.show.parts.find((p) => p.sections && !p.video) || { id: null, name: '', lookId: null, level: 1, sections: true, screenColor: true };
    },

    // Why automatic section changes are ignored right now (null = they are allowed)
    sectionsBlocked() {
      const p = this.currentPart();
      return p.sections ? null : `ignored: ${p.name}`;
    },

    // Brightness of the current part, fading between parts
    partLevelAt(now = Date.now()) {
      const f = this.rt.partFade;
      if (!f) return this.currentPart().level;
      const t = f.dur > 0 ? Math.min(1, (now - f.start) / f.dur) : 1;
      if (t >= 1) {
        this.rt.partFade = null;
        return f.to;
      }
      return f.from + (f.to - f.from) * t;
    },

    // Switch to a part. opts.auto: switched by ProPresenter (a video, a presentation name).
    goPart(id, opts = {}) {
      const next = this.part(id);
      if (!next) throw new Error('No such part');
      const prev = this.currentPart();
      if (prev.id === next.id) return;
      const now = Date.now();
      this.rt.partFade = { from: this.partLevelAt(now), to: next.level, start: now, dur: next.fade * 1000 };
      const look = next.lookId && this.show.looks.find((l) => l.id === next.lookId);
      if (look) {
        // Remember the song / cue lights to come back to
        if (!(prev.lookId && this.show.looks.some((l) => l.id === prev.lookId))) this.rt.partBase = { ...this.rt.base };
        this.setBase({ kind: 'look', lookId: look.id }, next.fade);
      } else if (prev.lookId) {
        // Back to the song lights: the current section's look, or what was on before
        const song = this.song(this.rt.songId);
        const sec = song && song.sections.find((x) => x.id === this.rt.sectionId);
        const secLook = sec && sec.lookId && this.show.looks.find((l) => l.id === sec.lookId);
        if (secLook) this.setBase({ kind: 'look', lookId: secLook.id }, next.fade);
        else if (this.rt.partBase) this.setBase(this.rt.partBase, next.fade);
      }
      if (!next.screenColor) this.clearScreenColor();
      this.rt.partId = next.id;
      this.rt.partAuto = !!opts.auto;
      this.rt.partResult = opts.reason || '';
    },

    // A deliberate section change (operator tap, /sl/next): back to the worship part first.
    partForSections() {
      if (this.currentPart().sections) return;
      const w = this.show.parts.find((p) => p.sections && !p.video);
      if (w) this.goPart(w.id);
    },

    // The part a ProPresenter presentation name points to (by the words in each part's "match")
    partForPresentation(name) {
      const n = String(name || '').toLowerCase();
      if (!n) return null;
      for (const p of this.show.parts) {
        const words = p.match.split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
        if (words.some((w) => n.includes(w))) return p;
      }
      return null;
    },

    // Undo colours that came from the screen (so a sermon look shows its own colours)
    clearScreenColor() {
      const sc = this.rt.screenColored;
      if (!sc) return;
      if (sc.primary) delete this.rt.paletteLive[0];
      for (const gid of sc.groups || []) if (this.rt.busk[gid]) this.rt.busk[gid].color = null;
      this.rt.screenColored = null;
    },
  },
};
