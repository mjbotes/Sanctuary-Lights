'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Engine, emptyShow } = require('../lib/engine');

function setup() {
  const show = emptyShow();
  show.fixtures = [0, 1, 2, 3].map((i) => ({ id: `f${i}`, name: `F${i}`, profile: 'drgb', universe: 1, address: 1 + i * 4, x: i / 3, y: 0.5 }));
  show.fixtures.push({ id: 'h', name: 'Haze', profile: 'haze', universe: 1, address: 100, x: 0, y: 0 });
  show.groups = [{ id: 'g', name: 'All', fixtures: ['f0', 'f1', 'f2', 'f3', 'h'] }];
  const e = new Engine(show);
  e.dispatch({ type: 'prog.set', fixtures: ['f0', 'f1', 'f2', 'f3'], values: { dim: 1 } });
  e.dispatch({ type: 'look.record', name: 'Full' });
  return e;
}

test('group fader scales intensity, flash brings it to full', () => {
  const e = setup();
  e.dispatch({ type: 'busk.level', groupId: 'g', level: 0.5 });
  assert.strictEqual(e.computeLook().f0.dim, 0.5);
  e.dispatch({ type: 'busk.flash', groupId: 'g', on: true });
  assert.strictEqual(e.computeLook().f0.dim, 1);
  e.dispatch({ type: 'busk.flash', groupId: 'g', on: false });
  assert.strictEqual(e.computeLook().f0.dim, 0.5);
  assert.ok(Number.isFinite(e.computeLook().h.haze));
});

test('live colour is recorded, group fader and effects are not baked into values', () => {
  const e = setup();
  e.dispatch({ type: 'busk.color', groupId: 'g', rgb: [1, 0, 0] });
  e.dispatch({ type: 'busk.level', groupId: 'g', level: 0.2 });
  e.dispatch({ type: 'busk.fx', groupId: 'g', fx: 'pulse', rate: 2 });
  e.dispatch({ type: 'look.record', name: 'Red pulse' });
  const look = e.show.looks.at(-1);
  assert.deepStrictEqual(look.values.f0, { dim: 1, green: 0, blue: 0 });
  assert.deepStrictEqual(look.effects, [{ groupId: 'g', effectId: 'pulse', rate: 2, size: 1 }]);
});

test('effects stored in a look run when the look is active, live "off" overrides', () => {
  const e = setup();
  e.dispatch({ type: 'busk.fx', groupId: 'g', fx: 'chase', rate: 1 });
  e.dispatch({ type: 'look.record', name: 'Chase' });
  e.dispatch({ type: 'busk.release' });
  e.dispatch({ type: 'tempo.set', bpm: 60 }); // 1 beat per second
  const t0 = e.rt.beatT0;
  const at = (t) => e.computeLook(t);
  assert.strictEqual(at(t0).f0.dim, 1);
  assert.strictEqual(at(t0).f1.dim, 0);
  assert.strictEqual(at(t0 + 1000).f1.dim, 1);
  assert.strictEqual(at(t0 + 1000).f0.dim, 0);
  e.dispatch({ type: 'busk.fx', groupId: 'g', fx: 'off' });
  assert.strictEqual(e.computeLook().f1.dim, 1);
});

test('pulse and rainbow', () => {
  const e = setup();
  e.dispatch({ type: 'tempo.set', bpm: 60 });
  e.dispatch({ type: 'busk.fx', groupId: 'g', fx: 'pulse' });
  const t0 = e.rt.beatT0;
  assert.strictEqual(e.computeLook(t0).f0.dim, 1);
  assert.ok(e.computeLook(t0 + 900).f0.dim < 0.3);
  e.dispatch({ type: 'busk.fx', groupId: 'g', fx: 'rainbow' });
  const a = e.computeLook(t0).f0, b = e.computeLook(t0).f2;
  assert.notDeepStrictEqual([a.red, a.green, a.blue], [b.red, b.green, b.blue]);
});

test('tap tempo and MIDI clock beats', () => {
  const e = setup();
  const realNow = Date.now;
  let t = 1_000_000;
  Date.now = () => t;
  try {
    for (let i = 0; i < 4; i++) { e.dispatch({ type: 'tempo.tap' }); t += 500; }
    assert.strictEqual(Math.round(e.rt.bpm), 120);
    assert.deepStrictEqual(e.dispatch({ type: 'tempo.beat', bpm: 128 }), { show: false, runtime: true });
    assert.deepStrictEqual(e.dispatch({ type: 'tempo.beat', bpm: 128.2 }), { show: false, runtime: false });
    assert.strictEqual(e.rt.clock, true);
  } finally {
    Date.now = realNow;
  }
});

test('song BPM is used when there is no MIDI clock', () => {
  const e = setup();
  e.dispatch({ type: 'song.add', name: 'S' });
  e.dispatch({ type: 'song.edit', id: e.show.songs[0].id, bpm: 72 });
  assert.strictEqual(e.rt.bpm, 72);
});

test('3D position, aim and beam are validated', () => {
  const e = setup();
  e.dispatch({ type: 'fixture.edit', id: 'f0', pos3d: { x: 1, y: 5, z: -2 }, aim: { x: 0, y: 0, z: 0 }, beam: 30 });
  assert.deepStrictEqual(e.show.fixtures[0].pos3d, { x: 1, y: 5, z: -2 });
  assert.throws(() => e.dispatch({ type: 'fixture.edit', id: 'f0', pos3d: { x: 'a', y: 0, z: 0 } }));
});

test('effects and group faders also apply to lights in the programmer', () => {
  const e = setup();
  e.dispatch({ type: 'prog.set', fixtures: ['f0'], values: { dim: 0.8 } });
  e.dispatch({ type: 'busk.level', groupId: 'g', level: 0.5 });
  assert.strictEqual(e.computeLook().f0.dim, 0.4);
});
