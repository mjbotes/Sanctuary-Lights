'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { ProPresenter, parsePresentation, jsonSplitter } = require('../lib/propresenter');
const { Engine, emptyShow } = require('../lib/engine');

// A pretend ProPresenter with one presentation: Intro (1 slide), Verse 1 (2), Chorus (2), Verse 2 (2)
function mockPro({ stream = false } = {}) {
  const state = { index: 0, streams: [] };
  const pres = {
    presentation: {
      id: { uuid: 'P-1', name: 'Morning Song', index: 0 },
      groups: [
        { name: 'Intro', color: { red: 0.2, green: 0.2, blue: 1, alpha: 1 }, slides: [{}] },
        { name: 'Verse 1', color: { red: 0, green: 0.6, blue: 1, alpha: 1 }, slides: [{}, {}] },
        { name: 'Chorus', color: { red: 1, green: 0.3, blue: 0, alpha: 1 }, slides: [{}, {}] },
        { name: 'Verse 2', color: { red: 0, green: 0.6, blue: 1, alpha: 1 }, slides: [{}, {}] },
      ],
    },
  };
  const server = http.createServer((req, res) => {
    if (req.url === '/v1/presentation/slide_index') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ presentation_index: { index: state.index, presentation_id: { uuid: 'P-1', name: 'Morning Song', index: 0 } } }));
    }
    if (stream && req.method === 'POST' && req.url === '/v1/status/updates') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write(JSON.stringify({ url: 'presentation/slide_index', data: { presentation_index: { index: state.index, presentation_id: { uuid: 'P-1', name: 'Morning Song' } } } }) + '\r\n\r\n');
      state.streams.push(res);
      return;
    }
    if (req.url === '/v1/presentation/active') return res.end(JSON.stringify(pres));
    if (req.url.startsWith('/v1/presentation/P-1/thumbnail/')) {
      res.setHeader('Content-Type', 'image/jpeg');
      return res.end(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    }
    res.statusCode = 404;
    res.end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, state, port: server.address().port })));
}
const nextSlide = (pp) => new Promise((resolve) => pp.once('slide', resolve));

test('parses presentation groups and slide ranges', () => {
  const p = parsePresentation({ presentation: { id: { uuid: 'x', name: 'S' }, groups: [{ name: 'A', slides: [{}, {}] }, { name: 'B', color: { red: 1, green: 0, blue: 0 }, slides: [{}] }] } });
  assert.deepStrictEqual(p.groups.map((g) => [g.name, g.start, g.count]), [['A', 0, 2], ['B', 2, 1]]);
  assert.deepStrictEqual(p.groups[1].color, [1, 0, 0]);
});

test('follows live slides and reports the group', async () => {
  const mock = await mockPro();
  const pp = new ProPresenter({ warn() {} });
  try {
    let s = nextSlide(pp);
    pp.configure({ enabled: true, host: '127.0.0.1', port: mock.port });
    let slide = await s;
    assert.strictEqual(slide.group.name, 'Intro');
    assert.deepStrictEqual(slide.groups, ['Intro', 'Verse 1', 'Chorus', 'Verse 2']);
    s = nextSlide(pp);
    mock.state.index = 3; // second slide of Verse 1 -> first of Chorus is 3
    slide = await s;
    assert.strictEqual(slide.group.name, 'Chorus');
    assert.deepStrictEqual(slide.group.color, [1, 0.3, 0]);
    const img = await pp.thumbnail('P-1', 3);
    assert.strictEqual(img.type, 'image/jpeg');
    assert.strictEqual(pp.state.connected, true);
  } finally {
    pp.close();
    mock.server.close();
  }
});

test('reports a clear error when ProPresenter is not reachable', async () => {
  const pp = new ProPresenter({ warn() {} });
  const st = new Promise((resolve) => pp.on('status', (x) => x.error && resolve(x)));
  pp.configure({ enabled: true, host: '127.0.0.1', port: 1 });
  const s = await st;
  pp.close();
  assert.strictEqual(s.connected, false);
  assert.ok(s.error);
});

function engineWithSong() {
  const show = emptyShow();
  show.fixtures = [{ id: 'f0', name: 'F0', profile: 'drgb', universe: 1, address: 1, x: 0.5, y: 0.5 }];
  show.groups = [{ id: 'g', name: 'All', fixtures: ['f0'] }];
  const e = new Engine(show);
  e.dispatch({ type: 'settings.update', settings: { pp: { enabled: true, host: 'x', port: 1025 } } });
  e.dispatch({ type: 'prog.set', fixtures: ['f0'], values: { dim: 0.3 } });
  e.dispatch({ type: 'look.record', name: 'Verse' });
  e.dispatch({ type: 'prog.set', fixtures: ['f0'], values: { dim: 1 } });
  e.dispatch({ type: 'look.record', name: 'Chorus' });
  e.dispatch({ type: 'song.add', name: 'Morning Song', sections: ['Intro', 'Verse', 'Chorus', 'Verse 2'] });
  for (const sec of e.show.songs[0].sections) sec.fade = 0;
  e.dispatch({ type: 'song.add', name: 'Other' }); // currently selected: Other
  return e;
}
const slide = (group, color) => ({ type: 'pp.slide', presentation: { uuid: 'P-1', name: 'Morning Song' }, index: 0, group: { name: group, color }, groups: ['Intro', 'Verse 1', 'Chorus', 'Verse 2'] });

test('slide groups select the song and its sections ("Verse 1" -> "Verse")', () => {
  const e = engineWithSong();
  e.dispatch(slide('Verse 1'));
  const song = e.show.songs[0];
  assert.strictEqual(e.rt.songId, song.id);
  assert.strictEqual(e.rt.sectionId, song.sections[1].id);
  assert.strictEqual(e.computeLook().f0.dim, 0.3);
  e.dispatch(slide('Chorus'));
  assert.strictEqual(e.computeLook().f0.dim, 1);
  e.dispatch(slide('Verse 2'));
  assert.strictEqual(e.rt.sectionId, song.sections[3].id);
  e.dispatch({ type: 'mode.set', mode: 'manual' });
  e.dispatch(slide('Chorus'));
  assert.strictEqual(e.rt.sectionId, song.sections[3].id);
  assert.match(e.rt.pp.result, /Manual/);
});

test('without a song, a look with the group name is used', () => {
  const e = engineWithSong();
  e.dispatch({ type: 'settings.update', settings: { pp: { songs: false } } });
  e.show.songs = [];
  e.rt.songId = null;
  e.dispatch(slide('Chorus'));
  assert.strictEqual(e.rt.base.kind, 'look');
  assert.strictEqual(e.computeLook(Date.now() + 2000).f0.dim, 1);
});

test('colour sync from group colour and from the slide image', () => {
  const e = engineWithSong();
  // Default: the screen colour becomes the Primary colour of the palette
  e.dispatch({ type: 'settings.update', settings: { pp: { colorMode: 'group' } } });
  e.dispatch(slide('Chorus', [1, 0, 0]));
  assert.strictEqual(e.paletteNow()[0], '#ff0000');
  // Or it sets the live colour of light groups
  e.dispatch({ type: 'settings.update', settings: { pp: { colorTarget: 'groups' } } });
  e.dispatch(slide('Verse 1', [1, 0, 0]));
  assert.deepStrictEqual(e.rt.busk.g.color, [1, 0, 0]);
  e.dispatch({ type: 'settings.update', settings: { pp: { colorMode: 'slide' } } });
  e.dispatch({ type: 'pp.color', rgb: [0, 0, 1], key: 'P-1|4' });
  assert.deepStrictEqual(e.rt.busk.g.color, [0, 0, 1]);
  assert.deepStrictEqual(e.dispatch({ type: 'pp.color', rgb: [0, 1, 0], key: 'P-1|4' }), { show: false, runtime: false });
});

test('import a song from the live presentation', () => {
  const e = engineWithSong();
  e.show.songs = [];
  e.rt.pp = { presentation: { uuid: 'P-1', name: 'Morning Song' }, groups: ['Intro', 'Verse 1', 'Chorus', 'Verse 2', 'Chorus'] };
  e.dispatch({ type: 'pp.importSong' });
  assert.deepStrictEqual(e.show.songs[0].sections.map((s) => s.name), ['Intro', 'Verse 1', 'Chorus', 'Verse 2']);
  assert.strictEqual(e.show.songs[0].sections[2].lookId, e.show.looks.find((l) => l.name === 'Chorus').id);
});

test('splits a stream of JSON objects, whatever the chunk boundaries', () => {
  const got = [];
  const split = jsonSplitter((o) => got.push(o));
  const text = '{"url":"a","data":{"s":"x}{\\"y"}}\r\n\r\n{"url":"b","data":[1,2]}\n';
  for (const ch of text) split(ch);
  assert.deepStrictEqual(got, [{ url: 'a', data: { s: 'x}{"y' } }, { url: 'b', data: [1, 2] }]);
});

test('slide changes arrive over the streaming connection straight away', async () => {
  const mock = await mockPro({ stream: true });
  const pp = new ProPresenter({ warn() {} });
  try {
    let s = nextSlide(pp);
    pp.configure({ enabled: true, host: '127.0.0.1', port: mock.port });
    await s;
    for (let i = 0; i < 50 && !pp.state.streaming; i++) await new Promise((ok) => setTimeout(ok, 20));
    assert.strictEqual(pp.state.streaming, true);
    // Only the stream knows about the new slide (polling would still say slide 0)
    s = nextSlide(pp);
    const t0 = Date.now();
    for (const res of mock.state.streams) res.write(JSON.stringify({ url: 'presentation/slide_index', data: { presentation_index: { index: 5, presentation_id: { uuid: 'P-1', name: 'Morning Song' } } } }) + '\r\n\r\n');
    const slide = await s;
    assert.strictEqual(slide.group.name, 'Verse 2');
    assert.ok(Date.now() - t0 < 200, `took ${Date.now() - t0} ms`);
  } finally {
    pp.close();
    for (const res of mock.state.streams) res.end();
    mock.server.close();
  }
});
