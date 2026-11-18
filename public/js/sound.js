// Setup → Follow the band by sound: listen to a microphone (or a feed from the sound desk) on this
// computer, find the beat and how loud the music is, and send them to the lights.
// The listening runs in this window; tick "Listen on this computer" on the computer that has the
// microphone. It starts again by itself when the app opens.
import { $, S, act, authHeaders, h, on, toast } from './core.js';
import { BeatTracker } from '../audio/beatcore.js';

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch {} };

let L = null; // { ctx, stream, node, bt, lastLevel, lastSent, beatAt }
const host = location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? 'the lighting computer' : `a device (${location.hostname})`;
const mul = () => Number(lsGet('soundMul')) || 1; // ×2 / ÷2 when the band is felt in double / half time

// Quiet sends (no toasts): many a second
function send(type, payload) {
  fetch('/api/action', { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ type, ...payload }) }).catch(() => {});
}

async function start(deviceId) {
  stop(false);
  const constraints = { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) } };
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const src = ctx.createMediaStreamSource(stream);
  const node = ctx.createScriptProcessor(1024, 1, 1);
  const bt = new BeatTracker(ctx.sampleRate);
  L = { ctx, stream, node, bt, lastLevel: -1, lastSent: 0, beatAt: 0 };
  node.onaudioprocess = (e) => {
    const beats = bt.process(e.inputBuffer.getChannelData(0));
    const now = performance.now();
    if (beats.length && bt.bpm) {
      L.beatAt = now;
      send('sound.beat', { bpm: Math.max(30, Math.min(300, bt.bpm * mul())), level: bt.level, host });
      L.lastSent = now;
      L.lastLevel = bt.level;
    } else if (now - L.lastSent > 150 && (Math.abs(bt.level - L.lastLevel) > 0.02 || now - L.lastSent > 1000)) {
      send('sound.level', { level: bt.level, host });
      L.lastSent = now;
      L.lastLevel = bt.level;
    }
  };
  src.connect(node);
  // A ScriptProcessor only runs when connected to the output; it outputs silence
  node.connect(ctx.destination);
  if (ctx.state === 'suspended') document.addEventListener('pointerdown', () => ctx.resume(), { once: true });
  lsSet('soundListen', deviceId || 'default');
  tick();
}

function stop(forget = true) {
  if (!L) return;
  L.node.disconnect();
  L.stream.getTracks().forEach((t) => t.stop());
  L.ctx.close();
  L = null;
  send('sound.stop', {});
  if (forget) lsSet('soundListen', null);
}

// Meter, BPM and the beat dot (this window's own analysis, so it is smooth)
function tick() {
  if (!L) return;
  const m = $('#soundMeter');
  if (m) m.style.width = `${Math.round(L.bt.level * 100)}%`;
  const b = $('#soundBpm');
  if (b) b.textContent = L.bt.bpm && L.bt.confidence > 0.1 ? `${Math.round(L.bt.bpm * mul())} BPM` : 'Finding the beat…';
  const d = $('#soundDot');
  if (d) d.classList.toggle('on', performance.now() - L.beatAt < 120);
  const db = $('#soundDb');
  if (db) db.textContent = L.bt.peakDb <= -49.5 && performance.now() - L.beatAt > 3000 ? 'No sound: check the input' : '';
  requestAnimationFrame(tick);
}

async function inputs() {
  try {
    const list = await navigator.mediaDevices.enumerateDevices();
    return list.filter((d) => d.kind === 'audioinput');
  } catch {
    return [];
  }
}

async function render() {
  const box = $('#soundBox');
  if (!box || !S.show) return;
  const cfg = S.show.settings.sound || { tempo: true, energy: true, groups: [], depth: 0.5 };
  const snd = S.runtime && S.runtime.sound;
  const devs = await inputs();
  const want = lsGet('soundListen');
  const sel = h('select', { title: 'Which input to listen to', onchange: () => L && start(sel.value).catch((e) => toast(`Microphone: ${e.message}`, true)) },
    h('option', { value: '' }, 'Default input'),
    ...devs.filter((d) => d.deviceId && d.deviceId !== 'default').map((d) => h('option', { value: d.deviceId, selected: d.deviceId === want }, d.label || 'Input')));
  const set = (v) => act('sound.settings', v);
  const groups = S.show.groups;
  box.replaceChildren(
    h('p', { className: 'hint' }, 'No backing tracks or click? The lights can listen to the band: the beat drives effects, pads and busking, and the lights get bigger when the music does. Best with a feed from the sound desk (an aux into the computer\'s audio input); a microphone in the room works too.'),
    h('div', { className: 'row wrap snd-row' },
      h('button', { className: `btn${L ? ' primary' : ''}`, onclick: () => (L ? (stop(), render()) : start(sel.value).then(render).catch((e) => toast(`Microphone: ${e.message}`, true))) }, L ? '■ Stop listening' : '🎤 Listen on this computer'),
      sel),
    L ? h('div', { className: 'row snd-row' },
      h('span', { id: 'soundDot', className: 'snd-dot' }),
      h('b', { id: 'soundBpm' }, ''),
      h('button', { className: 'btn small', title: 'The band feels twice as fast', onclick: () => { lsSet('soundMul', String(Math.min(2, mul() * 2))); render(); } }, '×2'),
      h('button', { className: 'btn small', title: 'The band feels half as fast', onclick: () => { lsSet('soundMul', String(Math.max(0.5, mul() / 2))); render(); } }, '÷2'),
      mul() !== 1 ? h('small', {}, mul() > 1 ? 'double time' : 'half time') : null,
      h('div', { className: 'lvl snd-lvl' }, h('i', { id: 'soundMeter' })),
      h('small', { id: 'soundDb', className: 'hint', style: { margin: 0 } }, ''))
      : snd ? h('p', { className: 'hint' }, `Listening on ${snd.host || 'another computer'}${snd.bpm ? ` · ${Math.round(snd.bpm)} BPM` : ''}.`) : '',
    h('label', { className: 'check plain' }, h('input', { type: 'checkbox', checked: cfg.tempo, onchange: (e) => set({ tempo: e.target.checked }) }),
      ' The beat sets the tempo (when no MIDI clock comes in and the tracks are not playing)'),
    h('label', { className: 'check plain' }, h('input', { type: 'checkbox', checked: cfg.energy, onchange: (e) => set({ energy: e.target.checked }) }),
      ' Brightness follows how big the music is (only in parts that follow the songs, like Worship)'),
    cfg.energy ? h('div', { className: 'snd-energy' },
      h('label', {}, 'How much: ', h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: cfg.depth, onchange: (e) => set({ depth: Number(e.target.value) }) }),
        h('small', {}, ` quiet = ${Math.round((1 - cfg.depth) * 100)}% brightness`)),
      groups.length ? h('div', { className: 'row wrap' }, h('small', {}, 'Which lights:'),
        h('button', { className: `chip${cfg.groups.length ? '' : ' on'}`, onclick: () => set({ groups: [] }) }, 'All'),
        ...groups.map((g) => h('button', { className: `chip${cfg.groups.includes(g.id) ? ' on' : ''}`,
          onclick: () => set({ groups: cfg.groups.includes(g.id) ? cfg.groups.filter((x) => x !== g.id) : [...cfg.groups, g.id] }) }, g.name))) : null,
      snd && snd.factor !== null && snd.factor !== undefined ? h('p', { className: 'hint' }, `Now: ${Math.round(snd.factor * 100)}% brightness from the music.`) : null) : '',
  );
}

on('state', render);
let lastSnd = null;
on('runtime', () => {
  const now = !!(S.runtime && S.runtime.sound);
  if (now !== lastSnd) { lastSnd = now; render(); }
});

// Start listening again by itself when this computer was listening before
const again = lsGet('soundListen');
if (again && navigator.mediaDevices) start(again === 'default' ? '' : again).catch(() => {});
