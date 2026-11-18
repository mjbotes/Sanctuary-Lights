'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Engine, emptyShow, demoShow } = require('../lib/engine');
const { kindOf } = require('../lib/engine/design');

const later = () => Date.now() + 10000;

test('section names map to kinds', () => {
  const k = (n) => kindOf(n);
  assert.deepStrictEqual(['Intro', 'Verse 2', 'Pre-Chorus', 'Chorus 3', 'Bridge 1', 'Tag', 'Interlude', 'Outro', 'Ending'].map(k),
    ['intro', 'verse', 'pre', 'chorus', 'bridge', 'tag', 'instrumental', 'outro', 'outro']);
});

test('the rig is sorted into roles', () => {
  const e = new Engine(demoShow());
  const r = e.rigRoles();
  const names = (ids) => ids.map((id) => e.show.fixtures.find((f) => f.id === id).name);
  assert.deepStrictEqual(names(r.front), ['Front 1', 'Front 2', 'Front 3', 'Front 4']);
  assert.strictEqual(r.back.length, 6);
  assert.deepStrictEqual(names(r.special), ['Pulpit spot']);
  assert.deepStrictEqual(names(r.house), ['House lights']);
});

test('"light this song for me" makes one look per kind, linked to the palette, with sensible energy', () => {
  const e = new Engine(demoShow());
  e.dispatch({ type: 'song.add', name: 'New Song', sections: ['Intro', 'Verse 1', 'Chorus 1', 'Verse 2', 'Chorus 2', 'Bridge', 'Outro'] });
  const song = e.show.songs.at(-1);
  e.dispatch({ type: 'song.design', id: song.id });
  const lookOf = (name) => e.show.looks.find((l) => l.id === song.sections.find((s) => s.name === name).lookId);
  assert.strictEqual(lookOf('Chorus 1').id, lookOf('Chorus 2').id, 'choruses share a look');
  assert.strictEqual(lookOf('Chorus 1').name, 'New Song · Chorus');
  const back = e.show.fixtures.find((f) => f.name === 'Back 1').id;
  const front = e.show.fixtures.find((f) => f.name === 'Front 1').id;
  assert.ok(lookOf('Chorus 1').values[back].dim > lookOf('Verse 1').values[back].dim, 'chorus brighter than verse');
  assert.strictEqual(lookOf('Chorus 1').refs[back].red, 'pal:1', 'back colour linked to the primary');
  assert.ok(!lookOf('Chorus 1').refs[front], 'front light stays warm white, not palette');
  assert.ok(lookOf('Chorus 1').values[front].dim > 0.9);
  // The song's palette drives the stage: change the primary and the chorus follows
  e.dispatch({ type: 'song.select', id: song.id });
  e.dispatch({ type: 'section.go', songId: song.id, id: song.sections[2].id });
  e.dispatch({ type: 'palette.set', index: 0, color: '#00ff00' });
  const v = e.computeLook(later())[back];
  assert.ok(v.green > 0.9 && v.red < 0.1, `back follows the palette: ${JSON.stringify(v)}`);
  // Running it again replaces the looks instead of adding more
  const n = e.show.looks.length;
  e.dispatch({ type: 'song.design', id: song.id });
  assert.strictEqual(e.show.looks.length, n);
});

test('Graves Into Gardens demo: the story builds from dark violet to gold and green', () => {
  const e = new Engine(demoShow());
  e.dispatch({ type: 'demo.addSong', id: 'graves-into-gardens' });
  const song = e.show.songs.find((s) => s.name === 'Graves Into Gardens');
  assert.strictEqual(e.rt.songId, song.id);
  assert.deepStrictEqual(song.palette, ['#ffb347', '#3ccf6e', '#3a2a9a']);
  assert.strictEqual(song.sections.length, 13);
  assert.ok(song.sections.every((s) => s.lookId), 'every section has a look');
  const back = e.show.fixtures.find((f) => f.name === 'Back 1').id;
  const look = (n) => e.show.looks.find((l) => l.id === song.sections.find((s) => s.name === n).lookId);
  const b = ['Bridge 1', 'Bridge 2', 'Bridge 3'].map((n) => look(n).values[back].dim);
  assert.ok(b[0] < b[1] && b[1] < b[2], `bridges build: ${b}`);
  assert.strictEqual(look('Intro').refs[back].blue, 'pal:3', 'the grave: tertiary violet');
  assert.strictEqual(look('Bridge 3').refs[back].red, 'pal:1', 'the garden: gold');
  assert.ok(look('Bridge 3').effects.length >= 2, 'the big moment moves');
  // Effects in a look run when the section is on
  e.dispatch({ type: 'section.go', songId: song.id, id: song.sections.find((s) => s.name === 'Bridge 3').id });
  assert.ok(e.computeLook(later()));
  // Lighting renders without errors for every section
  for (const s of song.sections) {
    e.dispatch({ type: 'section.go', songId: song.id, id: s.id });
    const dmx = e.render(e.computeLook(later()));
    assert.ok(dmx.get(1).some((x) => x > 0), `${s.name} lights something`);
  }
});

test('the demo show and a new demo include the demo song', () => {
  const e = new Engine(emptyShow());
  e.dispatch({ type: 'show.new', demo: true });
  assert.ok(e.show.songs.some((s) => s.name === 'Graves Into Gardens'));
});

test('a rig without lights cannot be designed', () => {
  const e = new Engine(emptyShow());
  e.dispatch({ type: 'song.add', name: 'X', sections: ['Verse'] });
  assert.throws(() => e.dispatch({ type: 'song.design', id: e.show.songs[0].id }), /lights/);
});
