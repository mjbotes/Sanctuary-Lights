// Songs tab extras:
// - "✨ Light this song for me": looks for every section, from the rig and the song's colours
// - "+ Demo song": Graves Into Gardens, with a designed arc from the grave to the garden
// - "▶ Preview": steps through the song's sections in time, to see the whole design before Sunday
import { $, S, act, on, toast } from './core.js';

const curSong = () => S.show && S.show.songs.find((x) => x.id === S.runtime.songId);

$('#designSong').addEventListener('click', async () => {
  const song = curSong();
  if (!song) return toast('Pick a song first', true);
  if (!song.sections.length) return toast('Add the song\'s sections first (Intro, Verse, Chorus…)', true);
  const own = song.sections.some((s) => s.lookId && !S.show.looks.some((l) => l.id === s.lookId && l.name.startsWith(`${song.name} · `)));
  if (own && !confirm(`Give every section of "${song.name}" a new look? Your existing looks are kept, but the sections will use the new ones. (Undo works too.)`)) return;
  const r = await act('song.design', { id: song.id });
  if (r) toast(`"${song.name}" is lit: one look per kind of section, in the song's colours (change them with P / S / T). Tweak any look on the Program tab.`);
});

$('#addDemoSong').addEventListener('click', async () => {
  const r = await act('demo.addSong', { id: 'graves-into-gardens' });
  if (r) toast('Added "Graves Into Gardens": tap ▶ Preview to watch it go from the grave to the garden.');
});

// ----- preview ---------------------------------------------------------------------
let preview = null;

function stopPreview(msg) {
  if (!preview) return;
  clearTimeout(preview.timer);
  preview = null;
  $('#previewSong').textContent = '▶ Preview';
  $('#previewSong').classList.remove('on');
  if (msg) toast(msg);
}

// Seconds per section: 4 bars at the song's tempo (4/4), kept between 4 and 12 s
const secondsPer = (song) => Math.max(4, Math.min(12, song.bpm ? (4 * 4 * 60) / song.bpm : 6));

function step() {
  const song = preview && S.show.songs.find((x) => x.id === preview.songId);
  if (!song) return stopPreview();
  if (preview.i >= song.sections.length) return stopPreview('Preview finished');
  const sec = song.sections[preview.i++];
  act('section.go', { songId: song.id, id: sec.id }).then((r) => {
    if (!r) stopPreview();
  });
  preview.timer = setTimeout(step, secondsPer(song) * 1000);
}

$('#previewSong').addEventListener('click', () => {
  if (preview) return stopPreview();
  const song = curSong();
  if (!song || !song.sections.length) return toast('Pick a song with sections first', true);
  if (S.runtime.mode === 'auto' && !S.runtime.hold) return toast('Switch to Hybrid or Manual (or press Hold) to preview', true);
  preview = { songId: song.id, i: 0 };
  $('#previewSong').textContent = '■ Stop preview';
  $('#previewSong').classList.add('on');
  toast(`Previewing "${song.name}": ${Math.round(secondsPer(song))} s per section. Switch to 3D to see the beams.`);
  step();
});

// Stop when another song is picked
on('runtime', () => { if (preview && S.runtime.songId !== preview.songId) stopPreview(); });
