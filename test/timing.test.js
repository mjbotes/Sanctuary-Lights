'use strict';
// Bar grid, jumps on the next bar, click and count-in for the tracks player.
const test = require('node:test');
const assert = require('node:assert');
const load = () => import('../public/audio/timing.js');

test('bar grid and the next bar line (with a tempo change)', async () => {
  const { grid, nextBar, beatAt, snapToBeat, barLength } = await load();
  const g = grid({ bpm: 120, beatsPerBar: 4, downbeat: 1 }); // 0.5 s beats, 2 s bars, first downbeat at 1 s
  assert.strictEqual(barLength(g), 2);
  assert.strictEqual(nextBar(1.5, g), 3);
  assert.strictEqual(nextBar(2.98, g), 5, 'too close to the bar line: the one after');
  assert.strictEqual(nextBar(0, g), 1);
  assert.strictEqual(beatAt(2, g), 2);
  assert.strictEqual(snapToBeat(2.2, g), 2);
  const fast = grid({ bpm: 100, targetBpm: 125, downbeat: 1 }); // 25% faster: downbeat moves to 0.8 s
  assert.strictEqual(fast.beat, 0.48);
  assert.ok(Math.abs(fast.downbeat - 0.8) < 1e-9);
});

test('click track and count-in', async () => {
  const { grid, clickTrack, countIn } = await load();
  const sr = 8000;
  const g = grid({ bpm: 120, beatsPerBar: 4 });
  const c = clickTrack(sr, 2.2, g);
  const onsets = [];
  for (let i = 1; i < c.length; i++) if (c[i - 1] === 0 && Math.abs(c[i]) > 0 && (onsets.length === 0 || i - onsets.at(-1) > 100)) onsets.push(i);
  // clicks every 0.5 s: 0, 0.5, 1, 1.5, 2 (the very first sample is 0 because sin(0) = 0)
  assert.deepStrictEqual(onsets.map((i) => Math.round((i / sr) * 10) / 10), [0, 0.5, 1, 1.5, 2]);
  const ci = countIn(sr, g, 1);
  assert.strictEqual(ci.seconds, 2);
});

test('cache keys are stable and different for different inputs', async () => {
  const { hashKey } = await load();
  assert.strictEqual(hashKey('a|2|1'), hashKey('a|2|1'));
  assert.notStrictEqual(hashKey('a|2|1'), hashKey('a|3|1'));
  assert.match(hashKey('x'), /^[0-9a-f]{16}$/);
});
