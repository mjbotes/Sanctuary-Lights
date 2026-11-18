'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { Engine, emptyShow } = require('../lib/engine');
const { ProPresenter } = require('../lib/propresenter');

// One RGB light; looks Verse (red, 50%), Chorus (blue, full), Sermon (warm white, 70%); one song.
function setup() {
  const show = emptyShow();
  show.fixtures = [{ id: 'f', name: 'F', profile: 'drgb', universe: 1, address: 1, x: 0.5, y: 0.5 }];
  const e = new Engine(show);
  const rec = (name, values) => {
    e.dispatch({ type: 'prog.set', fixtures: ['f'], values });
    e.dispatch({ type: 'look.record', name });
    e.dispatch({ type: 'prog.clear' });
  };
  rec('Verse', { dim: 0.5, red: 1, green: 0, blue: 0 });
  rec('Chorus', { dim: 1, red: 0, green: 0, blue: 1 });
  rec('Sermon', { dim: 0.7, red: 1, green: 0.8, blue: 0.6 });
  e.dispatch({ type: 'song.add', name: 'Great Song', sections: ['Verse', 'Chorus'] });
  const song = e.show.songs[0];
  for (const s of song.sections) e.dispatch({ type: 'section.edit', songId: song.id, id: s.id, fade: 0 });
  const sermonLook = e.show.looks.find((l) => l.name === 'Sermon');
  e.dispatch({ type: 'part.save', part: { id: 'sermon', lookId: sermonLook.id, fade: 0 } });
  e.dispatch({ type: 'part.save', part: { id: 'worship', fade: 0 } });
  e.dispatch({ type: 'part.save', part: { id: 'video', fade: 0 } });
  return { e, song };
}
const later = () => Date.now() + 5000;
const out = (e) => [...e.render(e.computeLook(later())).get(1).slice(0, 4)]; // dim r g b
const midi = (e, n) => e.dispatch({ type: 'midi.message', data: [0x90, n, 100] });

test('a new show has Worship, Hosting, Sermon and Video parts; Worship is on', () => {
  const { e } = setup();
  assert.deepStrictEqual(e.show.parts.map((p) => p.name), ['Worship', 'Hosting', 'Sermon', 'Video']);
  assert.strictEqual(e.rt.partId, 'worship');
  assert.strictEqual(e.show.parts[3].level, 0.1);
});

test('the sermon part shows its look and song triggers are ignored; tapping a section brings worship back', () => {
  const { e, song } = setup();
  midi(e, 36); // Verse
  assert.deepStrictEqual(out(e), [128, 255, 0, 0]);
  e.dispatch({ type: 'part.go', id: 'sermon' });
  assert.deepStrictEqual(out(e), [179, 255, 204, 153], 'sermon look');
  midi(e, 37); // Chorus from the tracks: ignored
  assert.deepStrictEqual(out(e), [179, 255, 204, 153]);
  assert.match(e.rt.lastMidi.result, /ignored: Sermon/);
  e.dispatch({ type: 'section.go', songId: song.id, id: song.sections[1].id }); // operator taps Chorus
  assert.strictEqual(e.rt.partId, 'worship');
  assert.deepStrictEqual(out(e), [255, 0, 0, 255]);
});

test('going back to worship restores the song section look', () => {
  const { e } = setup();
  midi(e, 37);
  e.dispatch({ type: 'part.go', id: 'sermon' });
  e.dispatch({ type: 'part.go', id: 'worship' });
  assert.deepStrictEqual(out(e), [255, 0, 0, 255]);
});

test('a video dims everything and the lights come back when it ends', () => {
  const { e } = setup();
  midi(e, 37);
  e.dispatch({ type: 'pp.video', playing: true, name: 'Announcements.mp4' });
  assert.strictEqual(e.rt.partId, 'video');
  assert.deepStrictEqual(out(e), [26, 0, 0, 255], 'chorus look at 10% brightness');
  e.dispatch({ type: 'pp.video', playing: false });
  assert.strictEqual(e.rt.partId, 'worship');
  assert.deepStrictEqual(out(e), [255, 0, 0, 255]);
  // A video during the sermon returns to the sermon
  e.dispatch({ type: 'part.go', id: 'sermon' });
  e.dispatch({ type: 'pp.video', playing: true });
  e.dispatch({ type: 'pp.video', playing: false });
  assert.strictEqual(e.rt.partId, 'sermon');
  // Switched off in settings: videos change nothing
  e.dispatch({ type: 'settings.update', settings: { pp: { videoPart: false } } });
  e.dispatch({ type: 'pp.video', playing: true });
  assert.strictEqual(e.rt.partId, 'sermon');
});

test('level fades between parts', () => {
  const { e } = setup();
  e.dispatch({ type: 'part.save', part: { id: 'video', fade: 2 } });
  e.dispatch({ type: 'part.go', id: 'video' });
  const t0 = e.rt.partFade.start;
  assert.ok(Math.abs(e.partLevelAt(t0 + 1000) - 0.55) < 0.01);
  assert.strictEqual(e.partLevelAt(t0 + 2500), 0.1);
});

test('screen colours are followed in worship only, and dropped for the sermon', () => {
  const { e } = setup();
  e.dispatch({ type: 'settings.update', settings: { pp: { colorMode: 'group' } } });
  e.dispatch({ type: 'pp.slide', presentation: { uuid: 'x', name: 'Great Song' }, index: 0, group: { name: 'Verse', color: [0, 1, 0] } });
  assert.strictEqual(e.rt.paletteLive[0], '#00ff00');
  e.dispatch({ type: 'part.go', id: 'sermon' });
  assert.strictEqual(e.rt.paletteLive[0], undefined, 'screen colour released');
  e.applyScreenColor([1, 0, 1]);
  assert.strictEqual(e.rt.paletteLive[0], undefined, 'not followed during the sermon');
});

test('ProPresenter presentations pick the part by name; a video keeps the place to come back to', () => {
  const { e } = setup();
  const slide = (uuid, name, group) => e.dispatch({ type: 'pp.slide', presentation: { uuid, name }, index: 0, group: group ? { name: group } : null });
  slide('a', 'Sermon notes 12 May');
  assert.strictEqual(e.rt.partId, 'sermon');
  slide('b', 'Welcome & announcements');
  assert.strictEqual(e.rt.partId, 'hosting');
  slide('c', 'Great Song', 'Chorus');
  assert.strictEqual(e.rt.partId, 'worship');
  assert.deepStrictEqual(out(e), [255, 0, 0, 255]);
  e.dispatch({ type: 'pp.video', playing: true });
  slide('d', 'Message');
  assert.strictEqual(e.rt.partId, 'video', 'still dimmed for the video');
  e.dispatch({ type: 'pp.video', playing: false });
  assert.strictEqual(e.rt.partId, 'sermon');
  // Slide groups are ignored during the sermon
  slide('d', 'Message', 'Chorus');
  assert.match(e.rt.pp.result, /ignored: Sermon/);
});

test('panic brings the worship part back at full brightness', () => {
  const { e } = setup();
  e.dispatch({ type: 'pp.video', playing: true });
  e.dispatch({ type: 'panic' });
  assert.strictEqual(e.rt.partId, 'worship');
  assert.strictEqual(e.partLevelAt(Date.now() + 2000), 1);
});

test('parts can be added, edited and deleted (not the Video part)', () => {
  const { e } = setup();
  e.dispatch({ type: 'part.save', part: { name: 'Communion', level: 0.6, sections: false, match: 'communion, lords supper' } });
  const c = e.show.parts.at(-1);
  assert.strictEqual(c.name, 'Communion');
  assert.strictEqual(e.partForPresentation('Communion 2026').id, c.id);
  e.dispatch({ type: 'part.go', id: c.id });
  e.dispatch({ type: 'part.delete', id: c.id });
  assert.strictEqual(e.rt.partId, 'worship');
  assert.throws(() => e.dispatch({ type: 'part.delete', id: 'video' }));
  e.dispatch({ type: 'osc.message', address: '/sl/part', args: ['sermon'] });
  assert.strictEqual(e.rt.partId, 'sermon');
});

test('ProPresenter: a playing video is noticed from the transport time', async () => {
  const st = { time: 0, playing: false };
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/presentation/slide_index') return res.end(JSON.stringify({ presentation_index: null }));
    if (req.url === '/v1/transport/presentation/time') { if (st.playing) st.time += 0.4; return res.end(JSON.stringify(st.time)); }
    if (req.url === '/v1/transport/presentation/current') return res.end(JSON.stringify({ name: 'Countdown.mp4', audio_only: false }));
    res.statusCode = 404;
    res.end();
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const pp = new ProPresenter({ warn() {} });
  const events = [];
  pp.on('video', (v) => events.push(v));
  try {
    pp.configure({ enabled: true, host: '127.0.0.1', port: server.address().port });
    await new Promise((ok) => setTimeout(ok, 1200));
    assert.deepStrictEqual(events, [], 'nothing while stopped');
    st.playing = true;
    await new Promise((ok) => setTimeout(ok, 1500));
    assert.deepStrictEqual(events, [{ playing: true, name: 'Countdown.mp4' }]);
    st.playing = false;
    await new Promise((ok) => setTimeout(ok, 1800));
    assert.deepStrictEqual(events.at(-1), { playing: false, name: 'Countdown.mp4' });
  } finally {
    pp.close();
    server.close();
  }
});

test('custom parts: a template claims its words, records its look from the stage, and moves', () => {
  const { e } = setup();
  midi(e, 37); // Chorus on stage
  e.dispatch({ type: 'part.save', part: { name: 'Baptism', level: 1, sections: false, screenColor: false, match: 'baptism, baptise' } });
  e.dispatch({ type: 'part.save', part: { name: 'Offering', sections: false, screenColor: false, match: 'offering, giving, tithe' } });
  const hosting = e.part('hosting');
  assert.ok(!/offering|giving/.test(hosting.match), `hosting no longer claims offering: ${hosting.match}`);
  assert.strictEqual(e.partForPresentation('Offering & giving').name, 'Offering');
  const bap = e.show.parts.find((p) => p.name === 'Baptism');
  // Set the stage for the baptism (cool blue at 60%) and record it as the part's look
  e.dispatch({ type: 'prog.set', fixtures: ['f'], values: { dim: 0.6, red: 0, green: 0.4, blue: 1 } });
  e.dispatch({ type: 'part.recordLook', id: bap.id });
  assert.strictEqual(e.rt.partId, bap.id);
  assert.strictEqual(e.show.looks.find((l) => l.id === bap.lookId).name, 'Baptism');
  assert.deepStrictEqual(out(e), [153, 0, 102, 255]);
  // Back to worship: the chorus comes back
  e.dispatch({ type: 'part.go', id: 'worship' });
  assert.deepStrictEqual(out(e), [255, 0, 0, 255]);
  // Re-recording updates the same look
  e.dispatch({ type: 'prog.set', fixtures: ['f'], values: { dim: 0.3 } });
  e.dispatch({ type: 'part.recordLook', id: bap.id });
  assert.strictEqual(e.show.looks.filter((l) => l.name === 'Baptism').length, 1);
  // Template naming an existing look uses it
  e.dispatch({ type: 'part.save', part: { name: 'Altar call', lookName: 'Verse', sections: true } });
  assert.strictEqual(e.show.looks.find((l) => l.id === e.show.parts.at(-1).lookId).name, 'Verse');
  // Order
  const n = e.show.parts.length;
  e.dispatch({ type: 'part.move', id: bap.id, dir: -1 });
  assert.strictEqual(e.show.parts.findIndex((p) => p.id === bap.id), n - 4);
});
