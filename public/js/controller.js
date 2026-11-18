// Setup → Hardware controller: Launchpad / APC mini mk2 (ready-made layout) or any MIDI controller (Learn).
import { $, S, act, authHeaders, h, on, toast } from './core.js';

// Same layout as lib/controller.js (rows top to bottom)
const ROWS = [
  ['Service parts (Worship, Hosting, Sermon, Video…)', 'part'],
  ['Sections of the current song 1–8', 'sec'],
  ['Sections 9–16', 'sec'],
  ['Sections 17–24', 'sec'],
  ['Pads 1–8', 'pad'],
  ['Pads 9–16', 'pad'],
  ['Set-list songs 1–8', 'song'],
  ['◀ section · section ▶ · next item · Flash · Strobe · Blackout · Panic (hold) · Tap', 'ctl'],
];

let fnList = [];
async function loadFunctions() {
  try {
    const r = await fetch('/api/controller/functions', { headers: authHeaders() }).then((x) => x.json());
    if (r.ok) fnList = r.functions;
  } catch {}
}

function render() {
  const box = $('#controllerBox');
  if (!box || !S.show) return;
  if (box.contains(document.activeElement) && document.activeElement.tagName === 'SELECT') return;
  const c = S.show.settings.controller || {};
  const ports = (S.midi && S.midi.ports) || [];
  const set = (patch) => act('settings.controller', { controller: patch });
  const learning = S.runtime.controllerLearn;
  const parts = [
    h('p', { className: 'hint' }, 'Run the service from physical buttons: faster and safer than a touchscreen under pressure. The controller has its own MIDI port, so its buttons never trigger song sections.'),
    h('label', { className: 'check plain' }, h('input', { type: 'checkbox', checked: !!c.enabled, onchange: (e) => set({ enabled: e.target.checked }) }), ' Use a hardware controller'),
    h('div', { className: 'row wrap' },
      h('label', { className: 'form' }, 'Controller',
        h('select', { onchange: (e) => set({ profile: e.target.value }) },
          ...[['launchpad', 'Launchpad (Mini MK3, X, Pro MK3)'], ['apcmini', 'Akai APC mini mk2'], ['generic', 'Another MIDI controller (Learn the buttons)']].map(([v, l]) => h('option', { value: v, selected: (c.profile || 'launchpad') === v }, l)))),
      h('label', { className: 'form' }, 'MIDI port',
        h('select', { onchange: (e) => set({ port: e.target.value }) },
          h('option', { value: '' }, ports.length ? 'Choose the controller…' : 'No MIDI devices found'),
          ...ports.map((p) => h('option', { value: p, selected: p === c.port }, p)),
          c.port && !ports.includes(c.port) ? h('option', { value: c.port, selected: true }, `${c.port} (not connected)`) : ''))),
  ];
  if ((c.profile || 'launchpad') !== 'generic') {
    parts.push(h('div', { className: 'ctl-grid' }, ...ROWS.map(([label, kind]) => h('div', { className: `ctl-row k-${kind}` },
      h('div', { className: 'ctl-pads' }, ...Array.from({ length: 8 }, () => h('i'))), h('span', {}, label)))),
    h('p', { className: 'hint' }, 'Buttons light up: the current section pulses in its look\'s colour, the running service part is green, Blackout glows when on. Panic needs a 1-second hold. On a Launchpad, Sanctuary Lights switches it to Programmer mode by itself.'));
  } else {
    parts.push(h('p', { className: 'hint' }, learning ? `Press the button for "${(fnList.find((f) => f.key === learning) || {}).label || learning}" on the controller…` : 'Tap Learn, then press a button on the controller. Buttons that send notes also light up when their function is on.'),
      h('div', { className: 'ctl-learn' }, ...fnList.map((f) => {
        const trig = (c.learned || {})[f.key];
        return h('div', { className: `librow${learning === f.key ? ' learning' : ''}` },
          h('span', {}, f.label), h('small', {}, trig ? `${trig.t === 'cc' ? 'CC' : 'Note'} ${trig.n} · ch ${trig.ch + 1}` : '—'),
          h('button', { className: `btn small${learning === f.key ? ' on' : ''}`, onclick: () => act('controller.learn', { key: learning === f.key ? null : f.key }) }, learning === f.key ? 'Cancel' : 'Learn'),
          trig ? h('button', { className: 'btn small warn', onclick: () => act('controller.forget', { key: f.key }) }, '×') : '');
      })));
  }
  box.replaceChildren(...parts);
}

on('state', () => { render(); });
on('runtime', () => { if (S.tab === 'setup') render(); });
$('nav button[data-tab=setup]').addEventListener('click', async () => { await loadFunctions(); render(); });
on('runtime', () => {
  const learned = S.runtime.controllerLearn;
  if (render.wasLearning && !learned) toast('Button learned');
  render.wasLearning = learned;
});
