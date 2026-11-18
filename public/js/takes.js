// Songs tab: live takes. Record what you do live during a song in rehearsal (group faders, colours,
// effects, flashes, pads, strobe) and it plays back the same way when the song plays.
import { $, S, act, h, on, toast } from './core.js';

const curSong = () => S.show && S.show.songs.find((x) => x.id === S.runtime.songId);

function render() {
  const box = $('#takeBox');
  if (!box || !S.show) return;
  const song = curSong();
  const rec = S.runtime.recording;
  if (!song) return box.replaceChildren();
  if (rec && rec.songId === song.id) {
    box.replaceChildren(
      h('span', { className: 'take-rec' }, '● REC'),
      h('span', { className: 'hint', style: { margin: 0 } }, rec.waiting && !rec.count ? 'Waiting for the song to play (Tracks tab, or timecode)…' : `${rec.count || 0} live moves recorded`),
      h('button', { className: 'btn small primary', onclick: () => act('take.record', { on: false, save: true }).then((r) => r && toast(r.saved ? `Live take saved: ${r.events} moves. It plays back whenever this song plays.` : 'Nothing was recorded')) }, '■ Stop & save'),
      h('button', { className: 'btn small', onclick: () => act('take.record', { on: false, save: false }) }, 'Discard'));
    return;
  }
  const t = song.take;
  box.replaceChildren(
    h('button', { className: 'btn small', title: 'Record what you do live (faders, colours, effects, flashes, pads) against this song\'s tracks or timecode, to play back the same way next time', onclick: () => {
      if (t && !confirm('Record a new live take? It replaces the one this song has.')) return;
      act('take.record', { on: true }).then((r) => r && toast('Recording: play the song and busk. Your live moves are recorded against the music.'));
    } }, '● Record live take'),
    t ? h('label', { className: 'check plain', title: 'Play the live take back when this song plays' },
      h('input', { type: 'checkbox', checked: t.on, onchange: (e) => act('take.set', { songId: song.id, on: e.target.checked }) }), ` Live take (${t.events.length} moves)`) : '',
    t ? h('button', { className: 'btn small warn', title: 'Delete the live take', onclick: () => confirm('Delete this song\'s live take?') && act('take.delete', { songId: song.id }) }, '×') : '');
}

on('state', render);
on('runtime', render);
