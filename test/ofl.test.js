'use strict';
// Open Fixture Library: search the bundled list, download a fixture, pixel bars (matrix fixtures)
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { FixtureLibrary } = require('../lib/ofl');
const { readOfl } = require('../lib/fixtures');
const { Engine, emptyShow } = require('../lib/engine');

// A small pixel bar: 4 RGB pixels, a master dimmer, modes "3ch" (all pixels together) and "13ch" (each pixel)
const BAR = {
  name: 'Test Bar 4',
  categories: ['Pixel Bar'],
  matrix: { pixelCount: [4, 1, 1] },
  availableChannels: {
    Dimmer: { capability: { type: 'Intensity' } },
    Red: { capability: { type: 'ColorIntensity', color: 'Red' } },
    Green: { capability: { type: 'ColorIntensity', color: 'Green' } },
    Blue: { capability: { type: 'ColorIntensity', color: 'Blue' } },
  },
  templateChannels: {
    'Red $pixelKey': { capability: { type: 'ColorIntensity', color: 'Red' } },
    'Green $pixelKey': { capability: { type: 'ColorIntensity', color: 'Green' } },
    'Blue $pixelKey': { capability: { type: 'ColorIntensity', color: 'Blue' } },
  },
  modes: [
    { name: '3-channel', channels: ['Red', 'Green', 'Blue'] },
    { name: '13-channel', channels: ['Dimmer', { insert: 'matrixChannels', repeatFor: 'eachPixelABC', channelOrder: 'perPixel', templateChannels: ['Red $pixelKey', 'Green $pixelKey', 'Blue $pixelKey'] }] },
  ],
};

test('pixel bars: matrix channels expand, and every pixel gets the colour', () => {
  const modes = readOfl(BAR, 'bar', 'Testco');
  assert.deepStrictEqual(modes.map((m) => m.name), ['Testco Test Bar 4 · 3-channel (3ch)', 'Testco Test Bar 4 · 13-channel (13ch)']);
  assert.deepStrictEqual(modes[1].channelList.map((c) => c.attr), ['dim', ...Array(4).fill(['red', 'green', 'blue']).flat()]);
  const e = new Engine(emptyShow());
  e.dispatch({ type: 'profile.import', profiles: [modes[1]] });
  e.dispatch({ type: 'fixture.add', profile: e.lastImportedProfiles[0].id, universe: 1, address: 1 });
  const fid = e.show.fixtures[0].id;
  e.dispatch({ type: 'prog.set', fixtures: [fid], values: { dim: 1 } });
  e.dispatch({ type: 'prog.color', fixtures: [fid], rgb: [1, 0, 0.5] });
  const d = e.render(e.computeLook()).get(1);
  assert.strictEqual(d[0], 255);
  for (let px = 0; px < 4; px++) assert.deepStrictEqual([d[1 + px * 3], d[2 + px * 3], d[3 + px * 3]], [255, 0, 128], `pixel ${px + 1}`);
});

test('the bundled list is searchable by maker, model and close matches', () => {
  const lib = new FixtureLibrary(fs.mkdtempSync(path.join(os.tmpdir(), 'ofl-')));
  assert.ok(lib.list.length > 500, 'the whole library is bundled');
  const r = lib.search('chauvet rogue r2 wash');
  assert.strictEqual(r[0].name, 'Rogue R2 Wash');
  assert.strictEqual(r[0].manufacturer, 'Chauvet Professional');
  assert.strictEqual(r[0].exact, true);
  assert.ok(lib.search('ADJ mega').every((f) => f.manufacturer === 'American DJ'), 'ADJ means American DJ');
  const close = lib.search('intimidator 355');
  assert.ok(close.length && close.every((f) => !f.exact && /Intimidator/.test(f.name)), 'unknown model: the other Intimidators');
  assert.deepStrictEqual(lib.search('xyzzy'), []);
  assert.deepStrictEqual(lib.search(''), []);
});

test('downloading a fixture: its modes, kept for offline use, errors in plain words', async () => {
  const key = 'chauvet-professional/rogue-r2-wash';
  let hits = 0;
  const srv = http.createServer((req, res) => {
    hits++;
    if (req.url === `/${key}.json`) return res.end(JSON.stringify({ ...BAR, name: 'Rogue R2 Wash' }));
    res.writeHead(404).end('no');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ofl-'));
  const lib = new FixtureLibrary(dir, `http://127.0.0.1:${srv.address().port}/`);
  try {
    const p = await lib.profiles(key);
    assert.deepStrictEqual(p.map((x) => x.mode), ['3-channel', '13-channel']);
    assert.match(p[0].name, /^Chauvet Professional Rogue R2 Wash · 3-channel/);
    await lib.profiles(key);
    assert.strictEqual(hits, 1, 'second time from the cache');
    await assert.rejects(lib.profiles('nobody/nothing'), /not in the library/);
    const other = lib.search('slimpar')[0].key;
    await assert.rejects(lib.profiles(other), /answered 404/);
  } finally {
    srv.close();
  }
  const offline = new FixtureLibrary(fs.mkdtempSync(path.join(os.tmpdir(), 'ofl-')), 'http://127.0.0.1:9/');
  await assert.rejects(offline.profiles(key), /on the internet/);
});
