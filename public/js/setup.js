// Setup tab: output, network, MIDI, show file, DMX monitor.
import { $, S, act, h, selected, toast } from './core.js';
import { renderOscStatus } from './palette.js';
import { renderPpStatus } from './propresenter.js';
import { renderMidiSettings } from './songs.js';

// ----- setup tab ----------------------------------------------------------
let ifaces = [];
function renderSettings() {
  const f = $('#setForm');
  if (f.contains(document.activeElement)) return;
  const s = S.show.settings;
  f.name.value = S.show.name || '';
  f.artnet.checked = s.artnet;
  f.artnetTarget.value = s.artnetTarget;
  f.artnetBase.value = String(s.artnetBase || 0);
  f.sacn.checked = s.sacn;
  f.sacnUnicast.value = s.sacnUnicast || '';
  f.sacnPriority.value = s.sacnPriority;
  f.enttec.checked = s.enttec;
  f.enttecPort.value = s.enttecPort || '';
  f.enttecUniverse.value = s.enttecUniverse || 1;
  f.fps.value = s.fps;
  f.noteBase.value = s.noteBase ?? 36;
  const pp = s.pp || {};
  f.ppEnabled.checked = !!pp.enabled;
  f.ppHost.value = pp.host || '';
  f.ppPort.value = pp.port || 1025;
  f.ppSections.checked = pp.sections !== false;
  f.ppSongs.checked = pp.songs !== false;
  f.ppColorMode.value = pp.colorMode || 'off';
  f.screenProtect.value = s.screenProtect || 'warn';
  f.ppColorTarget.value = pp.colorTarget || 'primary';
  f.oscEnabled.checked = !s.osc || s.osc.enabled !== false;
  f.oscPort.value = (s.osc && s.osc.port) || 8000;
  renderOscStatus();
  $('#ppColorGroups').replaceChildren(...S.show.groups.map((g) => {
    const on = (pp.colorGroups || []).includes(g.id);
    return h('button', { type: 'button', className: `chip${on ? ' on' : ''}`, style: on ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}, onclick: () => {
      const list = new Set(pp.colorGroups || []);
      on ? list.delete(g.id) : list.add(g.id);
      act('settings.update', { settings: { pp: { colorGroups: [...list] } } });
    } }, `${on ? '✓ ' : ''}${g.name}`);
  }));
  renderPpStatus();
  f.pcSelectsSong.checked = s.pcSelectsSong !== false;
  renderIfaces();
  renderMidiSettings();
}
function renderIfaces() {
  const s = S.show.settings;
  $('#ifaceSelect').replaceChildren(
    h('option', { value: '' }, 'Automatic'),
    ...ifaces.map((i) => h('option', { value: i.address, selected: i.address === s.sacnInterface }, `${i.name} – ${i.address}`))
  );
}
async function loadInfo() {
  try {
    const info = await (await fetch('/api/info')).json();
    ifaces = info.interfaces;
    if (S.show) renderIfaces();
    $('#dataDir').textContent = `Saved automatically to ${info.dataDir} on the lighting computer. Backups are kept in its "backups" folder.`;
    $('#urls').replaceChildren(
      ...(ifaces.length
        ? ifaces.map((i) => h('div', {}, h('code', {}, `http://${i.address}:${info.port}`), ` (${i.name})`))
        : [h('div', {}, 'No network found.')]),
      h('p', {}, 'Connect the iPad to the same Wi-Fi as the lighting computer, open this address in Safari, then use Share → Add to Home Screen.')
    );
    $('#outErr').textContent = info.outputError || '';
  } catch {}
}
$('#setForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const settings = {
    artnet: f.artnet.checked, artnetTarget: f.artnetTarget.value, artnetBase: Number(f.artnetBase.value),
    sacn: f.sacn.checked, sacnInterface: f.sacnInterface.value, sacnUnicast: f.sacnUnicast.value, sacnPriority: f.sacnPriority.value,
    enttec: f.enttec.checked, enttecPort: f.enttecPort.value, enttecUniverse: f.enttecUniverse.value, fps: f.fps.value,
    pp: { enabled: f.ppEnabled.checked, host: f.ppHost.value, port: f.ppPort.value, sections: f.ppSections.checked, songs: f.ppSongs.checked, colorMode: f.ppColorMode.value, colorTarget: f.ppColorTarget.value },
    osc: { enabled: f.oscEnabled.checked, port: f.oscPort.value },
    screenProtect: f.screenProtect.value,
    midiInput: f.midiInput.value, midiOutput: f.midiOutput.value, midiChannel: f.midiChannel.value, noteBase: f.noteBase.value, pcSelectsSong: f.pcSelectsSong.checked,
  };
  if (await act('settings.update', { settings, name: f.name.value })) toast('Settings saved');
  document.activeElement.blur();
});
$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const show = JSON.parse(await file.text());
    if (confirm(`Load "${show.name || file.name}"? This replaces the current show (a backup of the current one was kept when the app started; download one first to be safe).`))
      if (await act('show.load', { show })) toast('Show loaded');
  } catch {
    toast('That file could not be read', true);
  }
});
$('#newShow').onclick = () => confirm('Start an empty show? Download a backup first if you want to keep the current one.') && act('show.new');
$('#demoShow').onclick = () => confirm('Replace the current show with the demo show?') && act('show.new', { demo: true });

// DMX monitor (polls only while the Setup tab is open)
async function pollDmx() {
  if (S.tab === 'setup' && !document.hidden) {
    try {
      const sel = $('#monUniverse');
      const u = Number(sel.value) || 1;
      const d = await (await fetch(`/api/dmx?u=${u}`)).json();
      const opts = d.universes.length ? d.universes : [1];
      if (sel.options.length !== opts.length) sel.replaceChildren(...opts.map((x) => h('option', { value: x, selected: x === u }, `Universe ${x}`)));
      const mon = $('#dmxMon');
      if (mon.children.length !== 512) mon.replaceChildren(...Array.from({ length: 512 }, () => h('div', {}, '', h('i'))));
      d.data.forEach((v, i) => {
        const cellEl = mon.children[i];
        cellEl.firstChild.nodeValue = v ? String(v) : String(i + 1);
        cellEl.className = v ? 'v' : '';
        cellEl.title = `Channel ${i + 1}: ${v}`;
        cellEl.lastChild.style.width = `${(v / 255) * 100}%`;
      });
    } catch {}
  }
  setTimeout(pollDmx, 300);
}

export { ifaces, renderSettings, renderIfaces, loadInfo, pollDmx };
