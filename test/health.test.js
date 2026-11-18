'use strict';
// Light health: hours on, the pre-service check, problems until fixed, maintenance reminders
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadConfig } = require('../lib/server/config');
const { App } = require('../lib/server/app');

const quiet = { log() {}, warn() {}, error() {} };
const HOUR = 3600000;

function makeApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-health-'));
  return { dir, app: new App(loadConfig({ LIGHTS_DATA: dir, PORT: '0' }), quiet) };
}

test('hours count only while a light is really on', () => {
  const { app } = makeApp();
  try {
    const e = app.engine;
    const [a, b] = e.show.fixtures.map((f) => f.id);
    const hl = app.health;
    app.run({ type: 'prog.clear' }, 'operator');
    app.run({ type: 'prog.set', fixtures: [a], values: { dim: 1 } }, 'operator');
    app.run({ type: 'prog.set', fixtures: [b], values: { dim: 0 } }, 'operator');
    const t0 = Date.now();
    hl.last = t0;
    for (let i = 1; i <= 60; i++) hl.tick(t0 + i * 60000); // an hour, a minute at a time
    const row = (id) => hl.list().fixtures.find((f) => f.id === id);
    assert.strictEqual(row(a).hours, 1);
    assert.strictEqual(row(b).hours, 0);
    // Blackout and practice mode: not on
    app.run({ type: 'blackout.set', on: true }, 'operator');
    hl.tick(t0 + 61 * 60000);
    assert.strictEqual(row(a).hours, 1);
    app.run({ type: 'blackout.set', on: false }, 'operator');
    app.run({ type: 'practice.set', on: true }, 'operator');
    hl.tick(t0 + 62 * 60000);
    assert.strictEqual(row(a).hours, 1);
    // A gap (computer asleep) is not counted as hours
    app.run({ type: 'practice.set', on: false }, 'operator');
    hl.tick(t0 + 10 * HOUR);
    assert.ok(row(a).hours < 1.1);
  } finally {
    app.close();
  }
});

test('pre-service check: problems are kept, reported, and cleared when fixed', () => {
  const { app, dir } = makeApp();
  try {
    const fx = app.engine.show.fixtures;
    const results = fx.slice(0, 4).map((f, i) => ({ id: f.id, ok: i !== 2, ...(i === 2 ? { problem: 'Flickers' } : {}) }));
    const r = app.run({ type: 'health.check', results }, 'operator');
    assert.strictEqual(r.check.ok, 3);
    assert.deepStrictEqual(r.check.problems, [`${fx[2].name}: Flickers`]);
    assert.strictEqual(r.check.skipped, fx.length - 4);
    let hl = app.fullState().health;
    assert.strictEqual(hl.problems, 1);
    assert.strictEqual(hl.lastCheck.ok, 3);
    const row = hl.fixtures.find((f) => f.id === fx[2].id);
    assert.strictEqual(row.faults[0].text, 'Flickers');
    // The same problem twice is one problem
    app.run({ type: 'health.fault', id: fx[2].id, text: 'Flickers' }, 'operator');
    app.run({ type: 'health.fault', id: fx[2].id, text: 'Wrong colour' }, 'operator');
    assert.strictEqual(app.health.list().fixtures.find((f) => f.id === fx[2].id).faults.length, 2);
    // In the service report
    const rep = app.servicelog.report();
    assert.ok(rep.entries.some((x) => x.kind === 'check' && /3 OK, 1 with a problem/.test(x.text)));
    assert.ok(rep.problems.some((x) => x.text === `${fx[2].name}: Flickers`));
    // Fixed: one, then all
    const first = app.health.list().fixtures.find((f) => f.id === fx[2].id).faults[0];
    app.run({ type: 'health.fixed', id: fx[2].id, faultId: first.id }, 'operator');
    assert.strictEqual(app.health.list().fixtures.find((f) => f.id === fx[2].id).faults.length, 1);
    app.run({ type: 'health.fixed', id: fx[2].id }, 'operator');
    assert.strictEqual(app.health.list().problems, 0);
    assert.ok(app.servicelog.report().entries.some((x) => x.kind === 'fixed' && x.text === `${fx[2].name} fixed`));
    assert.throws(() => app.run({ type: 'health.fault', id: 'nope' }, 'operator'), /No such light/);
    assert.throws(() => app.run({ type: 'health.check', results: [] }, 'volunteer'), /cannot/);
    // Kept on disk
    app.run({ type: 'health.fault', id: fx[0].id, text: "Doesn't move" }, 'operator');
  } finally {
    app.close();
  }
  const again = new App(loadConfig({ LIGHTS_DATA: dir, PORT: '0' }), quiet);
  try {
    const f0 = again.engine.show.fixtures[0].id;
    assert.strictEqual(again.health.list().fixtures.find((f) => f.id === f0).faults[0].text, "Doesn't move");
  } finally {
    again.close();
  }
});

test('maintenance reminders: default, per light, and serviced', () => {
  const { app } = makeApp();
  try {
    const [a, b] = app.engine.show.fixtures.map((f) => f.id);
    app.health.rec(a).ms = 320 * HOUR;
    app.health.rec(b).ms = 100 * HOUR;
    let hl = app.health.list();
    assert.strictEqual(hl.due, 0, 'no reminder set');
    app.run({ type: 'health.remind', every: 300, task: 'Clean the lenses' }, 'operator');
    hl = app.health.list();
    assert.strictEqual(hl.task, 'Clean the lenses');
    assert.deepStrictEqual(hl.fixtures.filter((f) => f.due).map((f) => f.id), [a]);
    // Per light
    app.run({ type: 'health.remind', id: b, every: 50 }, 'operator');
    assert.strictEqual(app.health.list().due, 2);
    app.run({ type: 'health.remind', id: b, every: null }, 'operator');
    assert.strictEqual(app.health.list().fixtures.find((f) => f.id === b).every, 300, 'back to the default');
    // Done: counts from now
    app.run({ type: 'health.serviced', id: a }, 'operator');
    hl = app.health.list();
    const ra = hl.fixtures.find((f) => f.id === a);
    assert.strictEqual(ra.due, false);
    assert.strictEqual(ra.sinceService, 0);
    assert.strictEqual(ra.hours, 320);
    assert.ok(ra.servicedAt);
  } finally {
    app.close();
  }
});
