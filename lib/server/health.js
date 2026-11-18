'use strict';
// Light health: how long each light has been on, problems people found (the pre-service check),
// and maintenance reminders ("clean the lens every 300 hours").
//
// DMX only goes one way, so the app cannot hear a broken light; people tell it, with the guided
// pre-service check (Setup → Light health), and it remembers until someone taps "Fixed".
//
// Kept in dataDir/health.json, not in the show file: it belongs to the real lights in this room.
//   { fixtures: { [fixtureId]: { ms, serviceMs, servicedAt, every, faults: [{ id, at, text, by }] } },
//     every: hours (default reminder, 0 = none), task: 'Clean the lenses and fans', checks: [{ at, ok, problems, skipped, by }] }
const crypto = require('crypto');
const { readJson, writeJsonAtomic } = require('./store');

const ON = 0.02; // brighter than this counts as on
const HOUR = 3600000;
const PROBLEMS = ["Doesn't light up", 'Wrong colour', "Doesn't move", 'Flickers', 'Pointing the wrong way', 'Wrong light answered'];

class Health {
  constructor(app, file) {
    this.app = app;
    this.file = file;
    const d = readJson(file) || {};
    this.data = {
      fixtures: d.fixtures && typeof d.fixtures === 'object' ? d.fixtures : {},
      every: Number.isFinite(d.every) ? d.every : 0,
      task: typeof d.task === 'string' ? d.task : 'Clean the lenses and fans',
      checks: Array.isArray(d.checks) ? d.checks.slice(-20) : [],
    };
    this.last = Date.now();
    this.dirty = false;
    this.timer = setInterval(() => this.tick(), 5000);
    this.saveTimer = setInterval(() => this.save(), 60000);
  }

  rec(fid) {
    return (this.data.fixtures[fid] ||= { ms: 0, serviceMs: 0, servicedAt: null, every: null, faults: [] });
  }

  // Add the time since the last tick to every light that is on (what the real lights do: not in practice mode)
  tick(now = Date.now()) {
    const dt = Math.min(now - this.last, 60000);
    this.last = now;
    const e = this.app.engine;
    const look = this.app.latestLook;
    if (!look || e.rt.practice || dt <= 0) return;
    const master = e.rt.blackout ? 0 : e.rt.gm * e.partLevelAt(now);
    for (const f of e.show.fixtures) {
      const v = look[f.id];
      if (!v) continue;
      const level = ('dim' in v ? v.dim : 1) * e.masterFor(f.id, master);
      if (level > ON) {
        this.rec(f.id).ms += dt;
        this.dirty = true;
      }
    }
  }

  save(force = false) {
    if (!this.dirty && !force) return;
    this.dirty = false;
    try { writeJsonAtomic(this.file, this.data); } catch {}
  }

  changed() {
    this.save(true);
    this.app.pushState();
  }

  everyFor(fid) {
    const r = this.data.fixtures[fid];
    return r && Number.isFinite(r.every) && r.every !== null ? r.every : this.data.every;
  }

  // Summary for the screens and the AI assistant
  list() {
    const fixtures = this.app.engine.show.fixtures.map((f) => {
      const r = this.data.fixtures[f.id] || { ms: 0, serviceMs: 0, faults: [] };
      const every = this.everyFor(f.id);
      const since = (r.ms - (r.serviceMs || 0)) / HOUR;
      return {
        id: f.id, name: f.name,
        hours: Math.round((r.ms / HOUR) * 10) / 10,
        sinceService: Math.round(since * 10) / 10,
        every, due: every > 0 && since >= every,
        servicedAt: r.servicedAt || null,
        faults: r.faults || [],
      };
    });
    return {
      fixtures,
      every: this.data.every,
      task: this.data.task,
      lastCheck: this.data.checks[this.data.checks.length - 1] || null,
      problems: fixtures.filter((f) => f.faults.length).length,
      due: fixtures.filter((f) => f.due).length,
      problemList: PROBLEMS,
    };
  }

  addFault(fid, text, by) {
    const r = this.rec(fid);
    text = String(text || "Doesn't work").slice(0, 120);
    if (r.faults.some((x) => x.text === text)) return null;
    const fault = { id: crypto.randomUUID().slice(0, 8), at: Date.now(), text, ...(by ? { by } : {}) };
    r.faults.push(fault);
    return fault;
  }

  name(fid) {
    const f = this.app.engine.show.fixtures.find((x) => x.id === fid);
    if (!f) throw new Error('No such light');
    return f.name;
  }

  // Actions (from App.special): health.check, health.fault, health.fixed, health.serviced, health.remind
  action(a) {
    const log = this.app.servicelog;
    switch (a.type) {
      // The guided check: [{ id, ok, problem? }] for each light looked at
      case 'health.check': {
        const results = (Array.isArray(a.results) ? a.results : []).filter((r) => r && this.app.engine.show.fixtures.some((f) => f.id === r.id));
        const problems = [];
        for (const r of results) {
          if (r.ok) continue;
          const name = this.name(r.id);
          this.addFault(r.id, r.problem, 'pre-service check');
          problems.push(`${name}: ${r.problem || "Doesn't work"}`);
        }
        const check = { at: Date.now(), ok: results.filter((r) => r.ok).length, problems, skipped: Math.max(0, this.app.engine.show.fixtures.length - results.length) };
        this.data.checks.push(check);
        this.data.checks = this.data.checks.slice(-20);
        if (log) {
          log.add('check', `Pre-service check: ${check.ok} OK${problems.length ? `, ${problems.length} with a problem` : ''}${check.skipped ? `, ${check.skipped} not checked` : ''}`, 'the pre-service check');
          for (const p of problems) log.problem(p);
        }
        this.changed();
        return { check };
      }
      case 'health.fault': {
        const name = this.name(a.id);
        const f = this.addFault(a.id, a.text, a.by);
        if (f && log) log.problem(`${name}: ${f.text}`);
        this.changed();
        return { fault: f };
      }
      // A light works again: one problem (faultId) or all of them
      case 'health.fixed': {
        const name = this.name(a.id);
        const r = this.rec(a.id);
        const before = r.faults.length;
        r.faults = a.faultId ? r.faults.filter((x) => x.id !== a.faultId) : [];
        if (before !== r.faults.length && log) log.add('fixed', `${name} fixed`);
        this.changed();
        return { left: r.faults.length };
      }
      // Maintenance done: the reminder counts from now
      case 'health.serviced': {
        const ids = a.id ? [a.id] : this.app.engine.show.fixtures.map((f) => f.id);
        for (const id of ids) {
          this.name(id);
          const r = this.rec(id);
          r.serviceMs = r.ms;
          r.servicedAt = Date.now();
        }
        this.changed();
        return { serviced: ids.length };
      }
      // Reminder every N hours: for one light (id; null = use the default) or the default for all
      case 'health.remind': {
        const hours = a.every === null || a.every === '' ? null : Math.max(0, Math.min(100000, Number(a.every) || 0));
        if (a.id) {
          this.name(a.id);
          this.rec(a.id).every = hours;
        } else {
          this.data.every = hours || 0;
          if (typeof a.task === 'string') this.data.task = a.task.slice(0, 80);
        }
        this.changed();
        return { every: hours };
      }
      default:
        return null;
    }
  }

  close() {
    clearInterval(this.timer);
    clearInterval(this.saveTimer);
    this.save();
  }
}

module.exports = { Health, PROBLEMS };
