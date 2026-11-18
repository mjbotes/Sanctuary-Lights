// Setup → Test: check everything before the service.
// - Lights: blink each one (or all in turn) to see they answer and are in the right place
// - Inputs: what last arrived from MIDI, OSC, ProPresenter and timecode
// - Audio: a test tone on each output pair, and the microphone level
import { $, S, act, h, on } from './core.js';
import { audio, isHost } from './tracks.js';
import { fmtTc } from './lighting.js';

let walk = null; // blinking every light in turn
let mic = null;

function blinkAll() {
  if (walk) return stopWalk();
  const list = S.show.fixtures.map((f) => f.id);
  if (!list.length) return;
  let i = 0;
  const next = () => {
    if (i >= list.length) return stopWalk();
    const f = S.show.fixtures.find((x) => x.id === list[i]);
    walk.name = f ? f.name : '';
    act('fixture.identify', { fixtures: [list[i]], seconds: 3 });
    i++;
    renderLights();
  };
  walk = { timer: setInterval(next, 1500), name: '' };
  next();
}
function stopWalk() {
  if (walk) clearInterval(walk.timer);
  walk = null;
  act('fixture.identify', { on: false });
  renderLights();
}

function renderLights() {
  const box = $('#testLights');
  if (!box || !S.show) return;
  const fx = S.show.fixtures;
  box.replaceChildren(
    h('div', { className: 'row wrap' },
      h('button', { className: `btn${walk ? ' primary' : ''}`, disabled: !fx.length, onclick: blinkAll }, walk ? `■ Stop (${walk.name})` : '▶ Blink every light in turn'),
      h('button', { className: 'btn', disabled: !fx.length, onclick: () => act('fixture.identify', { fixtures: fx.map((f) => f.id), seconds: 5 }) }, 'Blink all together')),
    fx.length ? h('div', { className: 'test-fix' }, ...fx.map((f) => h('button', { className: 'btn small', title: `Universe ${f.universe}, address ${f.address}`, onclick: () => act('fixture.identify', { fixtures: [f.id], seconds: 5 }) }, f.name)))
      : h('p', { className: 'hint' }, 'No lights patched yet (Patch tab, or the setup wizard).'));
}

const ago = (t) => {
  if (!t) return '';
  const s = Math.round((Date.now() - t) / 1000);
  return s < 2 ? 'just now' : s < 90 ? `${s} s ago` : `${Math.round(s / 60)} min ago`;
};

function renderInputs() {
  const box = $('#testInputs');
  if (!box || !S.show) return;
  const rt = S.runtime;
  const row = (name, ok, text) => h('div', { className: 'test-in' }, h('span', { className: `dot${ok ? ' ok' : ''}` }), h('b', {}, name), h('span', {}, text));
  const m = rt.lastMidi;
  const midiOk = m && Date.now() - m.at < 15000;
  const o = rt.lastOsc;
  const pp = S.ppConn;
  const tc = S.live && S.live.tc;
  const out = S.usb;
  const s = S.show.settings;
  box.replaceChildren(
    row('DMX out', s.enttec ? out && out.state === 'connected' : s.artnet || s.sacn,
      [s.artnet && 'Art-Net', s.sacn && 'sACN', s.enttec && (out ? `USB: ${out.message}` : 'USB')].filter(Boolean).join(' · ') || 'Nothing is switched on (Output settings below)'),
    row('MIDI in', midiOk, m ? `${m.result || m.name || ''} · ${ago(m.at)}` : S.midi && S.midi.ports && S.midi.ports.length ? `Waiting… (inputs: ${S.midi.ports.join(', ')})` : 'No MIDI inputs found'),
    row('OSC in', o && Date.now() - o.at < 15000, o ? `${o.address || ''} ${o.result ? `→ ${o.result}` : ''} · ${ago(o.at)}` : S.oscConn && S.oscConn.listening ? `Listening on port ${S.oscConn.port}…` : 'Off'),
    row('ProPresenter', pp && pp.connected, !s.pp || !s.pp.enabled ? 'Off' : pp && pp.connected ? `${pp.streaming ? 'Live updates' : 'Connected'}${rt.pp && rt.pp.presentation ? ` · ${rt.pp.presentation.name}${rt.pp.group ? ` · ${rt.pp.group}` : ''}` : ''}` : (pp && pp.error) || 'Not connected'),
    row('Timecode', tc && tc.running, tc ? `${tc.running ? 'Running' : 'Stopped'} · ${fmtTc(tc.s)}` : s.tcEnabled ? 'Nothing received yet' : 'Off'),
    row('Audio', isHost() || (rt.audioHost && true), isHost() ? `This computer · ${audio.channels} output channels` : rt.audioHost ? `Plays on ${rt.audioHost.name}` : 'No computer is playing audio (Tracks tab)'));
}

function renderAudio() {
  const box = $('#testAudio');
  if (!box) return;
  if (!isHost()) return box.replaceChildren(h('p', { className: 'hint' }, 'Test tones and the mic check run on the computer that plays the audio (tick "This computer plays the audio" on the Tracks tab there).'));
  box.replaceChildren(
    h('div', { className: 'row wrap' }, ...audio.outputPairs().map((p) => h('button', { className: 'btn small', title: 'Short 1 kHz tone, left then right', onclick: () => audio.testTone(p.value) }, `♪ ${p.label}`))),
    h('div', { className: 'row' },
      h('button', { className: `btn small${mic ? ' primary' : ''}`, onclick: toggleMic }, mic ? '■ Stop mic check' : '🎤 Mic check'),
      h('div', { className: 'lvl test-lvl' }, h('i', { id: 'testMicLvl' })), h('span', { id: 'testMicDb', className: 'hint', style: { margin: 0 } }, '')));
}

async function toggleMic() {
  if (mic) {
    mic.stream.getTracks().forEach((t) => t.stop());
    cancelAnimationFrame(mic.raf);
    mic = null;
    return renderAudio();
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const an = audio.ctx.createAnalyser();
    an.fftSize = 1024;
    audio.ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Float32Array(an.fftSize);
    mic = { stream, an };
    renderAudio();
    const draw = () => {
      if (!mic) return;
      an.getFloatTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v));
      const db = peak > 0 ? 20 * Math.log10(peak) : -90;
      const el = $('#testMicLvl');
      if (el) el.style.width = `${Math.max(0, Math.min(100, (db + 60) * (100 / 60)))}%`;
      const t = $('#testMicDb');
      if (t) t.textContent = db < -55 ? 'No signal' : db > -3 ? `${db.toFixed(0)} dB: too loud, turn the gain down` : `${db.toFixed(0)} dB`;
      mic.raf = requestAnimationFrame(draw);
    };
    draw();
  } catch (e) {
    $('#testMicDb') && ($('#testMicDb').textContent = `Mic: ${e.message}`);
  }
}

on('state', () => { renderLights(); renderInputs(); renderAudio(); });
on('runtime', renderInputs);
setInterval(() => S.tab === 'setup' && renderInputs(), 1000);
