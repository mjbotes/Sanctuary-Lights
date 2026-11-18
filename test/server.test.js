'use strict';
// Server-level behaviour: undo/redo, snapshots, access control (PIN roles).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadConfig } = require('../lib/server/config');
const { App } = require('../lib/server/app');
const { History } = require('../lib/server/history');
const { requiredRole } = require('../lib/server/auth');

const quiet = { log() {}, warn() {}, error() {} };
function makeApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-test-'));
  const cfg = loadConfig({ LIGHTS_DATA: dir, PORT: '0' });
  const app = new App(cfg, quiet);
  return { app, dir, done: () => { app.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('undo and redo show changes, live changes are not undo steps', () => {
  const { app, done } = makeApp();
  try {
    const cues = () => app.engine.show.cues.map((c) => c.name);
    app.run({ type: 'cue.record', name: 'A' });
    app.run({ type: 'cue.record', name: 'B' });
    app.run({ type: 'gm.set', value: 0.5 }); // live: no undo step
    assert.deepStrictEqual(cues(), ['A', 'B']);
    assert.strictEqual(app.history.status().undo, 'Record cue');
    assert.deepStrictEqual(app.run({ type: 'history.undo' }), { label: 'Record cue' });
    assert.deepStrictEqual(cues(), ['A']);
    assert.strictEqual(app.engine.rt.gm, 0.5, 'live state is kept');
    app.run({ type: 'history.redo' });
    assert.deepStrictEqual(cues(), ['A', 'B']);
    app.run({ type: 'history.undo' });
    app.run({ type: 'history.undo' });
    assert.deepStrictEqual(cues(), []);
    assert.throws(() => app.run({ type: 'history.undo' }), /Nothing to undo/);
  } finally {
    done();
  }
});

test('quick repeats of the same edit are one undo step', () => {
  const h = new History();
  h.record('stem.edit', 'stem.edit|x', 'v0');
  h.record('stem.edit', 'stem.edit|x', 'v1');
  h.record('stem.edit', 'stem.edit|y', 'v2');
  assert.strictEqual(h.undoStack.length, 2);
  assert.strictEqual(h.undo('now').json, 'v2');
  assert.strictEqual(h.undo('v2').json, 'v0');
});

test('snapshots save and restore, and restoring can be undone', () => {
  const { app, done } = makeApp();
  try {
    app.run({ type: 'cue.record', name: 'Before' });
    const { name } = app.run({ type: 'snapshot.save', label: 'Sunday 9am' });
    assert.match(name, /^saved-.*Sunday_9am\.json$/);
    app.run({ type: 'cue.record', name: 'After' });
    const list = app.run({ type: 'snapshot.list' }).snapshots;
    assert.strictEqual(list[0].label, 'Sunday 9am');
    app.run({ type: 'snapshot.restore', name });
    assert.deepStrictEqual(app.engine.show.cues.map((c) => c.name), ['Before']);
    app.run({ type: 'history.undo' });
    assert.deepStrictEqual(app.engine.show.cues.map((c) => c.name), ['Before', 'After']);
  } finally {
    done();
  }
});

test('PIN roles: volunteer runs, operator programs, admin patches', () => {
  const { app, done } = makeApp();
  try {
    assert.strictEqual(app.auth.enabled, false);
    app.run({ type: 'access.set', admin: '1234', operator: '5678', volunteer: '0000' });
    assert.strictEqual(app.auth.enabled, true);
    assert.strictEqual(app.auth.login('9999'), null);
    const vol = app.auth.login('0000');
    const op = app.auth.login('5678');
    const adm = app.auth.login('1234');
    assert.deepStrictEqual([vol.role, op.role, adm.role], ['volunteer', 'operator', 'admin']);
    app.run({ type: 'cue.go' }, 'volunteer');
    assert.throws(() => app.run({ type: 'cue.record', name: 'x' }, 'volunteer'), /cannot/);
    app.run({ type: 'cue.record', name: 'x' }, 'operator');
    assert.throws(() => app.run({ type: 'fixture.delete', fixtures: [] }, 'operator'), /cannot/);
    assert.throws(() => app.run({ type: 'access.set', admin: '1111' }, 'operator'), /cannot/);
    app.run({ type: 'fixture.delete', fixtures: [] }, 'admin');
    assert.throws(() => app.run({ type: 'cue.go' }, null), /PIN/);
    // PIN hashes are never sent to screens
    assert.deepStrictEqual(app.publicShow().settings.access, { enabled: true, localAdmin: true, levels: ['admin', 'operator', 'volunteer'] });
    assert.throws(() => app.run({ type: 'access.set', admin: 'abc' }), /4 to 8 digits/);
    // Undo never brings back old PINs
    app.run({ type: 'cue.record', name: 'y' });
    app.run({ type: 'history.undo' });
    assert.strictEqual(app.auth.enabled, true);
  } finally {
    done();
  }
});

test('required roles', () => {
  assert.strictEqual(requiredRole('cue.go'), 'volunteer');
  assert.strictEqual(requiredRole('pad.press'), 'volunteer');
  assert.strictEqual(requiredRole('fixture.identify'), 'operator');
  assert.strictEqual(requiredRole('fixture.delete'), 'admin');
  assert.strictEqual(requiredRole('cue.record'), 'operator');
  assert.strictEqual(requiredRole('history.undo'), 'operator');
  assert.strictEqual(requiredRole('fixture.add'), 'admin');
  assert.strictEqual(requiredRole('settings.update'), 'admin');
});

test('panic drops live changes and goes to the safe look', () => {
  const { app, done } = makeApp();
  try {
    const e = app.engine;
    const f = e.show.fixtures[0].id;
    app.run({ type: 'prog.set', fixtures: [f], values: { dim: 0.5 } });
    app.run({ type: 'look.record', name: 'Safe' });
    app.run({ type: 'settings.update', settings: { safeLookId: e.show.looks.at(-1).id } });
    app.run({ type: 'look.record', name: 'Other' });
    app.run({ type: 'strobe.hold', on: true });
    app.run({ type: 'gm.set', value: 0.2 });
    app.run({ type: 'prog.set', fixtures: [f], values: { dim: 1 } });
    app.run({ type: 'panic' }, 'volunteer');
    assert.strictEqual(e.rt.strobe, false);
    assert.strictEqual(e.rt.gm, 1);
    assert.deepStrictEqual(e.programmer, {});
    assert.strictEqual(e.computeLook(Date.now() + 2000)[f].dim, 0.5);
  } finally {
    done();
  }
});
