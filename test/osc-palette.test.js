'use strict';
const test = require('node:test');
const assert = require('node:assert');
const dgram = require('dgram');
const { OscIn, parseOsc, encodeOsc } = require('../lib/osc');
const { Engine, emptyShow } = require('../lib/engine');

test('OSC messages and bundles are parsed', () => {
  assert.deepStrictEqual(parseOsc(encodeOsc('/sl/go')), [{ address: '/sl/go', args: [] }]);
  const [m] = parseOsc(encodeOsc('/sl/gm', [0.5]));
  assert.strictEqual(m.address, '/sl/gm');
  assert.ok(Math.abs(m.args[0] - 0.5) < 1e-6);
  assert.deepStrictEqual(parseOsc(encodeOsc('/sl/section', ['Chorus', 1, true])), [{ address: '/sl/section', args: ['Chorus', 1, true] }]);
  // bundle with two messages
  const a = encodeOsc('/a', [1]), b = encodeOsc('/b', ['x']);
  const size = (x) => { const s = Buffer.alloc(4); s.writeInt32BE(x.length); return s; };
  const bundle = Buffer.concat([Buffer.from('#bundle\0'), Buffer.alloc(8), size(a), a, size(b), b]);
  assert.deepStrictEqual(parseOsc(bundle).map((x) => x.address), ['/a', '/b']);
  assert.deepStrictEqual(parseOsc(Buffer.from('junk')), []);
});

test('OSC arrives over UDP', async () => {
  const osc = new OscIn({ warn() {} });
  const port = 39000 + Math.floor(Math.random() * 1000);
  osc.configure(true, port);
  await new Promise((r) => osc.once('status', r));
  const got = new Promise((r) => osc.once('message', r));
  const sock = dgram.createSocket('udp4');
  sock.send(encodeOsc('/sl/tap'), port, '127.0.0.1');
  const m = await got;
  sock.close();
  osc.close();
  assert.strictEqual(m.address, '/sl/tap');
});

function setup() {
  const show = emptyShow();
  show.fixtures = [0, 1].map((i) => ({ id: `f${i}`, name: `F${i}`, profile: 'drgb', universe: 1, address: 1 + i * 4, x: i, y: 0.5 }));
  show.groups = [{ id: 'g', name: 'Back wash', fixtures: ['f0', 'f1'] }];
  const e = new Engine(show);
  e.dispatch({ type: 'prog.set', fixtures: ['f0', 'f1'], values: { dim: 1 } });
  e.dispatch({ type: 'look.record', name: 'Verse' });
  e.dispatch({ type: 'prog.set', fixtures: ['f0', 'f1'], values: { dim: 0.5 } });
  e.dispatch({ type: 'look.record', name: 'Chorus' });
  e.dispatch({ type: 'song.add', name: 'First', sections: ['Verse', 'Chorus'] });
  for (const s of e.show.songs[0].sections) s.fade = 0;
  return e;
}
const osc = (e, address, ...args) => e.dispatch({ type: 'osc.message', address, args });

test('built-in OSC addresses', () => {
  const e = setup();
  osc(e, '/sl/section', 'Chorus');
  assert.strictEqual(e.computeLook().f0.dim, 0.5);
  osc(e, '/sl/section/verse');
  assert.strictEqual(e.computeLook().f0.dim, 1);
  osc(e, '/sl/next');
  assert.strictEqual(e.rt.lastOsc.result, 'First · Chorus');
  osc(e, '/sl/gm', 0.25);
  assert.strictEqual(e.rt.gm, 0.25);
  osc(e, '/sl/strobe', 1);
  assert.ok(e.rt.strobe);
  osc(e, '/sl/strobe', 0);
  assert.ok(!e.rt.strobe);
  osc(e, '/sl/group/back wash/level', 0.4);
  assert.strictEqual(e.rt.busk.g.level, 0.4);
  osc(e, '/sl/group/Back Wash/color', 'secondary');
  assert.strictEqual(e.rt.busk.g.color, 'pal:2');
  osc(e, '/sl/bpm', 96);
  assert.strictEqual(e.rt.bpm, 96);
  // Button release (0) does nothing for momentary commands
  assert.deepStrictEqual(osc(e, '/sl/go', 0), { show: false, runtime: false });
  osc(e, '/sl/mode', 'manual');
  osc(e, '/sl/section', 'Verse');
  assert.match(e.rt.lastOsc.result, /Manual/);
  assert.strictEqual(osc(e, '/other/thing').show, false);
  assert.strictEqual(e.rt.lastOsc.result, 'no match');
});

test('OSC learn maps any message to a section', () => {
  const e = setup();
  const song = e.show.songs[0];
  e.dispatch({ type: 'midi.learn', songId: song.id, sectionId: song.sections[1].id });
  osc(e, '/companion/button', 'chorus');
  assert.deepStrictEqual(song.sections[1].trigger, { t: 'osc', a: '/companion/button', v: 'chorus' });
  osc(e, '/companion/button', 'chorus');
  assert.strictEqual(e.rt.sectionId, song.sections[1].id);
  assert.strictEqual(e.computeLook().f0.dim, 0.5);
});

test('palette: always three colours, per song, and looks follow it', () => {
  const e = setup();
  assert.strictEqual(e.paletteNow().length, 3);
  // Apply Primary to the lights and record a look: it stays linked to "Primary"
  e.dispatch({ type: 'palette.set', index: 0, color: '#ff0000', scope: 'show' });
  e.dispatch({ type: 'preset.apply', id: 'pal:1', fixtures: ['f0', 'f1'] });
  e.dispatch({ type: 'prog.set', fixtures: ['f0', 'f1'], values: { dim: 1 } });
  e.dispatch({ type: 'look.record', name: 'Primary wash' });
  const look = e.show.looks.at(-1);
  assert.deepStrictEqual(look.refs.f0, { red: 'pal:1', green: 'pal:1', blue: 'pal:1' });
  const rgb = () => { const v = e.computeLook().f0; return [v.red, v.green, v.blue]; };
  assert.deepStrictEqual(rgb(), [1, 0, 0]);
  // A song with its own primary: same look, different colour
  e.dispatch({ type: 'song.add', name: 'Second' });
  e.dispatch({ type: 'palette.set', index: 0, color: '#0000ff' });
  assert.deepStrictEqual(e.show.songs.at(-1).palette[0], '#0000ff');
  e.dispatch({ type: 'look.apply', id: look.id, fade: 0 });
  assert.deepStrictEqual(rgb(), [0, 0, 1]);
  e.dispatch({ type: 'song.select', id: e.show.songs[0].id });
  assert.deepStrictEqual(rgb(), [1, 0, 0]);
  // Live override until the song changes
  e.dispatch({ type: 'palette.set', index: 0, color: '#00ff00', scope: 'live' });
  assert.deepStrictEqual(rgb(), [0, 1, 0]);
  e.dispatch({ type: 'song.select', id: e.show.songs.at(-1).id });
  assert.deepStrictEqual(rgb(), [0, 0, 1]);
  // Reset the song to the default colours
  e.dispatch({ type: 'palette.reset' });
  assert.deepStrictEqual(rgb(), [1, 0, 0]);
});

test('palette effects and live colour buttons', () => {
  const e = setup();
  e.dispatch({ type: 'palette.set', index: 0, color: '#ff0000', scope: 'show' });
  e.dispatch({ type: 'palette.set', index: 1, color: '#00ff00', scope: 'show' });
  e.dispatch({ type: 'palette.set', index: 2, color: '#0000ff', scope: 'show' });
  e.dispatch({ type: 'busk.color', groupId: 'g', role: 2 });
  assert.strictEqual(e.computeLook().f0.green, 1);
  e.dispatch({ type: 'busk.color', groupId: 'g', rgb: null });
  e.dispatch({ type: 'tempo.set', bpm: 60 });
  e.dispatch({ type: 'fx.run', key: 'k', effectId: 'pal-chase', fixtures: ['f0'] });
  const t0 = e.rt.beatT0;
  const c = (ms) => { const v = e.computeLook(t0 + ms).f0; return [v.red, v.green, v.blue]; };
  assert.deepStrictEqual(c(0), [1, 0, 0]);
  assert.deepStrictEqual(c(1100), [0, 1, 0]);
  assert.deepStrictEqual(c(2100), [0, 0, 1]);
  e.dispatch({ type: 'fx.run', key: 'k', effectId: 'pal-alt', fixtures: ['f0', 'f1'] });
  const v0 = e.computeLook(t0 + 100).f0, v1 = e.computeLook(t0 + 100).f1;
  assert.notDeepStrictEqual([v0.red, v0.green], [v1.red, v1.green]);
});

test('lights being edited follow palette changes too', () => {
  const e = setup();
  e.dispatch({ type: 'palette.set', index: 0, color: '#ff0000', scope: 'show' });
  e.dispatch({ type: 'preset.apply', id: 'pal:1', fixtures: ['f0'] });
  assert.strictEqual(e.computeLook().f0.red, 1);
  e.dispatch({ type: 'palette.set', index: 0, color: '#00ff00', scope: 'show' });
  const v = e.computeLook().f0;
  assert.deepStrictEqual([v.red, v.green], [0, 1]);
});
