'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Engine, emptyShow } = require('../lib/engine');
const FX = require('../public/fxmath');

function setup(n = 6) {
  const show = emptyShow();
  show.fixtures = Array.from({ length: n }, (_, i) => ({ id: `f${i}`, name: `F${i}`, profile: 'dimmer', universe: 1, address: 1 + i, x: i / (n - 1), y: 0.5 }));
  const e = new Engine(show);
  e.dispatch({ type: 'tempo.set', bpm: 60 });
  return e;
}
const all = (e) => e.show.fixtures.map((f) => f.id);
const near = (a, b) => Math.abs(a - b) < 1e-6;

test('block, groups and wings steps', () => {
  const k = (t, n = 6) => FX.trickSteps(n, t).map((x) => x.k).join('');
  assert.strictEqual(k({}), '012345');
  assert.strictEqual(k({ block: 2 }), '001122');
  assert.strictEqual(k({ groups: 3 }), '012012');
  assert.strictEqual(k({ wings: 2 }), '012210');
  assert.strictEqual(k({ block: 2, wings: 2 }), '001100');
});

test('order, shift and shuffle', () => {
  const pos = { a: { x: 2, z: 0 }, b: { x: -1, z: 3 }, c: { x: 0, z: 1 } };
  assert.deepStrictEqual(FX.trickOrder(['a', 'b', 'c'], { order: 'left-right' }, (id) => pos[id]), ['b', 'c', 'a']);
  assert.deepStrictEqual(FX.trickOrder(['a', 'b', 'c'], { order: 'centre-out' }, (id) => pos[id]), ['c', 'a', 'b']);
  assert.deepStrictEqual(FX.trickOrder(['a', 'b', 'c'], { shift: -1 }), ['c', 'a', 'b']);
  const sh = FX.trickOrder(['a', 'b', 'c', 'd', 'e'], { shuffle: 42 });
  assert.deepStrictEqual([...sh].sort(), ['a', 'b', 'c', 'd', 'e']);
  assert.deepStrictEqual(FX.trickOrder(['a', 'b', 'c', 'd', 'e'], { shuffle: 42 }), sh); // repeatable
});

test('value fan follows tricks', () => {
  const e = setup(5);
  e.dispatch({ type: 'prog.fan', fixtures: all(e), attr: 'dim', from: 0, to: 1 });
  assert.deepStrictEqual(all(e).map((f) => e.programmer[f].dim), [0, 0.25, 0.5, 0.75, 1]);
  e.dispatch({ type: 'tricks.set', tricks: { wings: 2 } });
  e.dispatch({ type: 'prog.fan', fixtures: all(e), attr: 'dim', from: 0, to: 1 });
  assert.deepStrictEqual(all(e).map((f) => e.programmer[f].dim), [0, 0.5, 1, 0.5, 0]);
});

test('width and part step through the selection', () => {
  const e = setup(6);
  e.dispatch({ type: 'tricks.set', tricks: { width: 2 } });
  e.dispatch({ type: 'tricks.part', n: 6, dir: 1 });
  assert.strictEqual(e.rt.tricks.part, 1);
  e.dispatch({ type: 'tricks.part', n: 6, dir: -1 });
  assert.strictEqual(e.rt.tricks.part, 3);
  e.dispatch({ type: 'tricks.part', n: 6, all: true });
  assert.strictEqual(e.rt.tricks.part, 0);
  const act = FX.trickActive(6, { width: 2, part: 3 });
  assert.deepStrictEqual([0, 1, 2, 3, 4, 5].map(act.active), [false, false, false, false, true, true]);
});

test('delay spread is recorded into a cue and plays light by light', () => {
  const e = setup(3);
  e.dispatch({ type: 'tricks.set', tricks: { delayFrom: 0, delayTo: 2, fadeFrom: 1 } });
  e.dispatch({ type: 'prog.set', fixtures: all(e), values: { dim: 1 } });
  e.dispatch({ type: 'cue.record', name: 'Wipe', fixtures: all(e) });
  assert.deepStrictEqual(e.show.cues[0].timing, { f0: { fade: 1, delay: 0 }, f1: { fade: 1, delay: 1 }, f2: { fade: 1, delay: 2 } });
  e.dispatch({ type: 'cue.release' });
  e.cueFade = null; // jump to dark
  e.dispatch({ type: 'cue.goto', id: e.show.cues[0].id, fade: 0 });
  const t0 = e.cueFade.start;
  assert.strictEqual(e.cueFade.dur, 3000);
  const dims = (ms) => all(e).map((f) => e.computeLook(t0 + ms)[f].dim);
  assert.deepStrictEqual(dims(1000), [1, 0, 0]);
  assert.ok(near(dims(1500)[1], 0.5));
  assert.deepStrictEqual(dims(3000), [1, 1, 1]);
});

test('phase and speed spreads apply to effects run with tricks', () => {
  const e = setup(4);
  e.dispatch({ type: 'tricks.set', tricks: { phaseFrom: 0, phaseTo: 360 } });
  e.dispatch({ type: 'fx.run', key: 'k', effectId: 'breathe', fixtures: all(e) }); // breathe has no spread of its own
  e.dispatch({ type: 'prog.set', fixtures: all(e), values: { dim: 1 } });
  assert.ok(e.rt.running.k.tricks);
  const v = all(e).map((f) => e.computeLook(e.rt.beatT0)[f].dim);
  assert.strictEqual(new Set(v.map((x) => x.toFixed(3))).size, 3); // spread: 0 and 360 equal ends excluded -> distinct steps (1 & 3 mirror)
  e.dispatch({ type: 'tricks.reset' });
  e.dispatch({ type: 'fx.run', key: 'k', effectId: 'breathe', fixtures: all(e) });
  const same = all(e).map((f) => e.computeLook(e.rt.beatT0)[f].dim);
  assert.strictEqual(new Set(same).size, 1);
});

test('tricks with groups change how a built-in chase runs', () => {
  const e = setup(4);
  e.dispatch({ type: 'prog.set', fixtures: all(e), values: { dim: 1 } });
  e.dispatch({ type: 'tricks.set', tricks: { groups: 2 } });
  e.dispatch({ type: 'fx.run', key: 'k', effectId: 'chase', fixtures: all(e) });
  const v = all(e).map((f) => e.computeLook(e.rt.beatT0)[f].dim);
  assert.deepStrictEqual(v, [1, 0, 1, 0]);
});
