'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Engine, emptyShow } = require('../lib/engine');
const { parseChannels, compileProfile } = require('../lib/profiles');
const { artnetPacket, sacnPacket, sacnMulticastAddress, enttecProPacket } = require('../lib/output');

function engineWith(...fixtures) {
  const show = emptyShow();
  show.fixtures = fixtures.map((f, i) => ({ id: `f${i}`, name: `F${i}`, universe: 1, x: 0.5, y: 0.5, ...f }));
  return new Engine(show);
}

test('parses channel specs', () => {
  const ch = parseChannels('dim red pan.fine strobe=10 255 -');
  assert.deepStrictEqual(ch, [{ attr: 'dim' }, { attr: 'red' }, { attr: 'pan', fine: true }, { attr: 'strobe', def: 10 / 255 }, { fixed: 255 }, { fixed: 0 }]);
  assert.throws(() => parseChannels('dim 300'));
  assert.throws(() => parseChannels('dim r$d'));
  assert.throws(() => parseChannels(''));
});

test('RGB fixtures get a virtual dimmer and white defaults', () => {
  const p = compileProfile({ name: 'x', channels: 'red green blue' });
  assert.deepStrictEqual(p.attrs, ['dim', 'red', 'green', 'blue']);
  assert.deepStrictEqual(p.defaults, { dim: 0, red: 1, green: 1, blue: 1 });
  const w = compileProfile({ name: 'x', channels: 'red green blue white' });
  assert.deepStrictEqual(w.defaults, { dim: 0, red: 0, green: 0, blue: 0, white: 1 });
});

test('renders DMX with dimmer channel, virtual dimmer, fixed and 16-bit', () => {
  const e = engineWith({ profile: 'drgb', address: 1 }, { profile: 'rgb', address: 10 }, { profile: 'wash', address: 20 });
  e.dispatch({ type: 'prog.set', fixtures: ['f0', 'f1', 'f2'], values: { dim: 0.5, pan: 1 } });
  e.dispatch({ type: 'prog.color', fixtures: ['f0', 'f1'], rgb: [1, 0, 0] });
  const u = e.render(e.computeLook()).get(1);
  assert.deepStrictEqual([...u.slice(0, 4)], [128, 255, 0, 0]); // dim channel + raw colour
  assert.deepStrictEqual([...u.slice(9, 12)], [128, 0, 0]); // colour scaled by virtual dimmer
  assert.deepStrictEqual([...u.slice(19, 21)], [255, 255]); // pan 16-bit full
  assert.strictEqual(u[23], 0); // fixed 0 channel
  assert.strictEqual(u[24], 128); // dim
});

test('grand master and blackout scale intensity only', () => {
  const e = engineWith({ profile: 'drgb', address: 1 });
  e.dispatch({ type: 'prog.set', fixtures: ['f0'], values: { dim: 1 } });
  e.dispatch({ type: 'gm.set', value: 0.5 });
  let u = e.render(e.computeLook()).get(1);
  assert.deepStrictEqual([...u.slice(0, 4)], [128, 255, 255, 255]);
  e.dispatch({ type: 'blackout.set', on: true });
  u = e.render(e.computeLook()).get(1);
  assert.strictEqual(u[0], 0);
});

test('record cue captures the stage, clears programmer, and cues crossfade', () => {
  const e = engineWith({ profile: 'dimmer', address: 1 });
  e.dispatch({ type: 'prog.set', fixtures: ['f0'], values: { dim: 1 } });
  e.dispatch({ type: 'cue.record', name: 'Full' });
  assert.deepStrictEqual(e.programmer, {});
  assert.strictEqual(e.rt.cueIndex, 0);
  assert.deepStrictEqual(e.show.cues[0].values, { f0: { dim: 1 } });
  assert.strictEqual(e.computeLook().f0.dim, 1);

  e.dispatch({ type: 'prog.set', fixtures: ['f0'], values: { dim: 0.2 } });
  e.dispatch({ type: 'cue.record', name: 'Low' });
  e.dispatch({ type: 'cue.edit', id: e.show.cues[1].id, fade: 2 });
  e.dispatch({ type: 'cue.goto', id: e.show.cues[0].id, fade: 0 });
  assert.strictEqual(e.computeLook().f0.dim, 1);
  e.dispatch({ type: 'cue.go' });
  const start = e.cueFade.start;
  assert.strictEqual(e.computeLook(start).f0.dim, 1);
  assert.ok(Math.abs(e.computeLook(start + 1000).f0.dim - 0.6) < 1e-9); // halfway (smoothstep 0.5 = 0.5)
  assert.ok(Math.abs(e.computeLook(start + 5000).f0.dim - 0.2) < 1e-9);
  e.dispatch({ type: 'cue.go' }); // end of list: stays
  assert.strictEqual(e.rt.cueIndex, 1);
});

test('scenes: intensity is highest-takes-precedence and colour blends by level', () => {
  const e = engineWith({ profile: 'drgb', address: 1 });
  e.dispatch({ type: 'prog.set', fixtures: ['f0'], values: { dim: 1 } });
  e.dispatch({ type: 'prog.color', fixtures: ['f0'], rgb: [0, 0, 1] });
  e.dispatch({ type: 'scene.record', name: 'Blue' });
  const id = e.show.scenes[0].id;
  assert.strictEqual(e.rt.sceneLevels[id], 1);
  e.dispatch({ type: 'scene.level', id, level: 0.5 });
  const look = e.computeLook();
  assert.strictEqual(look.f0.dim, 0.5);
  assert.strictEqual(look.f0.red, 0.5); // blend of default white (1) and blue (0)
  assert.strictEqual(look.f0.blue, 1);
  e.dispatch({ type: 'scene.level', id, level: 0 });
  assert.strictEqual(e.computeLook().f0.dim, 0);
});

test('patch validation and auto addressing', () => {
  const e = engineWith();
  e.dispatch({ type: 'fixture.add', profile: 'drgbw', count: 3, universe: 1 });
  assert.deepStrictEqual(e.show.fixtures.map((f) => f.address), [1, 6, 11]);
  e.dispatch({ type: 'fixture.add', profile: 'dimmer', universe: 1 });
  assert.strictEqual(e.show.fixtures[3].address, 16);
  assert.throws(() => e.dispatch({ type: 'fixture.add', profile: 'drgbw', universe: 1, address: 510 }));
  e.dispatch({ type: 'fixture.delete', fixtures: [e.show.fixtures[0].id] });
  e.dispatch({ type: 'fixture.add', profile: 'dimmer', universe: 1 });
  assert.strictEqual(e.show.fixtures.at(-1).address, 1);
});

test('restores cue position and scene levels after a restart', () => {
  const e = engineWith({ profile: 'dimmer', address: 1 });
  e.dispatch({ type: 'prog.set', fixtures: ['f0'], values: { dim: 0.7 } });
  e.dispatch({ type: 'cue.record', name: 'A' });
  e.dispatch({ type: 'gm.set', value: 0.8 });
  const e2 = new Engine(JSON.parse(JSON.stringify(e.show)), JSON.parse(JSON.stringify(e.persistentRuntime())));
  assert.strictEqual(e2.rt.cueIndex, 0);
  assert.strictEqual(e2.rt.gm, 0.8);
  assert.strictEqual(e2.computeLook().f0.dim, 0.7);
});

test('packet formats', () => {
  const data = new Uint8Array(512);
  data[0] = 255;
  const a = artnetPacket(3, data, 7);
  assert.strictEqual(a.length, 530);
  assert.strictEqual(a.toString('ascii', 0, 7), 'Art-Net');
  assert.strictEqual(a.readUInt16LE(8), 0x5000);
  assert.strictEqual(a.readUInt16LE(14), 3);
  assert.strictEqual(a[18], 255);

  const s = sacnPacket(1, data, 9, Buffer.alloc(16, 1), 'Test', 100);
  assert.strictEqual(s.length, 638);
  assert.strictEqual(s.toString('ascii', 4, 13), 'ASC-E1.17');
  assert.strictEqual(s.readUInt16BE(16) & 0x0fff, 622);
  assert.strictEqual(s.readUInt16BE(113), 1);
  assert.strictEqual(s.readUInt16BE(123), 513);
  assert.strictEqual(s[126], 255);
  assert.strictEqual(sacnMulticastAddress(258), '239.255.1.2');

  const p = enttecProPacket(data);
  assert.deepStrictEqual([p[0], p[1], p[2], p[3], p[4], p[5], p.at(-1)], [0x7e, 6, 0x01, 0x02, 0, 255, 0xe7]);
});

test('identify blinks the chosen lights white at full, even in blackout', () => {
  const { Engine, emptyShow } = require('../lib/engine');
  const show = emptyShow();
  show.fixtures = [
    { id: 'a', name: 'A', profile: 'rgb', universe: 1, address: 1, x: 0.3, y: 0.5 },
    { id: 'b', name: 'B', profile: 'rgb', universe: 1, address: 10, x: 0.6, y: 0.5 },
  ];
  const e = new Engine(show);
  e.dispatch({ type: 'blackout.set', on: true });
  e.dispatch({ type: 'fixture.identify', fixtures: ['a'] });
  const t = Math.floor(Date.now() / 700) * 700 + 10; // a moment when the blink is on
  const dmx = e.render(e.computeLook(t)).get(1);
  assert.ok(dmx[0] > 250 && dmx[1] > 250 && dmx[2] > 250, `light A is white: ${[...dmx.slice(0, 3)]}`);
  assert.deepStrictEqual([...dmx.slice(9, 12)], [0, 0, 0], 'light B stays in blackout');
  e.dispatch({ type: 'fixture.identify', on: false });
  assert.strictEqual(e.render(e.computeLook(t)).get(1)[0], 0);
});

test('new empty show and demo show keep the output settings', () => {
  const { Engine, emptyShow } = require('../lib/engine');
  const e = new Engine(emptyShow());
  e.dispatch({ type: 'settings.update', settings: { artnetTarget: '2.0.0.9', setupDone: true } });
  e.dispatch({ type: 'show.new', demo: true });
  assert.ok(e.show.fixtures.length > 0);
  assert.strictEqual(e.show.settings.artnetTarget, '2.0.0.9');
  e.dispatch({ type: 'show.new' });
  assert.strictEqual(e.show.fixtures.length, 0);
  assert.strictEqual(e.show.settings.artnetTarget, '2.0.0.9');
  assert.strictEqual(e.show.settings.setupDone, false);
});
