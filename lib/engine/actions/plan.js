'use strict';
// Actions – Service order (run of show), Planning Center plans, schedule.
// Each action runs with `this` = the engine; return { show: true } when the saved show changed.
const { uid, nameKey, num } = require('../util');
const { normalizeSong } = require('../defaults');

const NOTES = { c: 0, 'c#': 1, db: 1, d: 2, 'd#': 3, eb: 3, e: 4, f: 5, 'f#': 6, gb: 6, g: 7, 'g#': 8, ab: 8, a: 9, 'a#': 10, bb: 10, b: 11 };

// "B", "Bb", "F#m", "C#min" -> { key: 0-11, minor } or null
function parseKey(text) {
  const m = /^\s*([A-Ga-g])([#b♯♭]?)\s*(m(?:in(?:or)?)?)?\b/.exec(String(text || ''));
  if (!m) return null;
  const k = NOTES[(m[1] + m[2].replace('♯', '#').replace('♭', 'b')).toLowerCase()];
  return k === undefined ? null : { key: k, minor: !!m[3] };
}

// Arrangement sequence ["Verse 1", "Chorus", "Chorus"] -> unique section names ["Verse 1", "Chorus", "Chorus 2"]
function sectionNames(seq) {
  const out = [];
  for (const raw of Array.isArray(seq) ? seq : String(seq || '').split(',')) {
    const n = String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 36);
    if (!n) continue;
    if (!out.includes(n)) { out.push(n); continue; }
    // A repeat: "Chorus" -> "Chorus 2", "Chorus 3"… (skipping names already used)
    const base = n.replace(/\s*\d+$/, '');
    let i = 2;
    while (out.includes(`${base} ${i}`)) i++;
    out.push(`${base} ${i}`);
  }
  return out;
}

const DAYS = [0, 1, 2, 3, 4, 5, 6];
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

function cleanEntry(e, show) {
  const kind = ['part', 'look', 'blackout', 'unblackout', 'master'].includes(e.kind) ? e.kind : 'part';
  return {
    id: String(e.id || uid()),
    on: e.on !== false,
    days: [...new Set((Array.isArray(e.days) ? e.days : []).map(Number).filter((d) => DAYS.includes(d)))].sort(),
    time: TIME.test(e.time) ? e.time : '09:30',
    kind,
    target: kind === 'part' ? (show.parts.some((p) => p.id === e.target) ? e.target : (show.parts[0] || {}).id || null)
      : kind === 'look' ? (show.looks.some((l) => l.id === e.target) ? e.target : null)
        : kind === 'master' ? Math.max(0, Math.min(1, Number(e.target) || 0)) : null,
    label: String(e.label || '').slice(0, 60),
  };
}

module.exports = {
  parseKey,
  sectionNames,
  cleanEntry,

  actions: {
    // ----- Planning Center ------------------------------------------------------------
    // plan: { title, date, items: [{ title, kind: 'song'|'header'|'media'|'item', song?: { title, key, bpm, sequence } }] }
    // (lib/pco.js reads it from Planning Center and turns it into this shape.)
    'plan.import'(a) {
      const plan = a.plan || {};
      const items = Array.isArray(plan.items) ? plan.items.slice(0, 200) : [];
      if (!items.length) throw new Error('That plan has no items');
      const songsInOrder = [];
      const created = [];
      let restored = 0, rearranged = 0;
      const order = [];
      const videoPart = this.show.parts.find((p) => p.video);
      for (const it of items) {
        const title = String(it.title || '').trim().slice(0, 80);
        if (it.kind === 'song') {
          const info = it.song || {};
          const name = String(info.title || title || 'Song').slice(0, 80);
          let song = this.findSong(name, info.id);
          const names = sectionNames(info.sequence);
          if (!song) {
            song = normalizeSong({ id: uid(), name, notes: '', trigger: null, sections: names.map((n) => ({ id: uid(), name: n, lookId: this.guessLook(n), fade: 1, trigger: null })) });
            this.show.songs.push(song);
            created.push(song);
          } else {
            // A song lit before stays lit: it comes back from the library, and this week's
            // arrangement keeps every section's look (new sections get the look of their kind)
            if (song.archived) { this.restoreSong(song); restored++; }
            if (a.arrangement !== false && this.applyArrangement(song, names)) rearranged++;
          }
          if (info.id) song.pcoId = String(info.id);
          // Key and tempo from the plan, unless the song already has them
          const k = parseKey(info.key);
          if (k && (song.key === null || song.key === undefined)) Object.assign(song, k);
          const bpm = Number(info.bpm);
          if (bpm >= 30 && bpm <= 300 && !song.bpm) song.bpm = Math.round(bpm * 10) / 10;
          if (!songsInOrder.includes(song)) songsInOrder.push(song);
          order.push({ id: uid(), title: name, kind: 'song', songId: song.id, detail: [info.key, info.bpm ? `${info.bpm} BPM` : ''].filter(Boolean).join(' · ') });
        } else if (it.kind === 'header') {
          order.push({ id: uid(), title, kind: 'header' });
        } else {
          // Videos -> the Video part; others by the words of each part ("Sermon", "Welcome"…)
          const part = it.kind === 'media' && videoPart ? videoPart : this.partForPresentation(title);
          order.push({ id: uid(), title, kind: part ? 'part' : 'note', partId: part ? part.id : undefined });
        }
      }
      // The set list: this service's songs, in order. Other songs go to the library (still lit)
      // unless setOnly is false, then they stay after these.
      if (a.setOnly !== false) for (const s of this.show.songs) if (!songsInOrder.includes(s) && !s.archived) { this.rememberSections(s); s.archived = true; }
      this.show.songs = [...songsInOrder, ...this.show.songs.filter((s) => !songsInOrder.includes(s) && !s.archived), ...this.show.songs.filter((s) => !songsInOrder.includes(s) && s.archived)];
      // New songs get a lighting design straight away (when there are lights to design with)
      let designed = 0;
      if (a.design !== false && this.show.fixtures.length) {
        for (const s of created) if (s.sections.length) { this.designSong(s); designed++; }
      }
      this.show.order = { title: String(plan.title || 'Service').slice(0, 80), date: String(plan.date || '').slice(0, 40), source: String(a.source || 'planning-center'), items: order };
      this.rt.orderItemId = null;
      this.lastResult = { songs: songsInOrder.length, created: created.length, restored, rearranged, designed, items: order.length };
      return { show: true };
    },

    // Go to an item of the service order (id), or the next / previous one (dir)
    'order.go'(a) {
      const items = (this.show.order && this.show.order.items) || [];
      const usable = items.filter((x) => x.kind !== 'header');
      if (!usable.length) throw new Error('No service order yet');
      let item;
      if (a.id) item = items.find((x) => x.id === a.id);
      else {
        const i = usable.findIndex((x) => x.id === this.rt.orderItemId);
        item = usable[Math.max(0, Math.min(usable.length - 1, i + (a.dir < 0 ? -1 : 1)))];
      }
      if (!item) throw new Error('No such item');
      this.rt.orderItemId = item.id;
      if (item.kind === 'song') {
        const song = this.song(item.songId);
        if (!song) throw new Error('That song was deleted');
        this.actions['song.select'].call(this, { id: song.id });
        this.partForSections();
        if (song.sections[0]) this.goSection(song, song.sections[0]);
      } else if (item.kind === 'part' && this.part(item.partId)) {
        this.goPart(item.partId);
      }
    },

    'order.clear'() {
      this.show.order = null;
      this.rt.orderItemId = null;
      return { show: true };
    },

    // ----- schedule -------------------------------------------------------------------
    'schedule.save'(a) {
      const e = cleanEntry(a.entry || {}, this.show);
      const i = this.show.schedule.findIndex((x) => x.id === e.id);
      if (i >= 0) this.show.schedule[i] = e;
      else this.show.schedule.push(e);
      return { show: true };
    },

    'schedule.delete'(a) {
      this.show.schedule.splice(this.findIndex(this.show.schedule, a.id), 1);
      return { show: true };
    },

    // Run one entry now (the "Test" button)
    'schedule.run'(a) {
      this.runScheduleEntry(this.show.schedule[this.findIndex(this.show.schedule, a.id)]);
    },
  },

  methods: {
    // Called often (from computeLook): runs schedule entries when their minute comes.
    // Times are the lighting computer's own clock. An entry runs at most once a day, and only
    // within 2 minutes of its time (a computer switched on later does not run old entries).
    scheduleTick(now) {
      if (now - (this.lastScheduleCheck || 0) < 1000) return;
      this.lastScheduleCheck = now;
      const d = new Date(now);
      const day = d.getDay();
      const mins = d.getHours() * 60 + d.getMinutes();
      const date = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
      this.scheduleDone = this.scheduleDone || new Set();
      for (const e of this.show.schedule || []) {
        if (!e.on || !e.days.includes(day)) continue;
        const [hh, mm] = e.time.split(':').map(Number);
        const at = hh * 60 + mm;
        const key = `${e.id}@${date}`;
        if (mins >= at && mins <= at + 2 && !this.scheduleDone.has(key)) {
          this.scheduleDone.add(key);
          try {
            this.runScheduleEntry(e);
            this.rt.lastSchedule = { id: e.id, at: now };
            this.emit('changed');
          } catch (err) {
            this.emit('log', `Schedule ${e.time}: ${err.message}`);
          }
        }
      }
    },

    runScheduleEntry(e) {
      if (e.kind === 'part' && this.part(e.target)) this.goPart(e.target);
      else if (e.kind === 'look' && this.show.looks.some((l) => l.id === e.target)) this.actions['look.apply'].call(this, { id: e.target });
      else if (e.kind === 'blackout') this.rt.blackout = true;
      else if (e.kind === 'unblackout') this.rt.blackout = false;
      else if (e.kind === 'master') this.rt.gm = Number(e.target) || 0;
    },
  },
};
