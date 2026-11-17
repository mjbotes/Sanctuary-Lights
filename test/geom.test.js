'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Geom = require('../public/geom');
const FX = require('../public/fxmath');
const { Engine, emptyShow } = require('../lib/engine');

const screen = { x: 0, y: 3, z: -6, w: 4, h: 2.25, rotY: 0, rotX: 0 };

test('a light aimed at the screen hits it; one aimed at the floor does not', () => {
  const pos = { x: 0, y: 6, z: 2 };
  const toScreen = Geom.norm(Geom.sub({ x: 0, y: 3, z: -6 }, pos));
  assert.strictEqual(Geom.beamHitsScreen(pos, toScreen, 20, screen).hit, true);
  const down = { x: 0, y: -1, z: 0 };
  assert.strictEqual(Geom.beamHitsScreen(pos, down, 20, screen).hit, false);
  // Aimed just beside the screen: a wide beam still spills onto it, a narrow one does not
  const beside = Geom.norm(Geom.sub({ x: 2.6, y: 3, z: -6 }, pos));
  assert.strictEqual(Geom.beamHitsScreen(pos, beside, 40, screen).hit, true);
  assert.strictEqual(Geom.beamHitsScreen(pos, beside, 4, screen).hit, false);
  // Behind the light
  assert.strictEqual(Geom.beamHitsScreen({ x: 0, y: 3, z: -8 }, { x: 0, y: 0, z: -1 }, 20, screen).hit, false);
});

test('moving heads turn with pan and tilt', () => {
  const pos = { x: 0, y: 6, z: 0 }, aim = { x: 0, y: 0, z: 0 };
  const d = Geom.beamDir(pos, aim, true, 0.5, 0.5);
  assert.ok(Math.abs(d.y + 1) < 1e-9);
  const t = Geom.beamDir(pos, aim, true, 0.5, 0.5 + 90 / 270);
  assert.ok(Math.abs(t.y) < 1e-9, 'tilted 90 degrees: horizontal');
});

test('3D direction sort and spread by distance', () => {
  const pos = { a: { x: 0, y: 0, z: 0 }, b: { x: 1, y: 0, z: -1 }, c: { x: 4, y: 0, z: 0 }, d: { x: 0, y: 5, z: 0 } };
  const posOf = (id) => pos[id];
  // turn 0 = left -> right
  assert.deepStrictEqual(FX.trickOrder(['c', 'b', 'a'], { order: 'direction', turn: 0 }, posOf), ['a', 'b', 'c']);
  // turn 90 = front -> back (towards upstage, negative z)
  assert.deepStrictEqual(FX.trickOrder(['a', 'b'], { order: 'direction', turn: 90 }, posOf), ['a', 'b']);
  // tilt 90 = floor -> ceiling
  assert.deepStrictEqual(FX.trickOrder(['d', 'a'], { order: 'direction', tilt: 90 }, posOf), ['a', 'd']);
  // Diagonal: 45 degrees
  const diag = FX.trickOrder(['c', 'b', 'a'], { order: 'direction', turn: 45 }, posOf);
  assert.strictEqual(diag[0], 'a');
  assert.deepStrictEqual(FX.trickFractions(['a', 'b', 'c'], { order: 'left-right', spatial: true }, posOf), [0, 0.25, 1]);
  assert.strictEqual(FX.trickFractions(['a', 'b'], { order: 'left-right' }, posOf), null);
});

test('spread by distance in the engine: delays follow real spacing', () => {
  const show = emptyShow();
  show.fixtures = [0, 1, 4].map((x, i) => ({ id: `f${i}`, name: `F${i}`, profile: 'dimmer', universe: 1, address: 1 + i, x: 0.5, y: 0.5, pos3d: { x, y: 5, z: 0 } }));
  const e = new Engine(show);
  e.dispatch({ type: 'tricks.set', tricks: { order: 'direction', turn: 0, spatial: true, delayFrom: 0, delayTo: 4 } });
  e.dispatch({ type: 'prog.set', fixtures: ['f0', 'f1', 'f2'], values: { dim: 1 } });
  e.dispatch({ type: 'cue.record', name: 'Sweep', fixtures: ['f2', 'f0', 'f1'] });
  const t = e.show.cues[0].timing;
  assert.deepStrictEqual([t.f0.delay, t.f1.delay, t.f2.delay], [0, 1, 4]);
});

test('screen protection: warn marks the light, block turns it off', () => {
  const show = emptyShow();
  show.fixtures = [
    { id: 'hit', name: 'Hit', profile: 'drgb', universe: 1, address: 1, x: 0.5, y: 0.5, pos3d: { x: 0, y: 6, z: 2 }, aim: { x: 0, y: 3, z: -6 } },
    { id: 'ok', name: 'Ok', profile: 'drgb', universe: 1, address: 5, x: 0.5, y: 0.5, pos3d: { x: 0, y: 6, z: 2 }, aim: { x: 0, y: 0, z: 2 } },
  ];
  const e = new Engine(show);
  e.dispatch({ type: 'stage3d.set', screens: [{ name: 'Main screen', ...screen }] });
  e.dispatch({ type: 'prog.set', fixtures: ['hit', 'ok'], values: { dim: 1 } });
  let look = e.computeLook();
  assert.strictEqual(look.hit.dim, 1); // default: warn only
  assert.strictEqual(e.liveState(look).fixtures.hit.x, 1);
  assert.strictEqual(e.liveState(look).fixtures.ok.x, undefined);
  e.dispatch({ type: 'settings.update', settings: { screenProtect: 'block' } });
  look = e.computeLook();
  assert.strictEqual(look.hit.dim, 0);
  assert.strictEqual(look.ok.dim, 1);
  // Unprotected screen: no blocking
  e.dispatch({ type: 'stage3d.set', screens: [{ ...e.show.stage3d.screens[0], protect: false }] });
  assert.strictEqual(e.computeLook().hit.dim, 1);
});

test('moving head is blocked only while its effect points it at the screen', () => {
  const show = emptyShow();
  show.fixtures = [{ id: 'm', name: 'M', profile: 'wash', universe: 1, address: 1, x: 0.5, y: 0.5, pos3d: { x: 0, y: 6, z: 0 }, aim: { x: 0, y: 0, z: 0 } }];
  const e = new Engine(show);
  e.dispatch({ type: 'stage3d.set', screens: [{ name: 'S', x: 0, y: 3, z: -6, w: 4, h: 2.25 }] });
  e.dispatch({ type: 'settings.update', settings: { screenProtect: 'block' } });
  e.dispatch({ type: 'prog.set', fixtures: ['m'], values: { dim: 1 } });
  assert.strictEqual(e.computeLook().m.dim, 1); // pointing down
  // Tilt towards the back wall where the screen is (tilt away from straight down by ~63 degrees)
  e.dispatch({ type: 'prog.set', fixtures: ['m'], values: { tilt: 0.5 - 63 / 270 } });
  const a = e.computeLook().m.dim;
  e.dispatch({ type: 'prog.set', fixtures: ['m'], values: { tilt: 0.5 + 63 / 270 } });
  const b = e.computeLook().m.dim;
  assert.deepStrictEqual([a, b].sort(), [0, 1], 'one way hits the screen, the other way does not');
});
