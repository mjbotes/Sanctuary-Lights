'use strict';
// Service report: what happened during each service, and what caused it.
// One file per day (reports/YYYY-MM-DD.jsonl), kept for 90 days. Entries:
//   { at, kind: 'song'|'section'|'part'|'cue'|'blackout'|'practice'|'take'|'panic'|'problem'|'fixed', text, by }
// "by" says what caused it: a screen tap, MIDI from the tracks, ProPresenter, timecode, OSC, the
// hardware controller, the schedule, the AI assistant…
const fs = require('fs');
const path = require('path');

const KEEP_DAYS = 90;
const day = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// What caused an action (when the caller did not say)
const SOURCE = [
  [/^midi\./, 'MIDI'], [/^tracks\.marker$/, 'the tracks'], [/^tc\./, 'timecode'], [/^pp\.video$/, 'ProPresenter (video)'], [/^pp\./, 'ProPresenter'],
  [/^osc\./, 'OSC'], [/^order\./, 'service order'], [/^panic$/, 'Panic'],
];

class ServiceLog {
  constructor(app, dir) {
    this.app = app;
    this.dir = dir;
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    this.prune();
    this.devState = null;
    this.timer = setInterval(() => this.watchDevices(), 2000);
  }

  add(kind, text, by, at = Date.now()) {
    const entry = { at, kind, text: String(text).slice(0, 200), ...(by ? { by } : {}) };
    try { fs.appendFileSync(path.join(this.dir, `${day(at)}.jsonl`), `${JSON.stringify(entry)}\n`); } catch {}
    return entry;
  }

  // What the engine shows now (to compare before / after an action)
  snapshot() {
    const e = this.app.engine, rt = e.rt;
    return { songId: rt.songId, sectionId: rt.sectionId, partId: rt.partId, cueIndex: rt.cueIndex, blackout: rt.blackout, practice: !!rt.practice, recording: !!rt.recording };
  }

  // Log what changed between `before` and now
  diff(before, action, source) {
    if (!before) return;
    const e = this.app.engine, rt = e.rt;
    const by = source || (action && (SOURCE.find(([re]) => re.test(action.type)) || [])[1]) || 'a screen';
    if (action && action.type === 'panic') this.add('panic', 'Panic', by);
    const song = e.song(rt.songId);
    if (rt.songId !== before.songId && song) this.add('song', song.name, by);
    if (rt.sectionId !== before.sectionId && song && rt.sectionId) {
      const sec = song.sections.find((s) => s.id === rt.sectionId);
      if (sec) this.add('section', `${song.name} · ${sec.name}`, by);
    }
    if (rt.partId !== before.partId) {
      const p = e.part(rt.partId);
      const auto = rt.partAuto && rt.partResult;
      if (p) this.add('part', p.name, !auto ? by : action && /^pp\./.test(action.type) ? `ProPresenter ${rt.partResult}` : `${by} (${rt.partResult})`);
    }
    if (rt.cueIndex !== before.cueIndex && rt.cueIndex >= 0 && e.show.cues[rt.cueIndex]) this.add('cue', `Cue ${rt.cueIndex + 1}: ${e.show.cues[rt.cueIndex].name}`, by);
    if (rt.blackout !== before.blackout) this.add('blackout', rt.blackout ? 'Blackout on' : 'Blackout off', by);
    if (!!rt.practice !== before.practice) this.add('practice', rt.practice ? 'Practice mode on (real lights frozen)' : 'Practice mode off', by);
    if (!!rt.recording !== before.recording) this.add('take', rt.recording ? 'Recording a live take' : 'Live take recording stopped', by);
  }

  problem(text) {
    this.add('problem', text);
  }

  // Device trouble: ProPresenter / USB-DMX / DMX output dropping out and coming back
  watchDevices() {
    let st;
    try { st = this.app.devices.status(); } catch { return; }
    const s = this.app.engine.show.settings;
    const now = {
      pp: s.pp && s.pp.enabled ? !!(st.pp && st.pp.connected) : null,
      usb: s.enttec ? !!(st.usb && st.usb.state === 'connected') : null,
      out: st.outputError || null,
    };
    const prev = this.devState;
    this.devState = now;
    if (!prev) return;
    if (prev.pp === true && now.pp === false) this.problem(`ProPresenter disconnected${st.pp && st.pp.error ? `: ${st.pp.error}` : ''}`);
    if (prev.pp === false && now.pp === true) this.add('fixed', 'ProPresenter connected again');
    if (prev.usb === true && now.usb === false) this.problem('USB-DMX interface disconnected');
    if (prev.usb === false && now.usb === true) this.add('fixed', 'USB-DMX interface connected again');
    if (now.out && now.out !== prev.out) this.problem(`DMX output: ${now.out}`);
    if (prev.out && !now.out) this.add('fixed', 'DMX output working again');
  }

  days() {
    try {
      return fs.readdirSync(this.dir).filter((f) => /^\d{4}-\d\d-\d\d\.jsonl$/.test(f)).map((f) => f.slice(0, 10)).sort().reverse();
    } catch {
      return [];
    }
  }

  // One day: the entries and a summary (songs with how long each ran, problems, time span)
  report(d = day(Date.now())) {
    if (!/^\d{4}-\d\d-\d\d$/.test(d)) throw new Error('Day must be YYYY-MM-DD');
    let entries = [];
    try {
      entries = fs.readFileSync(path.join(this.dir, `${d}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    } catch {}
    const songs = [];
    for (const [i, en] of entries.entries()) {
      if (en.kind !== 'song') continue;
      const next = entries.slice(i + 1).find((x) => x.kind === 'song' || x.kind === 'part');
      songs.push({ name: en.text, at: en.at, minutes: next ? Math.round((next.at - en.at) / 6000) / 10 : null, sections: entries.slice(i + 1, next ? entries.indexOf(next) : undefined).filter((x) => x.kind === 'section').length });
    }
    return {
      day: d,
      from: entries.length ? entries[0].at : null,
      to: entries.length ? entries[entries.length - 1].at : null,
      songs,
      problems: entries.filter((x) => x.kind === 'problem' || x.kind === 'panic'),
      entries,
    };
  }

  prune() {
    const cutoff = day(Date.now() - KEEP_DAYS * 86400000);
    for (const d of this.days()) if (d < cutoff) try { fs.unlinkSync(path.join(this.dir, `${d}.jsonl`)); } catch {}
  }

  close() {
    clearInterval(this.timer);
  }
}

module.exports = { ServiceLog, day };
