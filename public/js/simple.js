// Volunteer screen: the few buttons needed to run a service, big and hard to get wrong.
// Shown to volunteers (PIN) and available to everyone as the "Volunteer" tab.
import { $, S, act, h, on } from './core.js';

const ph = () => S.runtime.playhead;

function render() {
  if (!S.show) return;
  const box = $('#simpleBox');
  const rt = S.runtime;
  const song = S.show.songs.find((x) => x.id === rt.songId);
  const cues = S.show.cues;
  const songSel = h('select', { className: 'simple-song', onchange: (e) => e.target.value && act('song.select', { id: e.target.value }) },
    h('option', { value: '' }, S.show.songs.length ? 'Pick a song…' : 'No songs'),
    ...S.show.songs.map((s) => h('option', { value: s.id, selected: s.id === rt.songId }, s.name)));

  const parts = [];
  if (song && song.sections.length) {
    const i = song.sections.findIndex((x) => x.id === rt.sectionId);
    const next = song.sections[i + 1];
    parts.push(
      h('div', { className: 'simple-now' }, h('small', {}, 'Now'), h('b', {}, i >= 0 ? song.sections[i].name : '—'), h('small', {}, next ? `Next: ${next.name}` : 'End of song')),
      h('div', { className: 'simple-go' },
        h('button', { className: 'btn big', onclick: () => act('section.go', { songId: song.id, dir: -1 }) }, '◀'),
        h('button', { className: 'btn go', disabled: !next, onclick: () => act('section.go', { songId: song.id, dir: 1 }) }, next ? `NEXT: ${next.name}` : 'END')),
      h('div', { className: 'simple-secs' }, ...song.sections.map((sec, n) => h('button', { className: `btn${n === i ? ' on' : ''}`, onclick: () => act('section.go', { songId: song.id, id: sec.id }) }, sec.name))));
  } else if (cues.length) {
    const i = rt.cueIndex;
    parts.push(
      h('div', { className: 'simple-now' }, h('small', {}, 'Now'), h('b', {}, cues[i] ? cues[i].name : 'Not started'), h('small', {}, cues[i + 1] ? `Next: ${cues[i + 1].name}` : 'End of list')),
      h('div', { className: 'simple-go' },
        h('button', { className: 'btn big', onclick: () => act('cue.back') }, '◀'),
        h('button', { className: 'btn go', disabled: !cues[i + 1], onclick: () => act('cue.go') }, 'GO')));
  } else parts.push(h('p', { className: 'hint' }, 'Nothing programmed yet.'));

  // Backing tracks: play / stop (only when a computer plays the audio)
  if (rt.audioHost && song && song.stems.length) {
    const playing = ph() && ph().songId === song.id && ph().playing;
    parts.push(h('div', { className: 'simple-row' },
      h('button', { className: `btn big${playing ? ' warn' : ' primary'}`, onclick: () => act('transport', { cmd: playing ? 'stop' : 'play' }) }, playing ? '■ Stop tracks' : '▶ Play tracks')));
  }
  if (S.show.scenes.length) {
    parts.push(h('div', { className: 'label' }, 'Scenes'),
      h('div', { className: 'simple-scenes' }, ...S.show.scenes.map((sc) => {
        const lvl = (rt.sceneLevels || {})[sc.id] || 0;
        const b = h('button', { className: `btn${lvl > 0 ? ' on' : ''}`, onclick: () => act('scene.toggle', { id: sc.id }) }, sc.name);
        b.style.setProperty('--sc', sc.color);
        return b;
      })));
  }
  if (S.show.pads.length) {
    parts.push(h('div', { className: 'label' }, 'Effects'),
      h('div', { className: 'simple-pads' }, ...S.show.pads.slice(0, 12).map((p) => {
        const b = h('button', { className: `btn${(rt.padsOn || {})[p.id] ? ' on' : ''}` }, p.name);
        b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.setPointerCapture(e.pointerId); act('pad.press', { id: p.id, down: true }); });
        b.addEventListener('pointerup', () => act('pad.press', { id: p.id, down: false }));
        return b;
      })));
  }
  box.replaceChildren(h('div', { className: 'simple-top' }, songSel), ...parts);
}

on('state', render);
on('runtime', render);

export { render as renderSimple };
