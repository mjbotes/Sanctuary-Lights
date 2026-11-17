// Songs tab: set list, sections, follow modes, looks.
import { $, $$, S, act, ask, fixtures, h, selected, toast } from './core.js';
import { cell } from './cues.js';

// ----- songs tab ------------------------------------------------------------
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (n) => `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 2}`; // Ableton naming: 60 = C3
function trigLabel(t) {
  if (!t) return '';
  if (t.t === 'osc') return `OSC ${t.a}${t.v !== undefined ? ` "${t.v}"` : ''}`;
  if (t.t === 'track') return `Track marker`;
  if (t.t === 'note') return `Note ${noteName(t.n)} (${t.n}) · ch ${t.ch}`;
  if (t.t === 'cc') return `CC ${t.n} · ch ${t.ch}`;
  return `Program ${t.n} · ch ${t.ch}`;
}
const curSong = () => S.show && S.show.songs.find((x) => x.id === S.runtime.songId);
const lookById = (id) => S.show.looks.find((l) => l.id === id);
const QUICK = ['Intro', 'Verse', 'Pre-Chorus', 'Chorus', 'Bridge', 'Instrumental', 'Interlude', 'Tag', 'Turnaround', 'Vamp', 'Outro', 'Ending'];

function renderSongs() {
  const list = $('#songList');
  if (!S.show.songs.length) {
    list.replaceChildren(h('div', { className: 'empty' }, 'No songs yet. Tap "+ Song".'));
  } else {
    list.replaceChildren(
      ...S.show.songs.map((s, n) =>
        h('div', { className: `cuerow songrow${s.id === S.runtime.songId ? ' cur' : ''}`, onclick: () => act('song.select', { id: s.id }) },
          h('span', { className: 'n' }, n + 1), h('span', {}, s.name), h('span', { className: 'f' }, `${s.sections.length} parts`),
          S.editingSong ? h('span', { className: 'row' },
            h('button', { className: 'btn small', onclick: (e) => { e.stopPropagation(); act('song.move', { id: s.id, dir: -1 }); } }, '↑'),
            h('button', { className: 'btn small', onclick: (e) => { e.stopPropagation(); act('song.move', { id: s.id, dir: 1 }); } }, '↓')) : null)
      )
    );
  }
  renderSongEditor();
}

function renderSongLive() {
  if (!S.show) return;
  const song = curSong();
  const rt = S.runtime;
  for (const b of $$('#modeSeg button')) b.classList.toggle('on', b.dataset.mode === rt.mode);
  const hold = $('#holdBtn');
  hold.hidden = rt.mode === 'manual';
  hold.classList.toggle('on', rt.hold);
  hold.textContent = rt.hold ? 'Holding – tap to Resume' : 'Hold';
  for (const r of $$('#songList .songrow')) r.classList.remove('cur');
  const idx = S.show.songs.indexOf(song);
  if (idx >= 0 && $('#songList').children[idx]) $('#songList').children[idx].classList.add('cur');
  $('#songTitle').textContent = song ? song.name : 'Pick a song';
  $('#songNotes').textContent = song && song.notes ? song.notes : '';
  const locked = rt.mode === 'auto' && !rt.hold;
  const pads = $('#sectionPads');
  pads.classList.toggle('locked', locked);
  if (!song) {
    pads.replaceChildren(h('div', { className: 'empty', style: { gridColumn: '1 / -1' } }, 'Choose a song from the set list, or add one.'));
  } else if (!song.sections.length) {
    pads.replaceChildren(h('div', { className: 'empty', style: { gridColumn: '1 / -1' } }, 'This song has no sections yet. Open the editor below and add Intro, Verse, Chorus…'));
  } else {
    const curI = song.sections.findIndex((x) => x.id === rt.sectionId);
    pads.replaceChildren(
      ...song.sections.map((sec, i) => {
        const look = lookById(sec.lookId);
        const pad = h('button', {
          className: `pad${i === curI ? ' cur' : ''}${i === curI + 1 ? ' next' : ''}${look ? '' : ' nolook'}`,
          onclick: () => act('section.go', { songId: song.id, id: sec.id }),
        }, h('b', {}, sec.name), h('small', {}, look ? look.name : 'keeps current lights'), h('small', {}, sec.trigger ? trigLabel(sec.trigger) : ''));
        pad.style.setProperty('--lc', look ? look.color : '#444');
        return pad;
      })
    );
  }
  $('#prevSec').disabled = $('#nextSec').disabled = !song || !song.sections.length || locked;
  // MIDI readout
  const m = rt.lastMidi;
  if (m) {
    const ago = Math.round((Date.now() - m.at) / 1000);
    $('#midiLast').textContent = `Last MIDI: ${trigLabel(m)} → ${m.result}${ago > 1 ? ` (${ago}s ago)` : ''}`;
    if (m.at !== S.lastMidiAt) {
      S.lastMidiAt = m.at;
      const pill = $('#midiPill');
      pill.classList.add('hit');
      setTimeout(() => pill.classList.remove('hit'), 150);
    }
  } else {
    $('#midiLast').textContent = S.midi.available || S.webMidi ? 'Waiting for MIDI from the tracks…' : 'MIDI input is not set up. See the Setup tab.';
  }
  // Learn buttons reflect state
  for (const b of $$('[data-learn]')) {
    const L = rt.learn;
    const on = L && b.dataset.learn === `${L.songId}:${L.sectionId || ''}`;
    b.classList.toggle('learning', !!on);
    b.textContent = on ? 'Send MIDI now… (cancel)' : 'Learn';
  }
}
$('#modeSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-mode]');
  if (b) act('mode.set', { mode: b.dataset.mode });
});
$('#holdBtn').onclick = () => act('hold.set', { on: !S.runtime.hold });
$('#nextSec').onclick = () => curSong() && act('section.go', { songId: curSong().id, dir: 1 });
$('#prevSec').onclick = () => curSong() && act('section.go', { songId: curSong().id, dir: -1 });
$('#addSong').onclick = async () => {
  const name = await ask('Song name');
  if (name === null) return;
  if (await act('song.add', { name })) {
    S.editingSong = true;
    renderSongEditor();
  }
};
$('#editSongBtn').onclick = () => {
  S.editingSong = !S.editingSong;
  renderSongs();
};
$('#quickSections').replaceChildren(
  ...QUICK.map((name) => h('button', { className: 'chip', onclick: () => curSong() && act('section.add', { songId: curSong().id, name }) }, `+ ${name}`)),
  h('button', { className: 'chip add', onclick: async () => {
    if (!curSong()) return;
    const name = await ask('Section name');
    if (name) act('section.add', { songId: curSong().id, name });
  } }, '+ Other…')
);
$('#songName').addEventListener('change', (e) => curSong() && act('song.edit', { id: curSong().id, name: e.target.value }));
$('#songBpm').addEventListener('change', (e) => curSong() && act('song.edit', { id: curSong().id, bpm: e.target.value || null }));
$('#songNoteInput').addEventListener('change', (e) => curSong() && act('song.edit', { id: curSong().id, notes: e.target.value }));
$('#deleteSong').onclick = () => {
  const s = curSong();
  if (s && confirm(`Delete "${s.name}" and its sections? Looks are kept.`)) act('song.delete', { id: s.id });
};

function learnButtons(songId, sectionId, trigger, fallback) {
  const key = `${songId}:${sectionId || ''}`;
  const btn = h('button', { className: 'btn small', onclick: () => {
    const L = S.runtime.learn;
    const on = L && `${L.songId}:${L.sectionId || ''}` === key;
    act('midi.learn', on ? {} : { songId, sectionId });
  } }, 'Learn');
  btn.dataset.learn = key;
  return h('span', { className: 'row trig' },
    trigger ? h('span', { className: 'trigtag' }, trigLabel(trigger)) : fallback ? h('span', { className: 'trigtag def', title: 'Default mapping' }, fallback) : null,
    btn,
    trigger ? h('button', { className: 'btn small', title: 'Forget this trigger', onclick: () => act('midi.forget', { songId, sectionId }) }, '✕') : null);
}

function renderSongEditor() {
  $('#songEditor').hidden = !S.editingSong;
  $('#editSongBtn').textContent = S.editingSong ? 'Hide editor' : 'Show editor';
  const song = curSong();
  if (!S.editingSong) return;
  if (!song) {
    $('#sectionTable').replaceChildren(h('tr', {}, h('td', { colSpan: 5, className: 'hint' }, 'Pick or add a song first.')));
    return;
  }
  if (document.activeElement !== $('#songName')) $('#songName').value = song.name;
  if (document.activeElement !== $('#songNoteInput')) $('#songNoteInput').value = song.notes || '';
  if (document.activeElement !== $('#songBpm')) $('#songBpm').value = song.bpm || '';
  const idx = S.show.songs.indexOf(song);
  const pcDefault = S.show.settings.pcSelectsSong && !S.show.songs.some((x) => x.trigger && x.trigger.t === 'pc') ? `Program ${idx} (default)` : null;
  $('#songTrig').replaceChildren(learnButtons(song.id, null, song.trigger, pcDefault));
  const nb = S.show.settings.noteBase ?? 36;
  const hasLearned = song.sections.some((x) => x.trigger);
  if (!song.sections.length) {
    $('#sectionTable').replaceChildren(h('tr', {}, h('td', { colSpan: 5, className: 'hint' }, 'Tap the buttons above to add sections in the order they happen.')));
  } else {
    $('#sectionTable').replaceChildren(
      ...song.sections.map((sec, i) =>
        h('tr', {},
          cell(h('input', { value: sec.name, onchange: (e) => act('section.edit', { songId: song.id, id: sec.id, name: e.target.value }) })),
          cell(h('select', { onchange: (e) => act('section.edit', { songId: song.id, id: sec.id, lookId: e.target.value }) },
            h('option', { value: '', selected: !sec.lookId }, '— keep current —'),
            ...S.show.looks.map((l) => h('option', { value: l.id, selected: l.id === sec.lookId }, l.name)))),
          cell(h('input', { type: 'number', min: 0, step: 0.5, value: sec.fade, onchange: (e) => act('section.edit', { songId: song.id, id: sec.id, fade: e.target.value }) })),
          h('td', {}, learnButtons(song.id, sec.id, sec.trigger, !hasLearned || !sec.trigger ? `Note ${noteName(nb + i)} (${nb + i})` : null)),
          h('td', { className: 'acts' },
            h('button', { className: 'btn', onclick: () => act('section.move', { songId: song.id, id: sec.id, dir: -1 }) }, '↑'),
            h('button', { className: 'btn', onclick: () => act('section.move', { songId: song.id, id: sec.id, dir: 1 }) }, '↓'),
            h('button', { className: 'btn warn', onclick: () => act('section.delete', { songId: song.id, id: sec.id }) }, '✕'))
        )
      )
    );
  }
  renderSongLive();
}

function renderLooks() {
  const list = $('#lookList');
  if (!S.show.looks.length) {
    list.replaceChildren(h('div', { className: 'empty' }, 'No looks yet. Set up the stage on the Program tab, then tap "+ Record from stage". Name looks after sections, like "Verse" or "Chorus".'));
    return;
  }
  const base = S.runtime.base || {};
  list.replaceChildren(
    ...S.show.looks.map((l) =>
      h('div', { className: `lookrow${base.kind === 'look' && base.lookId === l.id ? ' cur' : ''}` },
        h('span', { className: 'sw', style: { background: l.color, boxShadow: `0 0 8px ${l.color}` } }),
        h('input', { value: l.name, onchange: (e) => act('look.edit', { id: l.id, name: e.target.value }) }),
        h('span', { className: 'acts' },
          h('button', { className: 'btn', title: 'Show this look on stage', onclick: () => act('look.apply', { id: l.id }) }, 'Show'),
          h('button', { className: 'btn', title: 'Replace with what is on stage now', onclick: () => confirm(`Replace "${l.name}" with what is on stage now? Every song using it will change.`) && act('look.update', { id: l.id, fixtures: [...S.sel] }) }, 'Update'),
          h('button', { className: 'btn warn', onclick: () => confirm(`Delete look "${l.name}"? Sections using it will keep the current lights instead.`) && act('look.delete', { id: l.id }) }, '✕')))
    )
  );
}
$('#recLook').onclick = async () => {
  const name = await ask('Name for this look (e.g. "Chorus", "Verse", "Bridge build")');
  if (name !== null && (await act('look.record', { name, fixtures: [...S.sel] }))) toast(`Recorded look "${name}"`);
};

// MIDI settings & the browser bridge
function renderMidiSettings() {
  const m = S.midi;
  const sel = $('#midiInputSelect');
  const cur = S.show.settings.midiInput || '';
  const ports = [...new Set([...(m.ports || []), ...(cur ? [cur] : [])])];
  sel.replaceChildren(h('option', { value: '' }, 'All MIDI inputs'), ...ports.map((p) => h('option', { value: p, selected: p === cur }, p)));
  const chSel = $('#midiChannelSelect');
  if (!chSel.options.length) chSel.replaceChildren(h('option', { value: 0 }, 'Any'), ...Array.from({ length: 16 }, (_, i) => h('option', { value: i + 1 }, `Channel ${i + 1}`)));
  chSel.value = String(S.show.settings.midiChannel || 0);
  $('#noteBaseName').textContent = noteName(S.show.settings.noteBase ?? 36);
  const outSel = $('#midiOutputSelect');
  const curOut = S.show.settings.midiOutput || '';
  outSel.replaceChildren(h('option', { value: '' }, 'Off'), ...[...new Set([...(m.outputs || []), ...(curOut ? [curOut] : [])])].map((p) => h('option', { value: p, selected: p === curOut }, p)));
  $('#midiStatus').textContent = m.available
    ? m.ports.length ? `MIDI inputs found: ${m.ports.join(', ')}` : 'No MIDI inputs found yet. Turn on the IAC Driver or a Network session in Audio MIDI Setup.'
    : `${m.error || 'MIDI is not available on the lighting computer.'}${S.webMidi ? ' Using this browser\'s MIDI instead.' : ''}`;
}
let webMidiAccess = null;
async function startWebMidi(on) {
  S.webMidi = false;
  if (webMidiAccess) for (const input of webMidiAccess.inputs.values()) input.onmidimessage = null;
  if (!on) return;
  if (!navigator.requestMIDIAccess) {
    toast('This browser has no MIDI support. Use Chrome or Edge on the lighting Mac.', true);
    $('#webMidi').checked = false;
    return;
  }
  try {
    webMidiAccess = await navigator.requestMIDIAccess();
    const hook = () => {
      for (const input of webMidiAccess.inputs.values()) {
        input.onmidimessage = (ev) => {
          const d = [...ev.data];
          const k = d[0] & 0xf0;
          if (k === 0x90 && d[2] > 0 || k === 0xb0 && d[2] > 0 || k === 0xc0) act('midi.message', { data: d });
        };
      }
    };
    hook();
    webMidiAccess.onstatechange = hook;
    S.webMidi = true;
    toast(`Browser MIDI on (${webMidiAccess.inputs.size} input${webMidiAccess.inputs.size === 1 ? '' : 's'})`);
  } catch {
    toast('MIDI permission was refused', true);
    $('#webMidi').checked = false;
  }
}
$('#webMidi').addEventListener('change', (e) => {
  try { localStorage.setItem('webMidi', e.target.checked ? '1' : ''); } catch {}
  startWebMidi(e.target.checked);
});
setInterval(() => S.tab === 'songs' && S.runtime.lastMidi && renderSongLive(), 1000);

export { NOTE_NAMES, noteName, trigLabel, curSong, lookById, QUICK, renderSongs, renderSongLive, learnButtons, renderSongEditor, renderLooks, renderMidiSettings, webMidiAccess, startWebMidi };
