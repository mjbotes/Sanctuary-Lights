'use strict';
// Cue timing (fade up/down, delay, auto-follow), tracking cue lists, MIDI timecode, Art-Net/sACN input.
const test = require('node:test');
const assert = require('node:assert');
const { Engine, emptyShow } = require('../lib/engine');
const { MtcDecoder, parseTimecode, format } = require('../lib/timecode');
const { DmxInput, parseArtnet, parseSacn } = require('../lib/dmxinput');
const { artnetPacket, sacnPacket } = require('../lib/output');

function setup() {
  const show = emptyShow();
  show.fixtures = [{ id: 'a', name: 'A', profile: 'drgb', universe: 1, address: 1, x: 0.3, y: 0.5 }, { id: 'b', name: 'B', profile: 'drgb', universe: 1, address: 5, x: 0.7, y: 0.5 }];
  return new Engine(show);
}
const near = (x, y) => Math.abs(x - y) < 1e-6;

test('fade up and fade down times, and cue delay', () => {
  const e = setup();
  e.dispatch({ type: 'prog.set', fixtures: ['a'], values: { dim: 1 } });
  e.dispatch({ type: 'cue.record', name: 'A up' }); // a = 1, b = 0
  e.dispatch({ type: 'prog.set', fixtures: ['b'], values: { dim: 1 } });
  e.dispatch({ type: 'prog.set', fixtures: ['a'], values: { dim: 0 } });
  e.dispatch({ type: 'cue.record', name: 'B up' }); // a = 0, b = 1
  const [c1, c2] = e.show.cues;
  e.dispatch({ type: 'cue.edit', id: c2.id, fade: 4, fadeDown: 2, delay: 1 });
  e.dispatch({ type: 'cue.goto', id: c1.id, fade: 0 });
  e.dispatch({ type: 'cue.go' });
  const t0 = e.cueFade.start;
  const at = (ms) => e.computeLook(t0 + ms);
  assert.strictEqual(at(900).a.dim, 1, 'nothing moves during the delay');
  assert.strictEqual(at(900).b.dim, 0);
  assert.ok(near(at(2000).a.dim, 0.5), 'down: half of 2 s'); // smoothstep(0.5) = 0.5
  assert.ok(near(at(3000).b.dim, 0.5), 'up: half of 4 s');
  assert.strictEqual(at(3000).a.dim, 0, 'down finished');
  assert.strictEqual(e.cueFade.dur, 5000);
});

test('auto-follow goes to the next cue by itself', () => {
  const e = setup();
  let changed = 0;
  e.on('changed', () => changed++);
  for (const n of ['1', '2', '3']) e.dispatch({ type: 'cue.record', name: n });
  const [c1] = e.show.cues;
  e.dispatch({ type: 'cue.edit', id: c1.id, fade: 1, follow: 2 });
  e.dispatch({ type: 'cue.goto', id: c1.id });
  const at = e.rt.followAt - Date.now();
  assert.ok(at > 2900 && at <= 3000, `follows after fade + wait (${at})`);
  e.computeLook(e.rt.followAt + 1);
  assert.strictEqual(e.rt.cueIndex, 1);
  assert.strictEqual(changed, 1);
});

test('tracking cue list stores only changes and carries the rest', () => {
  const e = setup();
  e.dispatch({ type: 'settings.update', settings: { tracking: true } });
  e.dispatch({ type: 'prog.set', fixtures: ['a'], values: { dim: 1 } });
  e.dispatch({ type: 'cue.record', name: '1' });
  e.dispatch({ type: 'prog.set', fixtures: ['b'], values: { dim: 0.5 } });
  e.dispatch({ type: 'cue.record', name: '2' });
  const [c1, c2] = e.show.cues;
  assert.deepStrictEqual(Object.keys(c2.values), ['b'], 'cue 2 only stores B');
  e.dispatch({ type: 'cue.goto', id: c2.id, fade: 0 });
  assert.strictEqual(e.computeLook().a.dim, 1, 'A tracks through from cue 1');
  // Changing cue 1 now also changes cue 2 (tracking)
  e.dispatch({ type: 'cue.goto', id: c1.id, fade: 0 });
  e.dispatch({ type: 'prog.set', fixtures: ['a'], values: { dim: 0.3 } });
  e.dispatch({ type: 'cue.update' });
  e.dispatch({ type: 'cue.goto', id: c2.id, fade: 0 });
  assert.strictEqual(e.computeLook().a.dim, 0.3);
  // A blocking cue stops tracking
  e.dispatch({ type: 'cue.edit', id: c2.id, block: true });
  assert.strictEqual(e.computeLook().a.dim, 0);
});

test('MIDI timecode: quarter frames and full frames', () => {
  const d = new MtcDecoder();
  const got = [];
  d.on('time', (t) => got.push(t));
  // 01:02:03:10 at 25 fps (rate code 1 -> bits 5-6 of hours = 0b01)
  const hh = 1 | (1 << 5);
  const parts = [10 & 15, 10 >> 4, 3 & 15, 3 >> 4, 2 & 15, 2 >> 4, hh & 15, hh >> 4];
  parts.forEach((v, i) => d.feed([0xf1, (i << 4) | v]));
  assert.strictEqual(got.length, 1);
  assert.strictEqual(got[0].fps, 25);
  assert.ok(near(got[0].seconds, 3723 + 12 / 25), 'quarter frames are 2 frames behind');
  assert.strictEqual(d.feed([0xf0, 0x7f, 0x7f, 0x01, 0x01, hh, 2, 3, 10, 0xf7]), true);
  assert.ok(near(got[1].seconds, 3723 + 10 / 25));
  assert.strictEqual(format(3723.4, 25), '01:02:03:10');
  assert.strictEqual(parseTimecode('01:02:03:10', 25), 3723.4);
  assert.strictEqual(parseTimecode('2:30'), 150);
  assert.strictEqual(parseTimecode('1:00:00'), 3600);
  assert.strictEqual(parseTimecode('x'), null);
  d.removeAllListeners();
});

test('timecode drives cues and song sections (also after jumps)', () => {
  const e = setup();
  e.dispatch({ type: 'settings.update', settings: { tcEnabled: true } });
  for (const n of ['Walk-in', 'Welcome']) e.dispatch({ type: 'cue.record', name: n });
  const [w1, w2] = e.show.cues;
  e.dispatch({ type: 'cue.edit', id: w1.id, tc: 10 });
  e.dispatch({ type: 'cue.edit', id: w2.id, tc: 20 });
  e.dispatch({ type: 'cue.release' });
  const tc = (s) => e.dispatch({ type: 'tc.update', seconds: s, fps: 30 });
  tc(5);
  tc(10.1);
  assert.strictEqual(e.rt.cueIndex, 0);
  tc(19.9);
  assert.strictEqual(e.rt.cueIndex, 0);
  tc(20.1);
  assert.strictEqual(e.rt.cueIndex, 1);
  tc(12); // jump back
  assert.strictEqual(e.rt.cueIndex, 0);
  // Songs: start timecode + markers relative to it
  e.dispatch({ type: 'song.add', name: 'S', sections: ['Verse', 'Chorus'] });
  const s = e.show.songs[0];
  e.dispatch({ type: 'song.audio', id: s.id, tcStart: 100 });
  e.dispatch({ type: 'marker.set', songId: s.id, sectionId: s.sections[0].id, time: 0 });
  e.dispatch({ type: 'marker.set', songId: s.id, sectionId: s.sections[1].id, time: 30 });
  tc(100.2);
  assert.strictEqual(e.rt.songId, s.id);
  assert.strictEqual(e.rt.sectionId, s.sections[0].id);
  tc(130.1);
  assert.strictEqual(e.rt.sectionId, s.sections[1].id);
  assert.match(e.rt.lastMidi.result, /timecode/);
  // Off: nothing follows
  e.dispatch({ type: 'settings.update', settings: { tcEnabled: false } });
  assert.deepStrictEqual(tc(100.5), { show: false, runtime: false });
});

test('Art-Net and sACN input: parse, merge (HTP) and backup', () => {
  const data = new Uint8Array(512);
  data[0] = 200;
  data[1] = 10;
  const a = parseArtnet(artnetPacket(0, data, 1));
  assert.deepStrictEqual([a.port, a.data[0], a.data[1]], [0, 200, 10]);
  const s = parseSacn(sacnPacket(3, data, 1, Buffer.alloc(16, 7), 'desk', 100));
  assert.deepStrictEqual([s.universe, s.data[0], s.cid], [3, 200, '07'.repeat(16)]);
  assert.strictEqual(parseArtnet(Buffer.from('nope')), null);

  const inp = new DmxInput({ warn() {} });
  inp.cfg = { enabled: true, protocol: 'artnet', mode: 'merge', artnetBase: 0, universes: [1], ignoreOwn: true };
  inp.own = new Set(['10.0.0.5']);
  inp.receive(artnetPacket(0, data, 1), { address: '10.0.0.9' });
  inp.receive(artnetPacket(0, new Uint8Array(512).fill(255), 1), { address: '10.0.0.5' }); // our own: ignored
  const ours = new Uint8Array(512);
  ours[1] = 100;
  ours[2] = 50;
  let out = inp.apply(new Map([[1, ours]])).get(1);
  assert.deepStrictEqual([out[0], out[1], out[2]], [200, 100, 50], 'highest wins');
  inp.cfg.mode = 'backup';
  out = inp.apply(new Map([[1, ours]])).get(1);
  assert.deepStrictEqual([out[0], out[1], out[2]], [200, 10, 0], 'desk passes through');
  out = inp.apply(new Map([[1, ours]]), Date.now() + 5000).get(1);
  assert.deepStrictEqual([out[0], out[1]], [0, 100], 'desk stopped: our show takes over');
  assert.strictEqual(inp.status().universes[0].source, '10.0.0.9');
});
