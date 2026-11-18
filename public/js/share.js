// Share a song's lighting design as a file: Export song… (song editor) / Import song… (set list).
import { $, S, act, toast } from './core.js';

$('#exportSong').addEventListener('click', async () => {
  const song = S.show.songs.find((x) => x.id === S.runtime.songId);
  if (!song) return toast('Pick a song first', true);
  const r = await act('song.export', { id: song.id });
  if (!r || !r.file) return;
  const blob = new Blob([JSON.stringify(r.file, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${song.name.replace(/[^\w\- ]+/g, '').trim() || 'song'}.slsong.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(`"${song.name}" saved as a file. Another church can import it with "Import song…".`);
});

$('#importSongFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    return toast('That file could not be read', true);
  }
  const r = await act('song.importFile', { file: data });
  if (r) toast(r.mode === 'exact'
    ? `"${r.song}" imported with its exact looks (your lights have the same names).`
    : `"${r.song}" imported: its design was rebuilt on your lights. Check the looks, and tweak them on the Program tab.`);
});
