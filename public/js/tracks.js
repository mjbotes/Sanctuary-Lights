// Tracks tab: backing tracks, key/tempo, mixer, vocal chain.
import { AudioEngine } from '../audio/engine.js';
import { $, $$, S, act, actThrottled, h, selected, toast, authHeaders } from './core.js';
import { bindFader } from './live.js';
import { upload } from './view3d.js';

// ----- Tracks: backing tracks, key/tempo, vocal ------------------------------------
const KEY_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const fmtTime = (t) => { t = Math.max(0, t || 0); return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`; };
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
S.clientId = lsGet('clientId') || Math.random().toString(36).slice(2, 10);
lsSet('clientId', S.clientId);
S.tk = { status: null, tuner: null, outputs: null, lastSeq: null, sig: '', loading: null };
let audio = null;

const isHost = () => !!audio && S.runtime.audioHost && S.runtime.audioHost.id === S.clientId;
const songKeyNow = (song) => (song && song.key !== null && song.key !== undefined ? (((song.key + (song.transpose || 0)) % 12) + 12) % 12 : null);
const keyLabel = (k, minor) => (k === null ? '—' : `${KEY_NAMES[k]}${minor ? 'm' : ''}`);
const tempoOf = (song) => (song && song.targetBpm && song.bpm ? song.targetBpm / song.bpm : 1);

async function becomeHost(on) {
  if (on) {
    try {
      if (!audio) {
        audio = new AudioEngine({
          onStatus: (st) => { S.tk.status = st; renderTkStatus(); report(); },
          onPlayState: (playing, pos) => {
            report(true);
            if (playing && audio.song) {
              const m = audio.sectionAt(pos);
              if (m) act('tracks.marker', { songId: audio.song.id, sectionId: m.sectionId });
            }
          },
          onMarker: (sectionId) => audio.song && act('tracks.marker', { songId: audio.song.id, sectionId }),
          onTuner: (info) => { S.tk.tuner = info; renderTuner(); },
          onOutputs: (pairs) => { S.tk.outputs = pairs; renderMixer(); },
        });
        await audio.init();
        const dev = lsGet('audioOut');
        if (dev) audio.setOutputDevice(dev).catch(() => {});
      }
      if (audio.ctx.state === 'suspended') await audio.ctx.resume();
      lsSet('audioHost', '1');
      await act('audio.host', { id: S.clientId, on: true, name: navigator.platform && /Mac/.test(navigator.platform) ? 'Mac' : 'this computer' });
      S.tk.lastSeq = S.runtime.transport ? S.runtime.transport.seq : 0;
      syncHost();
    } catch (e) {
      console.error(e);
      toast(`Audio could not start: ${e.message}`, true);
    }
  } else {
    lsSet('audioHost', '');
    if (audio) { audio.stop(); audio.stopVocal(); }
    act('audio.host', { id: S.clientId, on: false });
  }
}

let lastReport = 0;
function report(force) {
  if (!isHost()) return;
  const now = Date.now();
  if (!force && now - lastReport < 450) return;
  lastReport = now;
  const st = S.tk.status || {};
  act('transport.report', { songId: audio.song ? audio.song.id : null, pos: audio.position(), dur: audio.duration || 0, playing: audio.playing, looping: !!audio.loop, ready: !!st.ready, status: st.preparing ? `${st.text || 'Preparing'} ${Math.round((st.progress || 0) * 100)}%` : st.text || '' });
}
setInterval(() => { if (isHost() && audio.playing) report(); }, 500);

// The playing computer follows the shared state: song, key/tempo, mix, transport and vocal settings.
async function syncHost() {
  if (!isHost() || !S.show) return;
  const song = S.show.songs.find((x) => x.id === S.runtime.songId);
  if (song) {
    const sig = JSON.stringify([song.id, song.stems.map((x) => [x.id, x.file, x.keepPitch]), song.transpose, song.targetBpm, song.bpm]);
    if (sig !== S.tk.sig) {
      S.tk.sig = sig;
      const load = audio.load(song).catch((e) => { if (e.message !== 'cancelled') toast(e.message, true); });
      S.tk.loading = load;
    } else if (audio.song && audio.song.id === song.id) {
      audio.song = song;
      audio.applyMix(song);
    }
  }
  if (audio.vocal || S.runtime.vocal.on) {
    if (S.runtime.vocal.on && !audio.vocal) {
      audio.startVocal(lsGet('vxIn') || '', Number(lsGet('vxCh') || 0)).then(() => { renderVocal(); syncHost(); }).catch((e) => toast(`Mic: ${e.message}`, true));
    }
    audio.setVocal(S.runtime.vocal, songKeyNow(song), song ? song.minor : false, S.runtime.bpm);
  }
  const t = S.runtime.transport;
  if (t && t.seq !== S.tk.lastSeq) {
    S.tk.lastSeq = t.seq;
    if (S.tk.loading) await S.tk.loading;
    if (!audio.song || audio.song.id !== t.songId) return;
    const markerOf = (sid) => audio.markerTimes().find((m) => m.sectionId === sid);
    if (t.cmd === 'play') audio.play(t.pos ?? undefined);
    else if (t.cmd === 'stop') audio.stop();
    else if (t.cmd === 'seek') audio.seek(t.pos || 0);
    else if (t.cmd === 'section') {
      const m = markerOf(t.sectionId);
      if (m) { audio.seek(m.t); act('tracks.marker', { songId: audio.song.id, sectionId: m.sectionId }); }
    } else if (t.cmd === 'loop') {
      const pos = audio.position();
      const ms = audio.markerTimes();
      const cur = audio.sectionAt(pos);
      const start = cur ? cur.t : 0;
      const next = ms.find((m) => m.t > start + 0.05);
      audio.setLoop({ start, end: next ? next.t : audio.duration });
    } else if (t.cmd === 'unloop') audio.setLoop(null);
    report(true);
  }
}

function renderTracks() {
  if (!S.show) return;
  const songs = S.show.songs;
  $('#tkSongs').replaceChildren(...(songs.length ? songs.map((s, n) => h('div', { className: `cuerow songrow${s.id === S.runtime.songId ? ' cur' : ''}`, onclick: () => act('song.select', { id: s.id }) },
    h('span', { className: 'n' }, n + 1), h('span', {}, s.name),
    h('span', { className: 'f' }, `${keyLabel(songKeyNow(s), s.minor)}${s.stems.length ? ` · ${s.stems.length} trk` : ''}`)))
    : [h('div', { className: 'empty' }, 'Add songs on the Songs tab.')]));
  renderKeyBox();
  renderMixer();
  renderVocal();
  tracksRuntime();
}

function renderHostBox() {
  const host = S.runtime.audioHost;
  const me = isHost();
  const box = $('#hostBox');
  const sig = JSON.stringify([host, me, audio && audio.channels]);
  if (sig === box.dataset.sig) return;
  box.dataset.sig = sig;
  const outSel = h('select', { onchange: (e) => { lsSet('audioOut', e.target.value); audio && audio.setOutputDevice(e.target.value).then(() => toast('Output changed')).catch((err) => toast(err.message, true)); } }, h('option', { value: '' }, 'System default output'));
  if (me && navigator.mediaDevices) navigator.mediaDevices.enumerateDevices().then((list) => {
    for (const d of list.filter((x) => x.kind === 'audiooutput' && x.deviceId !== 'default')) outSel.append(h('option', { value: d.deviceId, selected: d.deviceId === lsGet('audioOut') }, d.label || 'Output'));
  }).catch(() => {});
  box.replaceChildren(
    h('label', { className: 'check plain', style: { display: 'flex', gap: '8px', alignItems: 'center' } },
      h('input', { type: 'checkbox', checked: me, onchange: (e) => becomeHost(e.target.checked) }), h('span', {}, 'This computer plays the audio')),
    me ? h('div', {}, h('span', { className: 'on' }, '● Audio engine running'), ` · ${audio.channels} output channels`) :
      host ? h('div', { className: 'hint', style: { margin: 0 } }, `Audio plays on ${host.name}. This screen is a remote.`) :
        h('div', { className: 'hint', style: { margin: 0 } }, 'No computer is playing audio. Tick the box on the computer connected to the sound desk.'),
    me ? outSel : null);
}

function renderKeyBox() {
  const song = S.show.songs.find((x) => x.id === S.runtime.songId);
  $('#tkTitle').textContent = song ? song.name : 'Pick a song';
  const box = $('#tkKey');
  if (!song) return box.replaceChildren();
  const keySel = h('select', { title: 'Key the tracks were recorded in', onchange: (e) => act('song.audio', { id: song.id, key: e.target.value === '' ? null : Number(e.target.value) }) },
    h('option', { value: '' }, 'Key?'), ...KEY_NAMES.map((k, i) => h('option', { value: i, selected: song.key === i }, k)));
  const minorSel = h('select', { onchange: (e) => act('song.audio', { id: song.id, minor: e.target.value === '1' }) }, h('option', { value: '0', selected: !song.minor }, 'major'), h('option', { value: '1', selected: song.minor }, 'minor'));
  const tr = song.transpose || 0;
  const bpmIn = h('input', { type: 'number', min: 30, max: 300, value: song.bpm || '', placeholder: 'BPM', title: 'Tempo the tracks were recorded at', onchange: (e) => act('song.edit', { id: song.id, bpm: e.target.value || null }) });
  const target = song.targetBpm || song.bpm || null;
  const pc = h('input', { type: 'number', min: 0, max: 127, value: song.midiOut ? song.midiOut.pc : '', placeholder: '—', style: { width: '56px' }, onchange: (e) => act('song.audio', { id: song.id, midiOut: e.target.value === '' ? null : { pc: e.target.value, ch: song.midiOut ? song.midiOut.ch : 1 } }) });
  const ch = h('input', { type: 'number', min: 1, max: 16, value: song.midiOut ? song.midiOut.ch : 1, style: { width: '46px' }, onchange: (e) => song.midiOut && act('song.audio', { id: song.id, midiOut: { pc: song.midiOut.pc, ch: e.target.value } }) });
  box.replaceChildren(
    h('span', { className: 'lbl' }, 'Recorded in'), h('div', { className: 'row' }, keySel, minorSel, bpmIn),
    h('span', { className: 'lbl' }, 'Plays in'),
    h('div', { className: 'keyctl' },
      h('button', { className: 'btn', title: 'Down a semitone', onclick: () => act('song.audio', { id: song.id, transpose: tr - 1 }) }, '−'),
      h('b', { className: tr ? 'changed' : '' }, song.key === null ? `${tr > 0 ? '+' : ''}${tr} st` : `${keyLabel(songKeyNow(song), song.minor)}${tr ? ` (${tr > 0 ? '+' : ''}${tr})` : ''}`),
      h('button', { className: 'btn', title: 'Up a semitone', onclick: () => act('song.audio', { id: song.id, transpose: tr + 1 }) }, '+'),
      tr ? h('button', { className: 'btn small', onclick: () => act('song.audio', { id: song.id, transpose: 0 }) }, 'Original') : null),
    h('span', { className: 'lbl' }, 'Tempo'),
    h('div', { className: 'keyctl' },
      h('button', { className: 'btn', disabled: !song.bpm, onclick: () => act('song.audio', { id: song.id, targetBpm: (target || 120) - 1 }) }, '−'),
      h('b', { className: song.targetBpm && song.targetBpm !== song.bpm ? 'changed' : '' }, target ? `${target} BPM` : 'Set BPM'),
      h('button', { className: 'btn', disabled: !song.bpm, onclick: () => act('song.audio', { id: song.id, targetBpm: (target || 120) + 1 }) }, '+'),
      song.targetBpm && song.targetBpm !== song.bpm ? h('button', { className: 'btn small', onclick: () => act('song.audio', { id: song.id, targetBpm: null }) }, 'Original') : null),
    h('span', { className: 'lbl', title: 'Program change sent to other apps (SuperRack, Ableton, MainStage) when this song is picked. Choose the MIDI output in Setup.' }, 'MIDI out PC'),
    h('div', { className: 'row' }, pc, h('span', { className: 'lbl' }, 'ch'), ch));
}

function renderTkStatus() {
  const ph = S.runtime.playhead;
  const st = isHost() ? S.tk.status : null;
  const song = S.show && S.show.songs.find((x) => x.id === S.runtime.songId);
  let text = '';
  if (st && st.songId === S.runtime.songId) text = st.preparing ? `${st.text || 'Preparing'} ${Math.round((st.progress || 0) * 100)}%` : st.text || '';
  else if (ph && ph.songId === S.runtime.songId) text = ph.status;
  if (song && !song.stems.length) text = 'No tracks yet: add stems below (WAV or MP3, all starting at the same time).';
  $('#tkStatus').textContent = text;
}

function playState() {
  if (isHost()) return { pos: audio.position(), dur: audio.duration || 0, playing: audio.playing, looping: !!audio.loop };
  const ph = S.runtime.playhead;
  if (!ph || ph.songId !== S.runtime.songId) return { pos: 0, dur: 0, playing: false, looping: false };
  const pos = ph.playing ? ph.pos + (Date.now() - ph.at) / 1000 : ph.pos;
  return { pos, dur: ph.dur, playing: ph.playing, looping: ph.looping };
}

function tracksRuntime() {
  if (!S.show) return;
  renderHostBox();
  renderTkStatus();
  if (isHost()) syncHost();
  if (S.tk.shownSong !== S.runtime.songId) {
    S.tk.shownSong = S.runtime.songId;
    renderKeyBox();
    renderMixer();
  }
  renderVocal();
  const song = S.show.songs.find((x) => x.id === S.runtime.songId);
  for (const r of $$('#tkSongs .songrow')) r.classList.remove('cur');
  const i = S.show.songs.indexOf(song);
  if (i >= 0 && $('#tkSongs').children[i]) $('#tkSongs').children[i].classList.add('cur');
  // Section buttons
  const sb = $('#tkSections');
  if (!song) return sb.replaceChildren();
  const tempo = tempoOf(song);
  sb.replaceChildren(...song.sections.map((sec) => {
    const m = song.markers.find((x) => x.sectionId === sec.id);
    return h('div', { className: `tk-sec${sec.id === S.runtime.sectionId ? ' cur' : ''}${m ? '' : ' nomark'}` },
      h('button', { className: 'go', title: m ? 'Jump here' : 'No marker yet: play to the start of this part and tap ⌖', onclick: () => m ? act('transport', { cmd: 'section', sectionId: sec.id }) : toast('Set this marker first: play to where it starts, then tap ⌖', true) },
        sec.name, ' ', h('span', { className: 't' }, m ? fmtTime(m.time / tempo) : '')),
      h('button', { className: 'mk', title: 'Set the marker to the current position', onclick: () => act('marker.set', { songId: song.id, sectionId: sec.id, time: playState().pos * tempo }) }, '⌖'),
      m ? h('button', { className: 'mk', title: 'Remove marker', onclick: () => act('marker.set', { songId: song.id, sectionId: sec.id, time: null }) }, '×') : null);
  }), song.sections.length ? '' : h('span', { className: 'hint', style: { margin: 0 } }, 'Add sections to this song on the Songs tab, then place their markers here. Markers change the lights automatically as the tracks play.'));
}

$('#tkPlay').onclick = () => {
  const ps = playState();
  act('transport', { cmd: ps.playing ? 'stop' : 'play' });
};
$('#tkStart').onclick = () => act('transport', { cmd: 'seek', pos: 0 });
$('#tkLoop').onclick = () => act('transport', { cmd: playState().looping ? 'unloop' : 'loop' });
$('#tkPrepareAll').onclick = async () => {
  if (!isHost()) return toast('Only the computer playing the audio can prepare the set', true);
  const list = S.show.songs.filter((x) => x.stems.length);
  for (let i = 0; i < list.length; i++) {
    toast(`Preparing ${i + 1}/${list.length}: ${list[i].name}…`);
    try { await audio.prepare(list[i], { background: true }); } catch (e) { toast(`${list[i].name}: ${e.message}`, true); }
  }
  toast('Set ready: every song is prepared at its key and tempo');
};
$('#tkWave').addEventListener('pointerdown', (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  const { dur } = playState();
  if (dur) act('transport', { cmd: 'seek', pos: ((e.clientX - r.left) / r.width) * dur });
});
$('#tkFiles').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  const song = S.show.songs.find((x) => x.id === S.runtime.songId);
  if (!song) return toast('Pick a song first', true);
  for (const [i, file] of files.entries()) {
    toast(`Uploading ${i + 1}/${files.length}: ${file.name}`);
    try {
      const r = await fetch(`/api/upload/audio?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file, headers: authHeaders() });
      const j = await r.json();
      if (!j.ok) { toast(j.error, true); continue; }
      await act('stem.add', { songId: song.id, file: j.file, name: file.name });
    } catch { toast(`Upload failed: ${file.name}`, true); }
  }
  toast(`${files.length} track${files.length === 1 ? '' : 's'} added`);
});

// Timeline drawing + meters (animation loop)
(() => {
  const draw = () => {
    requestAnimationFrame(draw);
    if (S.tab !== 'tracks' || !S.show) return;
    const c = $('#tkWave');
    const W = (c.width = c.clientWidth * (window.devicePixelRatio || 1));
    const H = (c.height = 110 * (window.devicePixelRatio || 1));
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    const song = S.show.songs.find((x) => x.id === S.runtime.songId);
    const ps = playState();
    $('#tkTime').textContent = `${fmtTime(ps.pos)} / ${fmtTime(ps.dur)}`;
    $('#tkPlay').textContent = ps.playing ? '■ Stop' : '▶ Play';
    $('#tkPlay').classList.toggle('playing', ps.playing);
    $('#tkLoop').classList.toggle('on', ps.looping);
    if (!song || !ps.dur) return;
    const peaks = isHost() && audio.song && audio.song.id === song.id ? audio.peaks : null;
    ctx.fillStyle = '#2a3346';
    if (peaks) {
      const bw = W / peaks.length;
      for (let i = 0; i < peaks.length; i++) {
        const v = Math.min(1, peaks[i]) * (H * 0.42);
        ctx.fillRect(i * bw, H / 2 - v, Math.max(1, bw), v * 2);
      }
    } else ctx.fillRect(0, H / 2 - 1, W, 2);
    if (audio && isHost() && audio.loop) {
      ctx.fillStyle = 'rgba(242,179,61,.15)';
      ctx.fillRect((audio.loop.start / ps.dur) * W, 0, ((audio.loop.end - audio.loop.start) / ps.dur) * W, H);
    }
    const tempo = tempoOf(song);
    ctx.font = `${11 * (window.devicePixelRatio || 1)}px sans-serif`;
    for (const m of song.markers) {
      const sec = song.sections.find((x) => x.id === m.sectionId);
      const x = ((m.time / tempo) / ps.dur) * W;
      ctx.fillStyle = sec && sec.id === S.runtime.sectionId ? '#3fd27a' : '#8b93a5';
      ctx.fillRect(x, 0, 2, H);
      ctx.fillText(sec ? sec.name : '?', x + 4, 12 * (window.devicePixelRatio || 1));
    }
    ctx.fillStyle = '#f2b33d';
    ctx.fillRect((ps.pos / ps.dur) * W - 1, 0, 3, H);
    if (isHost()) {
      const lv = audio.meterLevels();
      for (const strip of $$('#tkMixer .strip')) {
        const m = strip.querySelector('.meter i');
        if (m) m.style.height = `${Math.min(100, (lv[strip.dataset.id] || 0) * 100)}%`;
      }
      const vl = $('#vxLevel');
      if (vl) vl.style.width = `${Math.min(100, (lv.vocal || 0) * 140)}%`;
    }
  };
  requestAnimationFrame(draw);
})();

const faderToDb = (v) => (v <= 0 ? -60 : 6 + 40 * Math.log10(v / 1000)) ; // 1000 -> +6 dB, ~560 -> -4, ~100 -> -34
const dbToFader = (db) => (db <= -60 ? 0 : Math.round(1000 * Math.pow(10, (db - 6) / 40)));
function renderMixer() {
  const song = S.show && S.show.songs.find((x) => x.id === S.runtime.songId);
  const box = $('#tkMixer');
  if (!song) return box.replaceChildren();
  if (box.contains(document.activeElement) && document.activeElement.matches('input:not([type=range])')) return;
  if ([...box.querySelectorAll('input[type=range]')].some((x) => x.dragging)) return;
  const pairs = S.tk.outputs || [{ value: 0, label: 'Main 1-2' }, { value: 1, label: '3-4' }, { value: 2, label: '5-6' }, { value: 3, label: '7-8' }];
  if (!song.stems.length) return box.replaceChildren(h('div', { className: 'empty', style: { flex: 1 } }, 'No tracks. Tap "+ Add tracks…" and choose all the stems of this song (click, guide, drums, bass, keys, pads…). They play together from the start.'));
  box.replaceChildren(...song.stems.map((st) => {
    const fader = h('input', { type: 'range', min: 0, max: 1000, value: dbToFader(st.gain || 0), 'aria-label': `${st.name} level` });
    const db = h('div', { className: 'db' }, `${(st.gain || 0).toFixed(1)} dB`);
    bindFader(fader, (v) => {
      const g = Math.round(faderToDb(v * 1000) * 10) / 10;
      db.textContent = `${g.toFixed(1)} dB`;
      actThrottled(`stem-${st.id}`, 'stem.edit', { songId: song.id, id: st.id, gain: g });
    });
    fader.addEventListener('dblclick', () => act('stem.edit', { songId: song.id, id: st.id, gain: 0 }));
    const pan = h('input', { type: 'range', className: 'pan', min: -100, max: 100, value: Math.round((st.pan || 0) * 100), title: 'Pan (double-click to centre)' });
    bindFader(pan, () => actThrottled(`pan-${st.id}`, 'stem.edit', { songId: song.id, id: st.id, pan: pan.value / 100 }));
    pan.addEventListener('dblclick', () => act('stem.edit', { songId: song.id, id: st.id, pan: 0 }));
    const strip = h('div', { className: 'strip' },
      h('input', { className: 'nm', value: st.name, onchange: (e) => act('stem.edit', { songId: song.id, id: st.id, name: e.target.value }) }),
      h('div', { className: 'fader' }, fader, h('div', { className: 'meter' }, h('i'))),
      db,
      h('div', { className: 'ms' },
        h('button', { className: `btn m${st.mute ? ' on' : ''}`, onclick: () => act('stem.edit', { songId: song.id, id: st.id, mute: !st.mute }) }, 'M'),
        h('button', { className: `btn s${st.solo ? ' on' : ''}`, onclick: () => act('stem.edit', { songId: song.id, id: st.id, solo: !st.solo }) }, 'S')),
      pan,
      h('select', { title: 'Output', onchange: (e) => act('stem.edit', { songId: song.id, id: st.id, out: Number(e.target.value) }) },
        ...pairs.map((p) => h('option', { value: p.value, selected: p.value === (st.out || 0) }, p.label))),
      h('label', { title: 'Untick for click tracks: they follow the tempo but keep their pitch' },
        h('input', { type: 'checkbox', checked: !st.keepPitch, onchange: (e) => act('stem.edit', { songId: song.id, id: st.id, keepPitch: !e.target.checked }) }), 'Follows key'),
      h('button', { className: 'btn small warn', onclick: () => confirm(`Remove "${st.name}" from this song?`) && act('stem.delete', { songId: song.id, id: st.id }) }, 'Remove'));
    strip.dataset.id = st.id;
    return strip;
  }));
}

function renderTuner() {
  const t = S.tk.tuner;
  const b = $('#vxNote');
  if (!b || !t) return;
  b.textContent = t.note === null || t.note === undefined || !t.freq ? '—' : `${KEY_NAMES[((t.note % 12) + 12) % 12]}${Math.floor(t.note / 12) - 1}`;
  $('#vxCents').style.left = `calc(${50 + Math.max(-50, Math.min(50, t.cents))}% - 2px)`;
  $('#vxFreq').textContent = t.freq ? `${t.freq.toFixed(1)} Hz · correcting ${t.cents > 0 ? '+' : ''}${t.cents}¢` : 'no pitch';
  $('#vxLatency').textContent = t.latencyMs ? `auto-tune latency ${t.latencyMs.toFixed(0)} ms` : '';
}

function renderVocal() {
  const box = $('#vxBox');
  if (!S.show || (box.contains(document.activeElement) && document.activeElement.tagName === 'SELECT')) return;
  if ([...box.querySelectorAll('input[type=range]')].some((x) => x.dragging)) return;
  const v = S.runtime.vocal;
  const song = S.show.songs.find((x) => x.id === S.runtime.songId);
  const sig = JSON.stringify([v, song && [song.id, song.key, song.minor, song.transpose, !!song.vocal], isHost()]);
  if (sig === box.dataset.sig) return renderTuner();
  box.dataset.sig = sig;
  const set = (patch) => actThrottled('vx', 'vocal.set', { vocal: patch });
  const slider = (label, val, min, max, step, onv, fmt) => {
    const i = h('input', { type: 'range', min, max, step, value: val });
    const o = h('b', {}, fmt(val));
    bindFader(i, () => { o.textContent = fmt(Number(i.value)); onv(Number(i.value)); });
    return h('div', { className: 'mini' }, h('span', {}, label), i, o);
  };
  const key = songKeyNow(song);
  const scaleName = v.autotune.scale === 'song' ? (key === null ? 'chromatic (song has no key)' : `${KEY_NAMES[key]} ${song.minor ? 'minor' : 'major'}`) : v.autotune.scale;
  const inSel = h('select', { onchange: (e) => { lsSet('vxIn', e.target.value); if (audio && audio.vocal) audio.startVocal(e.target.value, Number(lsGet('vxCh') || 0)).then(syncHost); } }, h('option', { value: '' }, 'Default input'));
  const chSel = h('select', { onchange: (e) => { lsSet('vxCh', e.target.value); if (audio && audio.vocal) audio.startVocal(lsGet('vxIn') || '', Number(e.target.value)).then(syncHost); } },
    h('option', { value: 0, selected: lsGet('vxCh') !== '1' }, 'Input 1 / left'), h('option', { value: 1, selected: lsGet('vxCh') === '1' }, 'Input 2 / right'));
  if (isHost() && navigator.mediaDevices) navigator.mediaDevices.enumerateDevices().then((list) => {
    for (const d of list.filter((x) => x.kind === 'audioinput' && x.deviceId !== 'default')) inSel.append(h('option', { value: d.deviceId, selected: d.deviceId === lsGet('vxIn') }, d.label || 'Input'));
  }).catch(() => {});
  box.replaceChildren(h('div', { className: 'vx' },
    h('div', { className: 'row' },
      h('button', { className: `btn${v.on ? ' primary' : ''}`, onclick: () => act('vocal.set', { vocal: { on: !v.on } }) }, v.on ? '● Vocal on' : 'Vocal off'),
      song ? h('button', { className: 'btn small', title: 'Remember these vocal settings for this song (recalled when the song is picked)', onclick: () => act('vocal.saveToSong', { songId: song.id }).then((r) => r && toast(`Saved for "${song.name}"`)) }, song.vocal ? 'Update song snapshot' : 'Save for this song') : null,
      song && song.vocal ? h('button', { className: 'btn small', title: 'This song has its own vocal settings', onclick: () => act('vocal.clearSong', { songId: song.id }) }, 'Forget') : null),
    isHost() ? h('div', { className: 'sec' }, h('h3', {}, 'Input'), inSel, chSel, slider('Gain', v.gain, -24, 24, 0.5, (x) => set({ gain: x }), (x) => `${x > 0 ? '+' : ''}${x} dB`), h('div', { className: 'lvl' }, h('i', { id: 'vxLevel' })))
      : h('p', { className: 'hint' }, 'The mic input is chosen on the computer that plays the audio. Settings here control it remotely.'),
    h('div', { className: 'sec' },
      h('h3', {}, 'Auto-tune', h('label', { className: 'check plain' }, h('input', { type: 'checkbox', checked: v.autotune.on, onchange: (e) => act('vocal.set', { vocal: { autotune: { on: e.target.checked } } }) }), ' on')),
      h('div', { className: 'tunerd' }, h('b', { id: 'vxNote' }, '—'), h('div', { className: 'cents' }, h('i', { id: 'vxCents' }))),
      h('div', { className: 'hint', id: 'vxFreq', style: { margin: 0 } }, ''),
      h('select', { onchange: (e) => act('vocal.set', { vocal: { autotune: { scale: e.target.value } } }) },
        ...[['song', `Follow the song key (${scaleName})`], ['major', 'Major'], ['minor', 'Minor'], ['chromatic', 'Chromatic (all notes)']].map(([val, l]) => h('option', { value: val, selected: v.autotune.scale === val }, l))),
      v.autotune.scale !== 'song' && v.autotune.scale !== 'chromatic' ? h('p', { className: 'hint', style: { margin: 0 } }, `Key: ${key === null ? 'C' : KEY_NAMES[key]} (from the song)`) : null,
      slider('Amount', Math.round(v.autotune.amount * 100), 0, 100, 1, (x) => set({ autotune: { amount: x / 100 } }), (x) => `${x}%`),
      slider('Speed', v.autotune.speed, 0, 300, 5, (x) => set({ autotune: { speed: x } }), (x) => (x === 0 ? 'hard' : `${x} ms`))),
    h('div', { className: 'sec' }, h('h3', {}, 'Tone'),
      slider('Low', v.eq.low, -12, 12, 0.5, (x) => set({ eq: { low: x } }), (x) => `${x > 0 ? '+' : ''}${x}`),
      slider('Presence', v.eq.mid, -12, 12, 0.5, (x) => set({ eq: { mid: x } }), (x) => `${x > 0 ? '+' : ''}${x}`),
      slider('Air', v.eq.high, -12, 12, 0.5, (x) => set({ eq: { high: x } }), (x) => `${x > 0 ? '+' : ''}${x}`),
      slider('Compress', Math.round(v.comp * 100), 0, 100, 1, (x) => set({ comp: x / 100 }), (x) => `${x}%`)),
    h('div', { className: 'sec' }, h('h3', {}, 'Effects'),
      slider('Reverb', Math.round(v.reverb * 100), 0, 100, 1, (x) => set({ reverb: x / 100 }), (x) => `${x}%`),
      slider('Delay', Math.round(v.delay * 100), 0, 100, 1, (x) => set({ delay: x / 100 }), (x) => `${x}%`),
      h('select', { onchange: (e) => act('vocal.set', { vocal: { fx: { delayBeats: Number(e.target.value) } } }) },
        ...[[0.25, '1/16 note'], [0.5, '1/8 note'], [0.75, 'Dotted 1/8'], [1, '1/4 note'], [2, '1/2 note']].map(([val, l]) => h('option', { value: val, selected: v.fx.delayBeats === val }, `Delay: ${l} (follows the song tempo)`))))));
  renderTuner();
}

// Resume audio after the first click if the browser started it suspended
document.addEventListener('pointerdown', () => { if (audio && audio.ctx && audio.ctx.state === 'suspended') audio.ctx.resume(); }, { once: false, passive: true });

export { KEY_NAMES, fmtTime, lsGet, lsSet, audio, isHost, songKeyNow, keyLabel, tempoOf, becomeHost, lastReport, report, syncHost, renderTracks, renderHostBox, renderKeyBox, renderTkStatus, playState, tracksRuntime, faderToDb, dbToFader, renderMixer, renderTuner, renderVocal };
