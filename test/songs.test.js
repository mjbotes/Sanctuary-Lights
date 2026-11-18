'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Engine, emptyShow } = require('../lib/engine');

// One dimmer, two looks (Verse = 30%, Chorus = 100%), one song.
function setup() {
  const show = emptyShow();
  show.fixtures = [{ id: 'f0', name: 'F0', profile: 'dimmer', universe: 1, address: 1, x: 0.5, y: 0.5 }];
  const e = new Engine(show);
  e.dispatch({ type: 'prog.set', fixtures: ['f0'], values: { dim: 0.3 } });
  e.dispatch({ type: 'look.record', name: 'Verse' });
  e.dispatch({ type: 'prog.set', fixtures: ['f0'], values: { dim: 1 } });
  e.dispatch({ type: 'look.record', name: 'Chorus' });
  e.dispatch({ type: 'song.add', name: 'Song A', sections: ['Verse', 'Chorus', 'Verse 2'] });
  for (const s of e.show.songs[0].sections) e.dispatch({ type: 'section.edit', songId: e.show.songs[0].id, id: s.id, fade: 0 });
  return e;
}
const dim = (e) => e.computeLook().f0.dim;
const midi = (e, ...data) => e.dispatch({ type: 'midi.message', data });

test('sections pick looks by name', () => {
  const e = setup();
  const [v, c, v2] = e.show.songs[0].sections;
  const looks = Object.fromEntries(e.show.looks.map((l) => [l.name, l.id]));
  assert.strictEqual(v.lookId, looks.Verse);
  assert.strictEqual(c.lookId, looks.Chorus);
  assert.strictEqual(v2.lookId, looks.Verse); // "Verse 2" uses "Verse"
  e.dispatch({ type: 'section.add', songId: e.show.songs[0].id, name: 'Chorus' });
  assert.strictEqual(e.show.songs[0].sections[3].name, 'Chorus 2');
});

test('default note map triggers sections in hybrid/auto, not manual', () => {
  const e = setup();
  midi(e, 0x90, 36, 100); // note 36 = section 1
  assert.strictEqual(dim(e), 0.3);
  midi(e, 0x90, 37, 100);
  assert.strictEqual(dim(e), 1);
  assert.strictEqual(e.rt.lastMidi.result, 'Song A · Chorus');
  e.dispatch({ type: 'mode.set', mode: 'manual' });
  midi(e, 0x90, 36, 100);
  assert.strictEqual(dim(e), 1);
  assert.match(e.rt.lastMidi.result, /Manual/);
});

test('note off, clock and velocity-0 notes are ignored and not broadcast', () => {
  const e = setup();
  assert.deepStrictEqual(midi(e, 0xf8), { show: false, runtime: false });
  assert.deepStrictEqual(midi(e, 0x80, 36, 0), { show: false, runtime: false });
  assert.deepStrictEqual(midi(e, 0x90, 36, 0), { show: false, runtime: false });
});

test('auto mode locks operator taps; hybrid allows overrides; hold ignores MIDI', () => {
  const e = setup();
  const song = e.show.songs[0];
  e.dispatch({ type: 'mode.set', mode: 'auto' });
  assert.throws(() => e.dispatch({ type: 'section.go', songId: song.id, id: song.sections[1].id }), /Auto mode/);
  e.dispatch({ type: 'mode.set', mode: 'hybrid' });
  e.dispatch({ type: 'section.go', songId: song.id, id: song.sections[1].id });
  assert.strictEqual(dim(e), 1);
  e.dispatch({ type: 'hold.set', on: true });
  midi(e, 0x90, 36, 100);
  assert.strictEqual(dim(e), 1);
  e.dispatch({ type: 'hold.set', on: false });
  midi(e, 0x90, 36, 100);
  assert.strictEqual(dim(e), 0.3);
});

test('next/previous section for the operator', () => {
  const e = setup();
  const song = e.show.songs[0];
  e.dispatch({ type: 'section.go', songId: song.id, dir: 1 });
  assert.strictEqual(e.rt.sectionId, song.sections[0].id);
  e.dispatch({ type: 'section.go', songId: song.id, dir: 1 });
  assert.strictEqual(e.rt.sectionId, song.sections[1].id);
  e.dispatch({ type: 'section.go', songId: song.id, dir: -1 });
  assert.strictEqual(e.rt.sectionId, song.sections[0].id);
  assert.throws(() => e.dispatch({ type: 'section.go', songId: song.id, dir: -1 }), /start/);
});

test('learned triggers win, and work across songs', () => {
  const e = setup();
  e.dispatch({ type: 'song.add', name: 'Song B', sections: ['Chorus'] });
  const [a, b] = e.show.songs;
  e.dispatch({ type: 'midi.learn', songId: b.id, sectionId: b.sections[0].id });
  midi(e, 0xb1, 20, 127); // CC20 on channel 2
  assert.deepStrictEqual(b.sections[0].trigger, { t: 'cc', ch: 2, n: 20 });
  assert.strictEqual(e.rt.learn, null);
  e.dispatch({ type: 'song.select', id: a.id });
  midi(e, 0x90, 36, 100);
  assert.strictEqual(dim(e), 0.3);
  midi(e, 0xb1, 20, 127); // selects Song B and its chorus
  assert.strictEqual(e.rt.songId, b.id);
  assert.strictEqual(e.computeLook(Date.now() + 1500).f0.dim, 1); // after its 1s fade
});

test('program change selects songs by position, and the channel filter works', () => {
  const e = setup();
  e.dispatch({ type: 'song.add', name: 'Song B', sections: [] });
  midi(e, 0xc0, 1);
  assert.strictEqual(e.rt.songId, e.show.songs[1].id);
  e.dispatch({ type: 'settings.update', settings: { midiChannel: 5 } });
  midi(e, 0xc0, 0);
  assert.strictEqual(e.rt.songId, e.show.songs[1].id);
  midi(e, 0xc4, 0);
  assert.strictEqual(e.rt.songId, e.show.songs[0].id);
});

test('cue list and song looks share the base layer with crossfades', () => {
  const e = setup();
  const song = e.show.songs[0];
  e.dispatch({ type: 'section.edit', songId: song.id, id: song.sections[1].id, fade: 2 });
  midi(e, 0x90, 36, 100);
  midi(e, 0x90, 37, 100);
  const start = e.cueFade.start;
  assert.ok(Math.abs(e.computeLook(start + 1000).f0.dim - 0.65) < 1e-9);
  e.dispatch({ type: 'prog.set', fixtures: ['f0'], values: { dim: 0.5 } });
  e.dispatch({ type: 'cue.record', name: 'Sermon' });
  assert.deepStrictEqual(e.rt.base, { kind: 'cue' });
  assert.strictEqual(dim(e), 0.5);
});

test('song position survives a restart', () => {
  const e = setup();
  midi(e, 0x90, 37, 100);
  const e2 = new Engine(JSON.parse(JSON.stringify(e.show)), JSON.parse(JSON.stringify(e.persistentRuntime())));
  assert.strictEqual(e2.rt.sectionId, e.rt.sectionId);
  assert.strictEqual(e2.computeLook().f0.dim, 1);
});

test('deleting a look unlinks sections', () => {
  const e = setup();
  const chorus = e.show.looks.find((l) => l.name === 'Chorus');
  e.dispatch({ type: 'look.delete', id: chorus.id });
  assert.strictEqual(e.show.songs[0].sections[1].lookId, null);
});

test('song grid, click, count-in and guide cues are saved and checked', () => {
  const e = setup();
  const song = e.show.songs[0];
  assert.deepStrictEqual([song.beatsPerBar, song.downbeat, song.countIn, song.guides, song.jump], [4, 0, 0, false, 'bar']);
  assert.deepStrictEqual(song.click, { on: false, level: -6, out: 1 });
  e.dispatch({ type: 'song.audio', id: song.id, beatsPerBar: 6, downbeat: 0.512, countIn: 9, guides: true, jump: 'now', click: { on: true, level: -12, out: 2 } });
  assert.deepStrictEqual([song.beatsPerBar, song.downbeat, song.countIn, song.guides, song.jump], [6, 0.512, 4, true, 'now']);
  assert.deepStrictEqual(song.click, { on: true, level: -12, out: 2 });
  e.dispatch({ type: 'guide.set', name: 'Pre-Chorus', file: 'audio/abc-prechorus.wav' });
  assert.strictEqual(e.show.guideCues.prechorus, 'audio/abc-prechorus.wav');
  assert.throws(() => e.dispatch({ type: 'guide.set', name: 'chorus', file: '../etc/passwd' }));
  e.dispatch({ type: 'guide.set', name: 'prechorus', file: null });
  assert.deepStrictEqual(e.show.guideCues, {});
});

test('voice stems keep their tone when the key changes; repeat/skip reach the player', () => {
  const e = setup();
  const song = e.show.songs[0];
  e.dispatch({ type: 'stem.add', songId: song.id, file: 'audio/a-lead-vox.wav', name: 'Lead Vox.wav' });
  e.dispatch({ type: 'stem.add', songId: song.id, file: 'audio/a-bass.wav', name: 'Bass.wav' });
  assert.deepStrictEqual(song.stems.map((s) => s.formant), [true, false]);
  e.dispatch({ type: 'stem.edit', songId: song.id, id: song.stems[1].id, formant: true });
  assert.strictEqual(song.stems[1].formant, true);
  for (const cmd of ['repeat', 'skip', 'cancel']) {
    e.dispatch({ type: 'transport', cmd, songId: song.id });
    assert.strictEqual(e.rt.transport.cmd, cmd);
  }
  e.dispatch({ type: 'transport', cmd: 'section', songId: song.id, sectionId: song.sections[1].id, now: true });
  assert.strictEqual(e.rt.transport.now, true);
  assert.throws(() => e.dispatch({ type: 'transport', cmd: 'rewind' }));
});
