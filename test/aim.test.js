'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Geom = require('../public/geom');
const { Engine, emptyShow } = require('../lib/engine');

function rig() {
  const show = emptyShow();
  show.fixtures = [
    { id: 'm1', name: 'Mover L', profile: 'wash', universe: 1, address: 1, x: 0.2, y: 0.3, pos3d: { x: -4, y: 6, z: -2 } },
    { id: 'm2', name: 'Mover R', profile: 'wash', universe: 1, address: 30, x: 0.8, y: 0.3, pos3d: { x: 4, y: 6, z: -2 } },
    { id: 'p1', name: 'Par', profile: 'drgb', universe: 1, address: 60, x: 0.5, y: 0.8 },
  ];
  return new Engine(show);
}
const angleTo = (e, fid, target, look) => {
  const fx = e.fixtureMap.get(fid);
  const { pos, aim } = Geom.placement(fx.fixture, e.show.stage3d.stage);
  const d = Geom.beamDir(pos, aim, true, look[fid].pan, look[fid].tilt);
  const want = Geom.norm(Geom.sub(target, pos));
  return Math.acos(Math.min(1, Geom.dot(d, want))) * 180 / Math.PI;
};

test('aimAt is the inverse of beamDir', () => {
  const pos = { x: -3, y: 6, z: 1 }, aim = { x: -2, y: 0.6, z: -1 };
  for (const target of [{ x: 0, y: 2, z: -2 }, { x: 4, y: 1, z: 0 }, { x: -3, y: 0.6, z: 3 }, { x: 5, y: 7, z: -5 }]) {
    const r = Geom.aimAt(pos, aim, target);
    assert.ok(r.errorDeg < 0.2, `error ${r.errorDeg}° for ${JSON.stringify(target)}`);
  }
});

test('tap a point: the selected movers point there; pars are left alone', () => {
  const e = rig();
  assert.ok(e.fixtureMap.get('m1').prof.attrs.includes('pan'), 'the mover profile has pan/tilt');
  e.dispatch({ type: 'prog.aim', fixtures: ['m1', 'm2', 'p1'], point: { x: 0, y: 0.6, z: -1 }, height: 1.2 });
  assert.strictEqual(e.lastResult.aimed, 2);
  const look = e.computeLook(Date.now() + 1000);
  const target = { x: 0, y: 1.8, z: -1 };
  assert.ok(angleTo(e, 'm1', target, look) < 0.5);
  assert.ok(angleTo(e, 'm2', target, look) < 0.5);
  assert.ok(!e.programmer.p1);
  assert.throws(() => e.dispatch({ type: 'prog.aim', fixtures: ['p1'], point: target }), /moving heads/);
});

test('a focus point stays on the pulpit when a light is moved, and looks keep it', () => {
  const e = rig();
  e.dispatch({ type: 'preset.focus', name: 'Pulpit', point: { x: 1, y: 0.6, z: -0.5 }, height: 1.2, fixtures: ['m1', 'm2'] });
  const pulpit = e.show.presets.find((p) => p.name === 'Pulpit');
  assert.deepStrictEqual(pulpit.target, { x: 1, y: 1.8, z: -0.5 });
  e.dispatch({ type: 'look.record', name: 'Sermon' });
  const look = e.show.looks.find((l) => l.name === 'Sermon');
  assert.strictEqual(look.refs.m1.pan, pulpit.id, 'the look is linked to the focus point');
  // Re-hang Mover L somewhere else: the look still hits the pulpit
  e.dispatch({ type: 'fixture.edit', id: 'm1', pos3d: { x: -6, y: 7, z: 2 } });
  e.dispatch({ type: 'look.apply', id: look.id, fade: 0 });
  const live = e.computeLook(Date.now() + 1000);
  assert.ok(angleTo(e, 'm1', pulpit.target, live) < 0.5, 'still on the pulpit after moving the light');
  // Move the pulpit itself: everything using it follows
  e.dispatch({ type: 'preset.focus', id: pulpit.id, point: { x: -2, y: 0.6, z: -3 }, height: 1.2 });
  const live2 = e.computeLook(Date.now() + 1000);
  assert.ok(angleTo(e, 'm2', { x: -2, y: 1.8, z: -3 }, live2) < 0.5);
});
