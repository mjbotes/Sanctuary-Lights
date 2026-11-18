'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Engine, emptyShow } = require('../lib/engine');
const FX = require('../public/fxmath');

function setup() {
  const show = emptyShow();
  show.fixtures = [0, 1, 2, 3].map((i) => ({ id: `f${i}`, name: `F${i}`, profile: 'drgb', universe: 1, address: 1 + i * 4, x: i / 3, y: 0.5 }));
  show.fixtures.push({ id: 'm0', name: 'Mover', profile: 'wash', universe: 1, address: 50, x: 0.5, y: 0.2 });
  show.groups = [{ id: 'g', name: 'Pars', fixtures: ['f0', 'f1', 'f2', 'f3'] }];
  const e = new Engine(show);
  e.dispatch({ type: 'prog.set', fixtures: ['f0', 'f1', 'f2', 'f3', 'm0'], values: { dim: 1 } });
  e.dispatch({ type: 'look.record', name: 'Full' });
  e.dispatch({ type: 'tempo.set', bpm: 60 }); // 1 beat = 1 second
  return e;
}
const near = (a, b) => Math.abs(a - b) < 1e-6;

test('phase spread: from/to, groups and wings', () => {
  const fx = { phaseFrom: 0, phaseTo: 360 };
  assert.deepStrictEqual([0, 1, 2, 3].map((i) => FX.phaseOf(i, 4, fx).phase), [0, 0.25, 0.5, 0.75]);
  assert.deepStrictEqual([0, 1, 2, 3].map((i) => FX.phaseOf(i, 4, { phaseTo: 180 }).phase), [0, 1 / 6, 2 / 6, 0.5]);
  assert.deepStrictEqual([0, 1, 2, 3].map((i) => FX.phaseOf(i, 4, { phaseTo: 360, groups: 2 }).phase), [0, 0, 0.5, 0.5]);
  // Wings: mirror around the middle
  assert.deepStrictEqual([0, 1, 2, 3].map((i) => FX.phaseOf(i, 4, { phaseTo: 90, wings: 2 }).phase), [0, 0.25, 0.25, 0]);
});

test('waveforms', () => {
  assert.ok(near(FX.wave('sine', 0, 0.5), 0));
  assert.ok(near(FX.wave('sine', 0.5, 0.5), 1));
  assert.strictEqual(FX.wave('square', 0.2, 0.25), 1);
  assert.strictEqual(FX.wave('square', 0.3, 0.25), 0);
  assert.ok(near(FX.wave('saw', 0.75), 0.75));
  assert.ok(near(FX.wave('ramp', 0.75), 0.25));
  assert.ok(near(FX.wave('triangle', 0.75), 0.5));
});

test('run a built-in effect on a group and stop it', () => {
  const e = setup();
  e.dispatch({ type: 'fx.run', key: 'k', effectId: 'chase', groupId: 'g' });
  const t0 = e.rt.beatT0;
  assert.deepStrictEqual(['f0', 'f1', 'f2', 'f3'].map((f) => e.computeLook(t0)[f].dim), [1, 0, 0, 0]);
  assert.deepStrictEqual(['f0', 'f1', 'f2', 'f3'].map((f) => e.computeLook(t0 + 2000)[f].dim), [0, 0, 1, 0]);
  e.dispatch({ type: 'fx.stop', key: 'k' });
  assert.strictEqual(e.computeLook(t0 + 2000).f0.dim, 1);
});

test('selection order sets the phase order', () => {
  const e = setup();
  e.dispatch({ type: 'fx.run', key: 'k', effectId: 'chase', fixtures: ['f3', 'f2', 'f1', 'f0'] });
  assert.strictEqual(e.computeLook(e.rt.beatT0).f3.dim, 1);
  assert.strictEqual(e.computeLook(e.rt.beatT0).f0.dim, 0);
});

test('position effects move around the planned position and skip fixtures without pan', () => {
  const e = setup();
  e.dispatch({ type: 'fx.run', key: 'c', effectId: 'circle', fixtures: ['m0', 'f0'] });
  const t0 = e.rt.beatT0;
  const at = (ms) => e.computeLook(t0 + ms).m0;
  assert.ok(near(at(0).pan, 0.5 - 0.06)); // sine at 0 = low edge
  assert.ok(near(at(2000).pan, 0.5 + 0.06)); // half a 4-beat cycle
  assert.ok(near(at(0).tilt, 0.5)); // tilt is 90 degrees ahead: middle
  assert.strictEqual(e.computeLook(t0).f0.pan, undefined);
});

test('custom effect: save, validate, run, rate and size', () => {
  const e = setup();
  e.dispatch({ type: 'effect.save', effect: { name: 'Half dim', speed: { beats: 2 }, layers: [{ attr: 'dim', mode: 'abs', wave: 'square', width: 0.5, low: 0.2, high: 0.6 }] } });
  const id = e.lastSavedEffect;
  assert.match(id, /^fx-/);
  assert.throws(() => e.dispatch({ type: 'effect.save', effect: { name: 'Empty', layers: [] } }), /layer/);
  e.dispatch({ type: 'fx.run', key: 'k', effectId: id, groupId: 'g' });
  const t0 = e.rt.beatT0;
  assert.ok(near(e.computeLook(t0).f0.dim, 0.6));
  assert.ok(near(e.computeLook(t0 + 1500).f0.dim, 0.2));
  e.dispatch({ type: 'fx.adjust', key: 'k', size: 0.5 });
  assert.ok(near(e.computeLook(t0 + 1500).f0.dim, 0.6)); // halfway between planned 1 and 0.2
  e.dispatch({ type: 'fx.adjust', key: 'k', size: 1, rate: 2 });
  assert.ok(near(e.computeLook(t0 + 500).f0.dim, 0.2)); // twice as fast
  e.dispatch({ type: 'effect.delete', id });
  assert.deepStrictEqual(e.rt.running, {});
});

test('colour effects: rainbow and A/B mix', () => {
  const e = setup();
  e.dispatch({ type: 'effect.save', effect: { name: 'RB', speed: { beats: 2 }, layers: [{ attr: 'color', wave: 'square', width: 0.5, colorA: '#ff0000', colorB: '#0000ff' }] } });
  e.dispatch({ type: 'fx.run', key: 'k', effectId: e.lastSavedEffect, groupId: 'g' });
  const t0 = e.rt.beatT0;
  const c = (ms) => { const v = e.computeLook(t0 + ms).f0; return [v.red, v.green, v.blue]; };
  assert.deepStrictEqual(c(1500), [1, 0, 0]); // square off -> colour A
  assert.deepStrictEqual(c(500), [0, 0, 1]); // square on -> colour B
});

test('presets: record, apply by reference, and cues follow preset updates', () => {
  const e = setup();
  e.dispatch({ type: 'prog.color', fixtures: ['f0', 'f1'], rgb: [1, 0, 0] });
  e.dispatch({ type: 'preset.record', kind: 'color', name: 'Red', fixtures: ['f0', 'f1'] });
  const red = e.show.presets[0];
  assert.deepStrictEqual(red.values.f0, { red: 1, green: 0, blue: 0 });
  assert.deepStrictEqual(red.universal, { red: 1, green: 0, blue: 0 });
  e.dispatch({ type: 'prog.clear' });
  // Apply to a fixture that was not in the preset: uses the universal values
  e.dispatch({ type: 'preset.apply', id: red.id, fixtures: ['f2'] });
  assert.strictEqual(e.computeLook().f2.green, 0);
  e.dispatch({ type: 'cue.record', name: 'Uses red' });
  assert.deepStrictEqual(e.show.cues[0].refs, { f2: { red: red.id, green: red.id, blue: red.id } });
  // Change the preset to blue: the cue follows
  e.dispatch({ type: 'prog.color', fixtures: ['f0', 'f1'], rgb: [0, 0, 1] });
  e.dispatch({ type: 'preset.record', id: red.id, kind: 'color', fixtures: ['f0', 'f1'] });
  e.dispatch({ type: 'prog.clear' });
  const look = e.computeLook();
  assert.deepStrictEqual([look.f2.red, look.f2.blue], [0, 1]);
  // Setting a value by hand breaks the link for that attribute
  e.dispatch({ type: 'preset.apply', id: red.id, fixtures: ['f3'] });
  e.dispatch({ type: 'prog.set', fixtures: ['f3'], values: { blue: 0.5 } });
  assert.deepStrictEqual(e.progRefs.f3, { red: red.id, green: red.id });
});

test('position presets only touch pan/tilt', () => {
  const e = setup();
  e.dispatch({ type: 'prog.set', fixtures: ['m0'], values: { pan: 0.2, tilt: 0.7 } });
  e.dispatch({ type: 'preset.record', kind: 'position', name: 'Pulpit', fixtures: ['m0'] });
  assert.deepStrictEqual(e.show.presets[0].values, { m0: { pan: 0.2, tilt: 0.7 } });
  assert.throws(() => e.dispatch({ type: 'preset.record', kind: 'position', fixtures: ['f0'] }), /no position/);
});

test('pads: toggle and hold, effect and preset pads, hotkey rules', () => {
  const e = setup();
  assert.strictEqual(e.show.pads.length, 10);
  const pulse = e.show.pads.find((p) => p.effectId === 'pulse');
  e.dispatch({ type: 'pad.press', id: pulse.id, down: true });
  assert.ok(e.rt.running[pulse.id]);
  assert.deepStrictEqual(e.dispatch({ type: 'pad.press', id: pulse.id, down: false }), { show: false, runtime: false });
  e.dispatch({ type: 'pad.press', id: pulse.id, down: true });
  assert.strictEqual(e.rt.running[pulse.id], undefined);

  e.dispatch({ type: 'prog.color', fixtures: ['f0'], rgb: [0, 1, 0] });
  e.dispatch({ type: 'preset.record', kind: 'color', name: 'Green', fixtures: ['f0'] });
  e.dispatch({ type: 'prog.clear' });
  e.dispatch({ type: 'pad.save', pad: { name: 'Green pars', kind: 'preset', presetId: e.show.presets[0].id, groupId: 'g', mode: 'hold', key: 'g' } });
  const pad = e.show.pads.at(-1);
  e.dispatch({ type: 'pad.press', id: pad.id, down: true });
  assert.deepStrictEqual([e.computeLook().f3.red, e.computeLook().f3.green], [0, 1]);
  e.dispatch({ type: 'pad.press', id: pad.id, down: false });
  assert.strictEqual(e.computeLook().f3.green, 1); // default white
  assert.strictEqual(e.computeLook().f3.red, 1);
  assert.throws(() => e.dispatch({ type: 'pad.save', pad: { name: 'x', kind: 'effect', effectId: 'pulse', key: 's' } }), /already used/);
  // A key used by another pad moves to the new one
  e.dispatch({ type: 'pad.save', pad: { name: 'New', kind: 'effect', effectId: 'chase', key: '1' } });
  assert.strictEqual(e.show.pads.filter((p) => p.key === '1').length, 1);
  assert.strictEqual(e.show.pads.at(-1).key, '1');
});

test('strobe and flash-all buttons', () => {
  const e = setup();
  e.dispatch({ type: 'prog.set', fixtures: ['f0'], values: { dim: 0.3 } });
  e.dispatch({ type: 'flash.all', on: true });
  assert.strictEqual(e.computeLook().f0.dim, 1);
  e.dispatch({ type: 'flash.all', on: false });
  e.dispatch({ type: 'strobe.hold', on: true });
  const dims = new Set();
  for (let t = 0; t < 100; t += 10) dims.add(e.computeLook(1e12 + t).f0.dim);
  assert.deepStrictEqual([...dims].sort(), [0, 0.3]);
  e.dispatch({ type: 'strobe.hold', on: false });
  assert.strictEqual(e.computeLook().f0.dim, 0.3);
});

test('running effects are recorded into looks, momentary ones are not', () => {
  const e = setup();
  e.dispatch({ type: 'fx.run', key: 'k', effectId: 'rainbow', fixtures: ['f0', 'f1'] });
  e.dispatch({ type: 'pad.press', id: e.show.pads.find((p) => p.mode === 'hold').id, down: true });
  e.dispatch({ type: 'look.record', name: 'Rainbow' });
  assert.deepStrictEqual(e.show.looks.at(-1).effects, [{ effectId: 'rainbow', rate: 1, size: 1, fixtures: ['f0', 'f1'] }]);
});
