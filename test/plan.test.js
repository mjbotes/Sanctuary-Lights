'use strict';
// Planning Center import, the service order, the schedule, and sharing song designs.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Engine, emptyShow, demoShow } = require('../lib/engine');
const { parseKey, sectionNames } = require('../lib/engine/actions/plan');
const { PlanningCenter, toPlan } = require('../lib/pco');

// What Planning Center's API returns for a plan's items (JSON:API, trimmed)
const ITEMS = {
  data: [
    { id: '1', type: 'Item', attributes: { title: 'Countdown', item_type: 'media', sequence: 1 } },
    { id: '2', type: 'Item', attributes: { title: 'Worship', item_type: 'header', sequence: 2 } },
    { id: '3', type: 'Item', attributes: { title: 'Graves Into Gardens', item_type: 'song', sequence: 3, key_name: 'B' },
      relationships: { song: { data: { type: 'Song', id: 's1' } }, arrangement: { data: { type: 'Arrangement', id: 'a1' } }, key: { data: { type: 'Key', id: 'k1' } } } },
    { id: '4', type: 'Item', attributes: { title: 'New Song', item_type: 'song', sequence: 4 },
      relationships: { song: { data: { type: 'Song', id: 's2' } }, arrangement: { data: { type: 'Arrangement', id: 'a2' } }, key: { data: { type: 'Key', id: 'k2' } } } },
    { id: '5', type: 'Item', attributes: { title: 'Welcome & announcements', item_type: 'item', sequence: 5 } },
    { id: '6', type: 'Item', attributes: { title: 'Sermon: Hope', item_type: 'item', sequence: 6 } },
    { id: '7', type: 'Item', attributes: { title: 'Closing prayer', item_type: 'item', sequence: 7 } },
  ],
  included: [
    { type: 'Song', id: 's1', attributes: { title: 'Graves Into Gardens' } },
    { type: 'Arrangement', id: 'a1', attributes: { name: 'Default', bpm: 70, sequence: ['Verse 1', 'Chorus', 'Bridge', 'Chorus'] } },
    { type: 'Key', id: 'k1', attributes: { starting_key: 'B' } },
    { type: 'Song', id: 's2', attributes: { title: 'New Song' } },
    { type: 'Arrangement', id: 'a2', attributes: { name: 'Default', bpm: 128, sequence: ['Intro', 'Verse 1', 'Chorus', 'Verse 2', 'Chorus', 'Outro'] } },
    { type: 'Key', id: 'k2', attributes: { starting_key: 'F#m' } },
  ],
};
const PLAN = { data: { id: 'p1', attributes: { title: 'Sunday Morning', dates: 'November 22, 2026' } } };

test('keys and arrangement sequences are read', () => {
  assert.deepStrictEqual(parseKey('B'), { key: 11, minor: false });
  assert.deepStrictEqual(parseKey('F#m'), { key: 6, minor: true });
  assert.deepStrictEqual(parseKey('Bb'), { key: 10, minor: false });
  assert.strictEqual(parseKey('?'), null);
  assert.deepStrictEqual(sectionNames(['Verse 1', 'Chorus', 'Verse 2', 'Chorus', 'Chorus']), ['Verse 1', 'Chorus', 'Verse 2', 'Chorus 2', 'Chorus 3']);
});

test('Planning Center items become a plan in order, with song details', () => {
  const plan = toPlan(PLAN, ITEMS);
  assert.strictEqual(plan.title, 'Sunday Morning');
  assert.deepStrictEqual(plan.items.map((i) => i.kind), ['media', 'header', 'song', 'song', 'item', 'item', 'item']);
  assert.deepStrictEqual(plan.items[3].song, { title: 'New Song', key: 'F#m', bpm: 128, sequence: ['Intro', 'Verse 1', 'Chorus', 'Verse 2', 'Chorus', 'Outro'] });
});

test('importing a plan builds the set list, the service order and lights new songs', () => {
  const e = new Engine(demoShow());
  e.dispatch({ type: 'demo.addSong', id: 'graves-into-gardens', select: false });
  e.dispatch({ type: 'plan.import', plan: toPlan(PLAN, ITEMS) });
  const r = e.lastResult;
  assert.deepStrictEqual([r.songs, r.created, r.designed], [2, 1, 1]);
  // Set list: this service's songs first, in order
  assert.deepStrictEqual(e.show.songs.slice(0, 2).map((s) => s.name), ['Graves Into Gardens', 'New Song']);
  const ns = e.show.songs[1];
  assert.deepStrictEqual(ns.sections.map((s) => s.name), ['Intro', 'Verse 1', 'Chorus', 'Verse 2', 'Chorus 2', 'Outro']);
  assert.deepStrictEqual([ns.key, ns.minor, ns.bpm], [6, true, 128]);
  assert.ok(ns.sections.every((s) => s.lookId), 'new song is lit');
  // The existing song keeps its own sections
  assert.strictEqual(e.show.songs[0].sections.length, 13);
  // Service order: video -> Video part, welcome -> Hosting, sermon -> Sermon, prayer -> a note
  const o = e.show.order;
  assert.strictEqual(o.title, 'Sunday Morning');
  assert.deepStrictEqual(o.items.map((i) => [i.kind, i.partId || i.songId && 'song' || '']),
    [['part', 'video'], ['header', ''], ['song', 'song'], ['song', 'song'], ['part', 'hosting'], ['part', 'sermon'], ['note', '']]);
});

test('the service order steps through the service', () => {
  const e = new Engine(demoShow());
  e.dispatch({ type: 'plan.import', plan: toPlan(PLAN, ITEMS) });
  const items = e.show.order.items;
  e.dispatch({ type: 'order.go', dir: 1 }); // first usable item: the countdown video
  assert.strictEqual(e.rt.partId, 'video');
  e.dispatch({ type: 'order.go', dir: 1 }); // Graves Into Gardens: worship, first section
  assert.strictEqual(e.rt.partId, 'worship');
  assert.strictEqual(e.song(e.rt.songId).name, 'Graves Into Gardens');
  assert.strictEqual(e.rt.sectionId, e.song(e.rt.songId).sections[0].id);
  e.dispatch({ type: 'order.go', id: items.find((i) => i.title.startsWith('Sermon')).id });
  assert.strictEqual(e.rt.partId, 'sermon');
  e.dispatch({ type: 'order.go', dir: -1 });
  assert.strictEqual(e.rt.partId, 'hosting');
});

test('the schedule runs an entry once, at its time, on its days', () => {
  const e = new Engine(demoShow());
  const sun930 = new Date(2026, 10, 22, 9, 30, 5).getTime(); // a Sunday
  e.dispatch({ type: 'part.save', part: { name: 'Pre-service', sections: false } });
  const pre = e.show.parts.at(-1);
  e.dispatch({ type: 'schedule.save', entry: { days: [0], time: '09:30', kind: 'part', target: pre.id } });
  e.dispatch({ type: 'schedule.save', entry: { days: [0], time: '12:30', kind: 'blackout' } });
  e.computeLook(sun930 - 60000); // 09:29: nothing yet
  assert.strictEqual(e.rt.partId, 'worship');
  e.computeLook(sun930);
  assert.strictEqual(e.rt.partId, pre.id, 'pre-service at 09:30');
  e.dispatch({ type: 'part.go', id: 'worship' });
  e.computeLook(sun930 + 30000);
  assert.strictEqual(e.rt.partId, 'worship', 'runs only once that day');
  e.computeLook(new Date(2026, 10, 23, 9, 30, 5).getTime()); // Monday
  assert.strictEqual(e.rt.partId, 'worship', 'not on other days');
  e.computeLook(new Date(2026, 10, 22, 12, 45).getTime()); // 15 minutes late (computer was off)
  assert.strictEqual(e.rt.blackout, false, 'old entries are not run late');
  e.computeLook(new Date(2026, 10, 29, 12, 30, 30).getTime());
  assert.strictEqual(e.rt.blackout, true, 'blackout at 12:30 next Sunday');
  assert.throws(() => e.dispatch({ type: 'schedule.delete', id: 'nope' }));
});

test('sharing a song: same rig gets the exact looks back', () => {
  const a = new Engine(demoShow());
  a.dispatch({ type: 'demo.addSong', id: 'graves-into-gardens' });
  a.dispatch({ type: 'song.export', id: a.rt.songId });
  const file = JSON.parse(JSON.stringify(a.lastResult.file));
  assert.strictEqual(file.format, 'sanctuary-lights-song');
  const b = new Engine(demoShow()); // same lights, same names
  b.dispatch({ type: 'song.importFile', file });
  assert.strictEqual(b.lastResult.mode, 'exact');
  const sa = a.song(a.rt.songId), sb = b.song(b.rt.songId);
  assert.deepStrictEqual(sb.palette, sa.palette);
  const val = (eng, song, n) => {
    const look = eng.show.looks.find((l) => l.id === song.sections.find((s) => s.name === n).lookId);
    const fid = eng.show.fixtures.find((f) => f.name === 'Back 1').id;
    return look.values[fid];
  };
  assert.deepStrictEqual(val(b, sb, 'Bridge 3'), val(a, sa, 'Bridge 3'));
});

test('sharing a song: a different rig gets the design rebuilt on its own lights', () => {
  const a = new Engine(demoShow());
  a.dispatch({ type: 'demo.addSong', id: 'graves-into-gardens' });
  a.dispatch({ type: 'song.export', id: a.rt.songId });
  const file = JSON.parse(JSON.stringify(a.lastResult.file));
  const show = emptyShow();
  show.fixtures = [
    { id: 'w1', name: 'Wash L', profile: 'drgb', universe: 1, address: 1, x: 0.2, y: 0.2 },
    { id: 'w2', name: 'Wash R', profile: 'drgb', universe: 1, address: 5, x: 0.8, y: 0.2 },
    { id: 'f1', name: 'Front', profile: 'dimmer', universe: 1, address: 9, x: 0.5, y: 0.9 },
  ];
  const b = new Engine(show);
  b.dispatch({ type: 'song.importFile', file });
  assert.strictEqual(b.lastResult.mode, 'design');
  const song = b.song(b.rt.songId);
  assert.ok(song.sections.every((s) => s.lookId));
  const look = (n) => b.show.looks.find((l) => l.id === song.sections.find((s) => s.name === n).lookId);
  assert.strictEqual(look('Intro').refs.w1.blue, 'pal:3', 'intro keeps its violet palette slot');
  assert.ok(look('Bridge 3').values.w1.dim > look('Bridge 1').values.w1.dim, 'the build-up survives');
  assert.ok(look('Bridge 3').effects.some((e) => e.effectId === 'pal-chase'));
  assert.throws(() => b.dispatch({ type: 'song.importFile', file: { format: 'other' } }), /not a Sanctuary Lights song/);
});

test('Planning Center client: connect, list plans and read one (against a pretend server)', async () => {
  let auth = '';
  const server = http.createServer((req, res) => {
    auth = req.headers.authorization || '';
    res.setHeader('Content-Type', 'application/json');
    if (auth !== `Basic ${Buffer.from('app:secret').toString('base64')}`) { res.statusCode = 401; return res.end('{}'); }
    const u = req.url;
    if (u.startsWith('/services/v2/service_types?')) return res.end(JSON.stringify({ data: [{ id: 'st1', attributes: { name: 'Sunday' } }] }));
    if (u.startsWith('/services/v2/service_types/st1/plans?')) return res.end(JSON.stringify({ data: [{ id: 'p1', attributes: { title: 'Sunday Morning', dates: 'November 22, 2026', sort_date: '2026-11-22' } }] }));
    if (u === '/services/v2/service_types/st1/plans/p1') return res.end(JSON.stringify(PLAN));
    if (u.startsWith('/services/v2/service_types/st1/plans/p1/items')) return res.end(JSON.stringify(ITEMS));
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pco-')), 'pc.json');
  try {
    const pc = new PlanningCenter(file, `http://127.0.0.1:${server.address().port}`);
    assert.strictEqual(pc.connected, false);
    await assert.rejects(pc.connect('app', 'wrong'), /did not accept/);
    await pc.connect('app', 'secret');
    assert.strictEqual(pc.connected, true);
    assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600, 'token file is private');
    assert.deepStrictEqual(await pc.serviceTypes(), [{ id: 'st1', name: 'Sunday' }]);
    assert.strictEqual((await pc.upcomingPlans('st1'))[0].title, 'Sunday Morning');
    const plan = await pc.plan('st1', 'p1');
    assert.strictEqual(plan.items.length, 7);
    // A restart remembers the sign-in
    assert.strictEqual(new PlanningCenter(file).connected, true);
    pc.disconnect();
    assert.strictEqual(fs.existsSync(file), false);
  } finally {
    server.close();
  }
});
