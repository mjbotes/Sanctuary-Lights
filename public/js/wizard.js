// First-run setup wizard: name, how the lights are connected, which lights there are, and what
// tells the lights when to change. Opens by itself on a new, empty show (admins only), and from
// the Setup tab at any time.
import { $, S, act, authHeaders, h, on, toast } from './core.js';
import { oflPick } from './lighting.js';

const STEPS = ['Welcome', 'Connection', 'Lights', 'Cues from', 'Done'];
let step = 0;
let choice = { connection: null, cues: null };
const dlg = () => $('#wizard');

function open() {
  step = 0;
  const s = S.show.settings;
  choice = { connection: s.enttec ? 'usb' : s.artnet ? 'artnet' : s.sacn ? 'sacn' : null, cues: (s.pp && s.pp.enabled) ? 'pp' : null };
  render();
  if (!dlg().open) dlg().showModal();
}

function finish() {
  act('settings.update', { settings: { setupDone: true } });
  dlg().close();
}

const card = (id, title, text, cur, onpick) => h('button', { type: 'button', className: `wz-card${cur === id ? ' on' : ''}`, onclick: () => onpick(id) }, h('b', {}, title), h('span', {}, text));

function stepWelcome() {
  const name = h('input', { value: S.show.name || '', placeholder: 'e.g. Grace Church main hall', onchange: (e) => act('settings.update', { name: e.target.value }) });
  return [
    h('h2', {}, 'Welcome to Sanctuary Lights'),
    h('p', {}, 'A few questions to get your lights going. It takes about two minutes, and you can change everything later on the Setup and Patch tabs.'),
    h('label', { className: 'form' }, 'What is this room or show called?', name),
  ];
}

function stepConnection() {
  const s = S.show.settings;
  const pick = (id) => {
    choice.connection = id;
    const settings = { enttec: id === 'usb', artnet: id === 'artnet', sacn: id === 'sacn' };
    act('settings.update', { settings }).then(render);
  };
  const u = S.usb;
  const extra = [];
  if (choice.connection === 'usb') {
    extra.push(h('p', { className: `wz-status ${u && u.state === 'connected' ? 'ok' : ''}` }, u ? `● ${u.message}` : '● Looking for the USB-DMX interface…'),
      h('p', { className: 'hint' }, 'Plug the interface in: it is found by itself. No driver is needed on a Mac.'));
  } else if (choice.connection === 'artnet') {
    extra.push(h('label', { className: 'form' }, 'Send to (leave as is to reach every Art-Net node on the network)',
      h('input', { value: s.artnetTarget, onchange: (e) => act('settings.update', { settings: { artnetTarget: e.target.value } }) })));
  } else if (choice.connection === 'sacn') {
    extra.push(h('p', { className: 'hint' }, 'sACN is sent to every node on the network (multicast). Set your node to the same universe numbers as your lights.'));
  }
  return [
    h('h2', {}, 'How do the lights connect to this computer?'),
    h('div', { className: 'wz-cards' },
      card('usb', 'USB-DMX interface', 'A box with a USB cable and a DMX socket (Enttec DMX USB Pro or similar).', choice.connection, pick),
      card('artnet', 'Art-Net node', 'A network box, or lights plugged into the network (most common).', choice.connection, pick),
      card('sacn', 'sACN (E1.31)', 'A network node or console set to sACN.', choice.connection, pick),
      card('none', 'Not connected yet', 'Try everything on screen first; the 3D view shows what the lights would do.', choice.connection, pick)),
    ...extra,
  ];
}

function stepLights() {
  const profs = Object.values(S.profiles);
  const type = h('select', {}, ...profs.map((p) => h('option', { value: p.id, selected: p.id === choice.profile }, p.name)));
  // Search the Open Fixture Library; the chosen mode becomes the type to add
  const results = h('div', { className: 'oflresults' });
  let timer = null;
  const find = h('input', { type: 'search', placeholder: 'Not in the list? Search the fixture library: e.g. Chauvet SlimPAR', style: { width: '100%' },
    oninput: () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const q = find.value.trim();
        if (q.length < 2) return results.replaceChildren();
        const j = await fetch(`/api/ofl/search?q=${encodeURIComponent(q)}`, { headers: authHeaders() }).then((r) => r.json()).catch(() => null);
        if (!j || !j.ok) return results.replaceChildren(h('p', { className: 'hint' }, (j && j.error) || 'Search failed'));
        results.replaceChildren(...(j.results.length ? j.results.slice(0, 6).map((f) => h('button', { type: 'button', className: 'oflrow',
          onclick: (e) => oflPick(f, e.currentTarget, (added) => { if (added && added[0]) choice.profile = added[0].id; setTimeout(render, 300); }) },
        h('b', {}, f.name), h('span', {}, f.manufacturer), h('small', {}, `${f.modes.length} mode${f.modes.length === 1 ? '' : 's'}`))) : [h('p', { className: 'hint' }, 'Nothing found.')]));
      }, 200);
    } });
  const count = h('input', { type: 'number', min: 1, max: 64, value: 4, style: { width: '70px' } });
  const name = h('input', { placeholder: 'Name, e.g. Front wash', style: { flex: 1 } });
  const universe = h('input', { type: 'number', min: 1, value: 1, style: { width: '64px' } });
  const add = () => act('fixture.add', { profile: type.value, count: Number(count.value) || 1, name: name.value, universe: Number(universe.value) || 1 }).then((r) => {
    if (!r) return;
    toast('Added. Use "Find" to blink one and check it is the right light.');
    name.value = '';
    render();
  });
  const list = S.show.fixtures;
  return [
    h('h2', {}, 'Which lights do you have?'),
    h('p', { className: 'hint' }, 'Add each kind of light. They get DMX addresses one after the other, starting at the first free address: set the lights themselves to the same addresses.'),
    h('div', { className: 'row wrap wz-add' }, count, h('span', {}, '×'), type, name, h('span', { className: 'hint', style: { margin: 0 } }, 'universe'), universe, h('button', { type: 'button', className: 'btn primary', onclick: add }, 'Add')),
    h('div', { className: 'oflsearch' }, find, results),
    list.length
      ? h('div', { className: 'wz-list' }, ...list.map((f) => h('div', { className: 'wz-fix' },
        h('span', {}, f.name), h('small', {}, `${S.profiles[f.profile] ? S.profiles[f.profile].name : f.profile} · ${f.universe}.${f.address}`),
        h('button', { type: 'button', className: 'btn small', title: 'Blink this light white', onclick: () => act('fixture.identify', { fixtures: [f.id], seconds: 6 }) }, 'Find'))))
      : h('p', { className: 'empty' }, 'No lights yet.'),
  ];
}

function stepCues() {
  const s = S.show.settings;
  const pick = (id) => {
    choice.cues = id;
    if (id === 'pp') act('settings.update', { settings: { pp: { enabled: true } } }).then(render);
    else render();
  };
  const extra = [];
  if (choice.cues === 'tracks') {
    const ports = (S.midi && S.midi.ports) || [];
    extra.push(h('label', { className: 'form' }, 'MIDI input from the tracks computer',
      h('select', { onchange: (e) => act('settings.update', { settings: { midiInput: e.target.value } }) },
        h('option', { value: '' }, 'All MIDI inputs'), ...ports.map((p) => h('option', { value: p, selected: p === s.midiInput }, p)))),
    h('p', { className: 'hint' }, ports.length ? 'Each song section is a MIDI note from your track app. On the Songs tab, add your songs and use Learn to match what it sends.' : 'No MIDI inputs found yet. On a Mac, turn on the IAC Driver (Audio MIDI Setup) or a Network session, then come back.'));
  } else if (choice.cues === 'pp') {
    const pp = s.pp || {};
    extra.push(h('div', { className: 'row' },
      h('label', { className: 'form' }, 'ProPresenter computer (IP or name)', h('input', { value: pp.host || '', placeholder: 'localhost or 192.168.1.30', onchange: (e) => act('settings.update', { settings: { pp: { host: e.target.value } } }) })),
      h('label', { className: 'form', style: { maxWidth: '110px' } }, 'Port', h('input', { type: 'number', value: pp.port || 1025, onchange: (e) => act('settings.update', { settings: { pp: { port: e.target.value } } }) }))),
    h('p', { className: `wz-status ${S.ppConn && S.ppConn.connected ? 'ok' : ''}` }, S.ppConn && S.ppConn.connected ? '● Connected to ProPresenter' : `● ${S.ppConn && S.ppConn.error ? S.ppConn.error : 'Not connected yet'}`),
    h('p', { className: 'hint' }, 'In ProPresenter: Settings → Network → tick Enable Network and use the port shown there. Slide groups (Verse, Chorus…) then change the lights.'));
  } else if (choice.cues === 'tracks-here') {
    extra.push(h('p', { className: 'hint' }, 'Open the Tracks tab on the computer connected to the sound desk and tick "This computer plays the audio". Add each song\'s stems and place the section markers: the lights follow the markers.'));
  } else if (choice.cues === 'manual') {
    extra.push(h('p', { className: 'hint' }, 'The Volunteer tab has big Next / Back buttons for each song section or cue. Volunteers can get their own PIN that only opens that screen (Setup → Access).'));
  }
  return [
    h('h2', {}, 'What tells the lights when to change?'),
    h('div', { className: 'wz-cards' },
      card('tracks', 'Backing tracks app', 'Playback (MultiTracks) or Ableton sends MIDI for each section.', choice.cues, pick),
      card('tracks-here', 'Tracks played here', 'This app plays the backing tracks too (Tracks tab).', choice.cues, pick),
      card('pp', 'ProPresenter', 'Lyrics slides: Verse, Chorus, Bridge change the lights.', choice.cues, pick),
      card('manual', 'Someone presses buttons', 'A volunteer taps Next on a simple screen.', choice.cues, pick)),
    ...extra,
  ];
}

function stepDone() {
  return [
    h('h2', {}, 'You are ready'),
    h('ul', { className: 'wz-tips' },
      h('li', {}, h('b', {}, 'Test'), ': Setup → Test shows whether MIDI, OSC and ProPresenter are arriving, blinks each light, and plays test tones.'),
      h('li', {}, h('b', {}, 'Looks'), ': on the Program tab, pick lights, set colours, and record a look for Verse, Chorus, Bridge…'),
      h('li', {}, h('b', {}, 'Songs'), ': add songs and their sections; each section picks the look with the same name.'),
      h('li', {}, h('b', {}, 'Panic'), ': if anything goes wrong during a service, hold Panic for one second.')),
    h('div', { className: 'row' },
      h('button', { type: 'button', className: 'btn', onclick: () => { finish(); $('nav button[data-tab=setup]').click(); setTimeout(() => $('#testBox') && $('#testBox').scrollIntoView({ behavior: 'smooth' }), 100); } }, 'Open the test page'),
      h('button', { type: 'button', className: 'btn', onclick: () => { finish(); $('nav button[data-tab=program]').click(); } }, 'Make my first look')),
  ];
}

function render() {
  const d = dlg();
  if (!d || !S.show) return;
  const body = [stepWelcome, stepConnection, stepLights, stepCues, stepDone][step]();
  d.querySelector('.wz-body').replaceChildren(...body);
  d.querySelector('.wz-steps').replaceChildren(...STEPS.map((s, i) => h('span', { className: i === step ? 'on' : i < step ? 'done' : '' }, `${i + 1}. ${s}`)));
  d.querySelector('.wz-back').disabled = step === 0;
  d.querySelector('.wz-next').textContent = step === STEPS.length - 1 ? 'Finish' : 'Next';
}

// Live bits (USB found, ProPresenter connected) update while the wizard is open
on('state', () => {
  if (dlg() && dlg().open && (step === 1 || step === 3)) {
    if (!dlg().querySelector('.wz-body').contains(document.activeElement) || document.activeElement.tagName === 'BUTTON') render();
  }
  // First run: an empty show on a computer with full access
  if (S.show && !S.show.settings.setupDone && !S.show.fixtures.length && S.role === 'admin' && !S.wizardShown) {
    S.wizardShown = true;
    open();
  }
});

$('#wizard .wz-back').addEventListener('click', () => { step = Math.max(0, step - 1); render(); });
$('#wizard .wz-next').addEventListener('click', () => {
  if (step === STEPS.length - 1) return finish();
  step++;
  render();
});
$('#wizard .wz-skip').addEventListener('click', finish);
$('#wizardBtn').addEventListener('click', open);

export { open as openWizard };
