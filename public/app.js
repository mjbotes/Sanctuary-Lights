/* Sanctuary Lights – browser UI. Talks to server.js over /api. */
import { Stage3D } from './stage3d.js';
import { AudioEngine } from './audio/engine.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid);
  return el;
};
const pct = (v) => `${Math.round(v * 100)}%`;

const S = {
  show: null,
  profiles: {},
  runtime: { cueIndex: -1, gm: 1, blackout: false, programmer: {}, sceneLevels: {} },
  live: { fixtures: {}, cueProgress: 1, sceneLevels: {} },
  sel: new Set(),
  tab: 'live',
  arranging: false,
  midi: { available: false, ports: [], open: [] },
  editingSong: false,
};

// ----- server communication ----------------------------------------------
let toastTimer;
function toast(msg, bad = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (bad ? ' bad' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), bad ? 4000 : 2000);
}

async function act(type, payload = {}) {
  try {
    const r = await fetch('/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, ...payload }) });
    const j = await r.json();
    if (!j.ok) toast(j.error || 'Something went wrong', true);
    return j.ok ? j : false;
  } catch {
    toast('Cannot reach the lighting computer', true);
    return false;
  }
}

// Throttle continuous controls (faders) so we send at most ~25 updates/s per control.
const pending = new Map();
function actThrottled(key, type, payload) {
  const p = pending.get(key);
  if (p) {
    p.payload = payload;
    return;
  }
  const entry = { payload };
  pending.set(key, entry);
  act(type, payload).finally(() =>
    setTimeout(() => {
      pending.delete(key);
      if (entry.payload !== payload) actThrottled(key, type, entry.payload);
    }, 40)
  );
}

function connect() {
  const es = new EventSource('/api/events');
  es.addEventListener('state', (e) => {
    const d = JSON.parse(e.data);
    S.show = d.show;
    S.profiles = Object.fromEntries(d.profiles.map((p) => [p.id, p]));
    S.runtime = d.runtime;
    S.midi = d.midi || S.midi;
    S.ppConn = d.pp || null;
    S.oscConn = d.osc || null;
    for (const id of [...S.sel]) if (!S.show.fixtures.some((f) => f.id === id)) S.sel.delete(id);
    renderAll();
    $('#outErr').textContent = d.outputError || '';
    if (stage3d) stage3d.setShow(S.show, S.profiles);
  });
  es.addEventListener('runtime', (e) => {
    S.runtime = JSON.parse(e.data);
    renderRuntime();
  });
  es.addEventListener('live', (e) => {
    S.live = JSON.parse(e.data);
    renderLive();
    if (stage3d) stage3d.setLive(S.live.fixtures);
    updateScreenWarn();
  });
  es.onopen = () => $('#conn').classList.remove('off');
  es.onerror = () => $('#conn').classList.add('off');
}

// ----- helpers ----------------------------------------------------------
const fixtures = () => (S.show ? S.show.fixtures : []);
const fixById = (id) => fixtures().find((f) => f.id === id);
const profOf = (f) => S.profiles[f.profile] || { attrs: [], footprint: 1, name: '?' };
const selected = () => fixtures().filter((f) => S.sel.has(f.id));
function selAttrs() {
  const set = new Set();
  for (const f of selected()) for (const a of profOf(f).attrs) set.add(a);
  return set;
}
function progValue(attr) {
  for (const f of selected()) {
    const p = S.runtime.programmer[f.id];
    if (p && attr in p) return p[attr];
  }
  return null;
}
function ask(title, value = '') {
  return new Promise((resolve) => {
    const d = $('#prompt');
    $('#promptTitle').textContent = title;
    const inp = $('#promptInput');
    inp.value = value;
    d.returnValue = '';
    d.onclose = () => resolve(d.returnValue === 'ok' ? inp.value : null);
    d.showModal();
    inp.select();
  });
}

// ----- tabs -------------------------------------------------------------
$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (!b) return;
  S.tab = b.dataset.tab;
  $$('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
  $$('.tab').forEach((t) => t.classList.toggle('on', t.id === `tab-${S.tab}`));
  if (S.tab === 'setup') loadInfo();
  try { localStorage.setItem('tab', S.tab); } catch {}
  place3d();
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (b) act(b.dataset.act);
});

// ----- render: everything -----------------------------------------------
function renderAll() {
  if (!S.show) return;
  $('#showName').textContent = S.show.name || 'Sanctuary Lights';
  document.title = `${S.show.name || 'Sanctuary'} · Lights`;
  renderStages();
  renderGroups();
  renderScenes();
  renderCueTable();
  renderSceneTable();
  renderPatch();
  renderProfiles();
  renderSettings();
  renderSongs();
  renderLooks();
  renderBusk();
  renderPads();
  renderFx();
  renderTracks();
  renderSetup3d();
  renderScreens();
  renderRuntime();
  renderControls();
  renderLive();
}

// ----- stage views --------------------------------------------------------
function buildStage(el, mode) {
  el.replaceChildren();
  if (!fixtures().length) {
    el.append(h('div', { className: 'empty', style: { position: 'absolute', inset: '30% 10% auto' } }, 'No lights yet. Add some on the Patch tab.'));
    return;
  }
  for (const f of fixtures()) {
    const node = h('div', { className: 'fx', style: { left: `${f.x * 100}%`, top: `${f.y * 100}%` } }, h('div', { className: 'dot' }), h('div', { className: 'nm' }, f.name));
    node.dataset.id = f.id;
    if (mode === 'select') node.addEventListener('click', () => toggleSel(f.id));
    if (mode === 'arrange') makeDraggable(node, el, f);
    el.append(node);
  }
}
function renderStages() {
  buildStage($('#liveStage'), 'view');
  buildStage($('#progStage'), 'select');
  if (S.arranging) buildStage($('#arrangeStage'), 'arrange');
  renderSelection();
}
function makeDraggable(node, stage, f) {
  node.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    node.setPointerCapture(e.pointerId);
    const rect = stage.getBoundingClientRect();
    let x = f.x, y = f.y;
    const move = (ev) => {
      x = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
      y = Math.min(1, Math.max(0, (ev.clientY - rect.top) / rect.height));
      node.style.left = `${x * 100}%`;
      node.style.top = `${y * 100}%`;
    };
    const up = () => {
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up);
      if (x !== f.x || y !== f.y) act('fixture.edit', { id: f.id, x, y });
    };
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', up);
  });
}
function renderLive() {
  for (const node of $$('.stage .fx')) {
    const l = S.live.fixtures[node.dataset.id];
    if (!l) continue;
    const [r, g, b] = l.c;
    const dot = node.firstChild;
    dot.style.background = `rgb(${r},${g},${b})`;
    const glow = Math.max(r, g, b);
    dot.style.boxShadow = glow > 8 ? `0 0 ${6 + glow / 10}px rgba(${r},${g},${b},.8)` : 'none';
    node.classList.toggle('prog', !!S.runtime.programmer[node.dataset.id]);
  }
  $('#cueProgress').style.width = pct(S.live.cueProgress);
  for (const d of $$('.beatdot')) d.style.opacity = (1 - (S.live.beat ?? 0) * 0.85).toFixed(2);
  for (const card of $$('#liveScenes .scene')) {
    const lvl = S.live.sceneLevels[card.dataset.id] || 0;
    card.classList.toggle('on', lvl > 0);
    card.querySelector('.fill').style.opacity = (lvl * 0.35).toFixed(3);
    const slider = card.querySelector('input');
    if (document.activeElement !== slider && !slider.dragging) slider.value = Math.round(lvl * 1000);
  }
  if (S.tab === 'program' && !$('#dim').dragging) updateDimReadout();
}

// ----- selection & groups ----------------------------------------------
function toggleSel(id) {
  S.sel.has(id) ? S.sel.delete(id) : S.sel.add(id);
  renderSelection();
  renderControls();
}
function setSel(ids) {
  S.sel = new Set(ids);
  renderSelection();
  renderControls();
}
function renderSelection() {
  for (const node of $$('#progStage .fx')) node.classList.toggle('sel', S.sel.has(node.dataset.id));
  if (stage3d && S.tab === 'program') stage3d.setSelection([...S.sel]);
  if (S.show) { renderFxSel(); renderPresets(); renderFxRunBar(); }
  const n = S.sel.size;
  $('#selInfo').textContent = n ? `${n} selected: ${selected().map((f) => f.name).join(', ')}` : 'Tap lights to select them, or pick a group.';
}
$('#selAll').onclick = () => setSel(fixtures().map((f) => f.id));
$('#selNone').onclick = () => setSel([]);
function renderGroups() {
  const bar = $('#groupBar');
  bar.replaceChildren(
    ...S.show.groups.map((g) =>
      h('button', {
        className: 'chip',
        title: 'Tap to select. Long-press or right-click to delete.',
        onclick: () => setSel(g.fixtures),
        oncontextmenu: async (e) => {
          e.preventDefault();
          if (confirm(`Delete group "${g.name}"?`)) act('group.delete', { id: g.id });
        },
      }, g.name)
    ),
    h('button', {
      className: 'chip add',
      onclick: async () => {
        if (!S.sel.size) return toast('Select some lights first', true);
        const name = await ask('Name for this group');
        if (name) act('group.save', { name, fixtures: [...S.sel] });
      },
    }, '+ Save group')
  );
}

// ----- live tab ---------------------------------------------------------
function renderRuntime() {
  if (!S.show) return;
  const cues = S.show.cues;
  const i = S.runtime.cueIndex;
  const cur = cues[i];
  const next = cues[i + 1];
  const base = S.runtime.base || { kind: 'cue' };
  if (base.kind === 'look') {
    const song = S.show.songs.find((x) => x.id === S.runtime.songId);
    const sec = song && song.sections.find((x) => x.id === S.runtime.sectionId);
    const look = S.show.looks.find((l) => l.id === base.lookId);
    $('#nowName').textContent = sec ? `${song.name} · ${sec.name}` : `Look: ${look ? look.name : '?'}`;
    $('#nowNotes').textContent = 'Songs are driving the lights. GO returns to the cue list.';
  } else {
    $('#nowName').textContent = cur ? cur.name : i < 0 ? 'Cue list not started' : '—';
    $('#nowNotes').textContent = cur && cur.notes ? cur.notes : '';
  }
  $('#nextName').textContent = next ? `${next.name}  ·  ${next.fade}s` : cues.length ? 'End of list' : 'No cues yet – record some on the Program tab';
  $('#goBtn').disabled = !next;
  $('#backBtn').disabled = i < 0;
  const list = $('#liveCues');
  list.replaceChildren(
    ...cues.map((c, n) =>
      h('div', { className: `cuerow${n === i ? ' cur' : ''}${n === i + 1 ? ' next' : ''}`, onclick: () => act('cue.goto', { id: c.id }) },
        h('span', { className: 'n' }, n + 1), h('span', {}, c.name), h('span', { className: 'f' }, `${c.fade}s`))
    )
  );
  const curRow = list.querySelector('.cur');
  if (curRow) curRow.scrollIntoView({ block: 'nearest' });
  for (const r of $$('#cueTable tr')) r.classList.toggle('cur', r.dataset.index === String(i));

  const gm = $('#gm');
  if (!gm.dragging) gm.value = Math.round(S.runtime.gm * 1000);
  $('#gmVal').textContent = pct(S.runtime.gm);
  $('#blackout').classList.toggle('on', S.runtime.blackout);
  $('#blackout').textContent = S.runtime.blackout ? 'BLACKOUT ON' : 'Blackout';
  const progCount = Object.keys(S.runtime.programmer).length;
  const badge = $('#progBadge');
  badge.hidden = !progCount;
  badge.textContent = `Editing ${progCount} light${progCount === 1 ? '' : 's'} · Clear`;
  if (S.tab === 'program') syncControlValues();
  renderSongLive();
  updateBusk();
  renderLooks();
  updatePads();
  updateFxLive();
  if (S.tab === 'fx') renderFxSel();
  tracksRuntime();
  renderPpStatus();
  ppSlideChanged();
  renderPalette();
  renderOscStatus();
}
$('#goBtn').onclick = () => act('cue.go');
$('#backBtn').onclick = () => act('cue.back');
$('#blackout').onclick = () => act('blackout.set', { on: !S.runtime.blackout });
$('#progBadge').onclick = () => act('prog.clear');
bindFader($('#gm'), (v) => {
  $('#gmVal').textContent = pct(v);
  actThrottled('gm', 'gm.set', { value: v });
});
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea') || document.querySelector('dialog[open]') || e.repeat || e.metaKey || e.ctrlKey) return;
  if (S.tab === 'songs') {
    if (e.key === 't' || e.key === 'T') return act('tempo.tap');
    if (e.code === 'Space' || e.key === 'ArrowRight') { e.preventDefault(); $('#nextSec').click(); }
    else if (e.key === 'ArrowLeft') $('#prevSec').click();
    return;
  }
  if (e.key === 't' || e.key === 'T') return act('tempo.tap');
  if (e.code === 'Space') { e.preventDefault(); act('cue.go'); }
  else if (e.key === 'Backspace' || e.key === 'ArrowLeft') act('cue.back');
});

function renderScenes() {
  const wrap = $('#liveScenes');
  if (!S.show.scenes.length) {
    wrap.replaceChildren(h('div', { className: 'empty', style: { gridColumn: '1 / -1' } }, 'No scenes yet. Set some lights on the Program tab and tap "Save as scene".'));
    return;
  }
  wrap.replaceChildren(
    ...S.show.scenes.map((s) => {
      const slider = h('input', { type: 'range', min: 0, max: 1000, value: 0, 'aria-label': `${s.name} level` });
      bindFader(slider, (v) => actThrottled(`scene-${s.id}`, 'scene.level', { id: s.id, level: v }));
      const card = h('div', { className: 'scene', style: { '--sc': s.color } },
        h('div', { className: 'fill', style: { background: s.color } }),
        h('button', { className: 'tap', onclick: () => act('scene.toggle', { id: s.id }) }, h('span', { className: 'sw' }), s.name),
        slider);
      card.style.setProperty('--sc', s.color);
      card.dataset.id = s.id;
      return card;
    })
  );
}

// Faders: mark while dragging so live updates don't fight the finger.
function bindFader(input, onValue) {
  input.addEventListener('pointerdown', () => (input.dragging = true));
  const end = () => setTimeout(() => (input.dragging = false), 300);
  input.addEventListener('pointerup', end);
  input.addEventListener('pointercancel', end);
  input.addEventListener('input', () => onValue(input.value / 1000));
}

// ----- program tab --------------------------------------------------------
const SWATCHES = [
  ['Open', '#ffffff'], ['Warm', '#ffc78f'], ['Cool', '#dbe7ff'], ['Red', '#ff0000'], ['Orange', '#ff5a00'],
  ['Amber', '#ffa400'], ['Yellow', '#ffe600'], ['Green', '#00ff1e'], ['Teal', '#00ffa0'], ['Cyan', '#00e1ff'],
  ['Sky', '#4aa8ff'], ['Blue', '#0028ff'], ['Indigo', '#3c00ff'], ['Purple', '#8a00ff'], ['Magenta', '#ff00d0'], ['Pink', '#ff6aa8'],
];
const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
function renderProgSwatches() {
  const pal = (S.runtime && S.runtime.palette) || ['#ffb070', '#2050ff', '#a020f0'];
  $('#swatches').replaceChildren(
    ...['Primary', 'Secondary', 'Tertiary'].map((name, i) =>
      h('button', { className: 'palbtn', style: { background: pal[i] }, title: `${name} colour of the song (stays linked: change the song's ${name.toLowerCase()} and this follows)`, onclick: () => setPalette(i + 1) }, h('span', {}, name.slice(0, 3).toUpperCase()))),
    ...SWATCHES.map(([name, hex]) =>
      h('button', { style: { background: hex }, title: name, onclick: () => setColor(hex) }, h('span', {}, name))));
}
renderProgSwatches();
function setPalette(n) {
  if (!S.sel.size) return toast('Select some lights first', true);
  act('preset.apply', { id: `pal:${n}`, fixtures: effSel() });
  const off = selected().filter((f) => (S.live.fixtures[f.id]?.d ?? 0) === 0 && profOf(f).attrs.includes('dim'));
  if (off.length) act('prog.set', { fixtures: off.map((f) => f.id), values: { dim: 1 } });
}
function setColor(hex) {
  if (!S.sel.size) return toast('Select some lights first', true);
  act('prog.color', { fixtures: effSel(), rgb: hexToRgb(hex) });
  // Lights that are off would not show the colour, so bring them up.
  const off = selected().filter((f) => (S.live.fixtures[f.id]?.d ?? 0) === 0 && profOf(f).attrs.includes('dim'));
  if (off.length) act('prog.set', { fixtures: off.map((f) => f.id), values: { dim: 1 } });
}
$('#colorPick').addEventListener('input', (e) => {
  if (!S.sel.size) return;
  actThrottled('color', 'prog.color', { fixtures: effSel(), rgb: hexToRgb(e.target.value) });
});

bindFader($('#dim'), (v) => {
  $('#dimVal').textContent = pct(v);
  actThrottled('dim', 'prog.set', { fixtures: effSel(), values: { dim: v } });
});
for (const b of $$('[data-dim]')) b.onclick = () => S.sel.size && act('prog.set', { fixtures: effSel(), values: { dim: Number(b.dataset.dim) } });
$('#locateBtn').onclick = () => S.sel.size && act('prog.locate', { fixtures: effSel() });
$('#clearSelBtn').onclick = () => S.sel.size && act('prog.clear', { fixtures: effSel() });
$('#clearAllBtn').onclick = () => act('prog.clear');
$('#centerPos').onclick = () => act('prog.set', { fixtures: effSel(), values: { pan: 0.5, tilt: 0.5 } });

const COLOR_ATTRS = ['red', 'green', 'blue', 'white', 'amber', 'uv'];
const LABELS = { red: 'Red', green: 'Green', blue: 'Blue', white: 'White', amber: 'Amber', uv: 'UV', zoom: 'Zoom', focus: 'Focus', strobe: 'Strobe', haze: 'Haze', fan: 'Fan' };

function miniSlider(attr) {
  const input = h('input', { type: 'range', min: 0, max: 1000, value: 0 });
  const out = h('b', {}, '—');
  input.dataset.attr = attr;
  bindFader(input, (v) => {
    out.textContent = pct(v);
    actThrottled(`attr-${attr}`, 'prog.set', { fixtures: effSel(), values: { [attr]: v } });
  });
  return h('div', { className: 'mini' }, h('span', {}, LABELS[attr] || attr), input, out);
}

function renderControls() {
  const attrs = selAttrs();
  $('#controls').classList.toggle('disabled', !S.sel.size);
  $('#colorCtl').hidden = S.sel.size > 0 && !COLOR_ATTRS.some((a) => attrs.has(a));
  $('#extraColor').replaceChildren(...COLOR_ATTRS.filter((a) => attrs.has(a)).map(miniSlider));
  $('#moveCtl').hidden = !(attrs.has('pan') || attrs.has('tilt'));
  const other = [...attrs].filter((a) => a !== 'dim' && a !== 'pan' && a !== 'tilt' && !COLOR_ATTRS.includes(a));
  $('#otherCtl').replaceChildren(...(other.length ? [h('div', { className: 'ctl' }, h('div', { className: 'ctlhead' }, h('span', {}, 'Other')), ...other.map(miniSlider))] : []));
  syncControlValues();
}
function updateDimReadout() {
  const p = progValue('dim');
  let v = p;
  if (v === null) {
    const first = selected()[0];
    v = first ? S.live.fixtures[first.id]?.d ?? 0 : null;
  }
  $('#dimVal').textContent = v === null ? '—' : pct(v) + (p === null ? ' (live)' : '');
  if (v !== null && !$('#dim').dragging) $('#dim').value = Math.round(v * 1000);
}
function syncControlValues() {
  updateDimReadout();
  for (const input of $$('#extraColor input, #otherCtl input')) {
    if (input.dragging) continue;
    const v = progValue(input.dataset.attr);
    input.value = Math.round((v ?? 0) * 1000);
    input.nextSibling.textContent = v === null ? '—' : pct(v);
  }
  if (!xyDragging) {
    const pan = progValue('pan') ?? 0.5, tilt = progValue('tilt') ?? 0.5;
    $('#xyDot').style.left = pct(pan);
    $('#xyDot').style.top = pct(1 - tilt);
  }
}
let xyDragging = false;
(() => {
  const pad = $('#xy');
  const set = (e) => {
    const r = pad.getBoundingClientRect();
    const pan = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const tilt = 1 - Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    $('#xyDot').style.left = pct(pan);
    $('#xyDot').style.top = pct(1 - tilt);
    actThrottled('xy', 'prog.set', { fixtures: effSel(), values: { pan, tilt } });
  };
  pad.addEventListener('pointerdown', (e) => { xyDragging = true; pad.setPointerCapture(e.pointerId); set(e); });
  pad.addEventListener('pointermove', (e) => xyDragging && set(e));
  pad.addEventListener('pointerup', () => (xyDragging = false));
})();

$('#recCue').onclick = async () => {
  const name = await ask('Name for the new cue (e.g. "Worship 1", "Sermon")', `Cue ${S.show.cues.length + 1}`);
  if (name !== null && (await act('cue.record', { name, fixtures: [...S.sel] }))) toast(`Recorded "${name}"`);
};
$('#updCue').onclick = async () => {
  const cur = S.show.cues[S.runtime.cueIndex];
  if (!cur) return toast('No cue is running. Use "Record new cue".', true);
  if (confirm(`Replace cue "${cur.name}" with what is on stage now?`) && (await act('cue.update', { fixtures: [...S.sel] }))) toast(`Updated "${cur.name}"`);
};
$('#recScene').onclick = async () => {
  if (!Object.keys(S.runtime.programmer).length) return toast('Change some lights first, then save them as a scene', true);
  const name = await ask('Name for the scene (e.g. "Pulpit", "Baptism")');
  if (name !== null && (await act('scene.record', { name }))) toast(`Saved scene "${name || 'Scene'}"`);
};

// ----- cues & scenes tab --------------------------------------------------
function cell(input) {
  return h('td', {}, input);
}
function renderCueTable() {
  const tb = $('#cueTable');
  if (!S.show.cues.length) {
    tb.replaceChildren(h('tr', {}, h('td', { colSpan: 5, className: 'hint' }, 'No cues yet.')));
    return;
  }
  tb.replaceChildren(
    ...S.show.cues.map((c, i) => {
      const tr = h('tr', { className: i === S.runtime.cueIndex ? 'cur' : '' },
        h('td', {}, h('button', { className: 'btn small', title: 'Go to this cue', onclick: () => act('cue.goto', { id: c.id }) }, i + 1)),
        cell(h('input', { value: c.name, onchange: (e) => act('cue.edit', { id: c.id, name: e.target.value }) })),
        cell(h('input', { type: 'number', min: 0, step: 0.5, value: c.fade, onchange: (e) => act('cue.edit', { id: c.id, fade: e.target.value }) })),
        cell(h('input', { value: c.notes || '', placeholder: 'note for operator', onchange: (e) => act('cue.edit', { id: c.id, notes: e.target.value }) })),
        h('td', { className: 'acts' },
          h('button', { className: 'btn', title: 'Move up', onclick: () => act('cue.move', { id: c.id, dir: -1 }) }, '↑'),
          h('button', { className: 'btn', title: 'Move down', onclick: () => act('cue.move', { id: c.id, dir: 1 }) }, '↓'),
          h('button', { className: 'btn warn', title: 'Delete', onclick: () => confirm(`Delete cue "${c.name}"?`) && act('cue.delete', { id: c.id }) }, '✕'))
      );
      tr.dataset.index = i;
      return tr;
    })
  );
}
function renderSceneTable() {
  const tb = $('#sceneTable');
  if (!S.show.scenes.length) {
    tb.replaceChildren(h('tr', {}, h('td', { colSpan: 4, className: 'hint' }, 'No scenes yet.')));
    return;
  }
  tb.replaceChildren(
    ...S.show.scenes.map((s) =>
      h('tr', {},
        cell(h('input', { type: 'color', value: s.color, onchange: (e) => act('scene.edit', { id: s.id, color: e.target.value }) })),
        cell(h('input', { value: s.name, onchange: (e) => act('scene.edit', { id: s.id, name: e.target.value }) })),
        cell(h('input', { type: 'number', min: 0, step: 0.5, value: s.fade, onchange: (e) => act('scene.edit', { id: s.id, fade: e.target.value }) })),
        h('td', { className: 'acts' },
          h('button', { className: 'btn', title: 'Replace with the Program tab settings', onclick: () => confirm(`Replace scene "${s.name}" with what is set in the programmer?`) && act('scene.update', { id: s.id }) }, 'Update'),
          h('button', { className: 'btn', onclick: () => act('scene.move', { id: s.id, dir: -1 }) }, '↑'),
          h('button', { className: 'btn', onclick: () => act('scene.move', { id: s.id, dir: 1 }) }, '↓'),
          h('button', { className: 'btn warn', onclick: () => confirm(`Delete scene "${s.name}"?`) && act('scene.delete', { id: s.id }) }, '✕'))
      )
    )
  );
}

// ----- patch tab ----------------------------------------------------------
function profileOptions(selectedId) {
  return Object.values(S.profiles).map((p) => h('option', { value: p.id, selected: p.id === selectedId }, `${p.name}`));
}
function renderPatch() {
  const keep = $('#addProfile').value;
  $('#addProfile').replaceChildren(...profileOptions(keep || 'drgbw'));
  // Find address clashes
  const owners = new Map();
  const clash = new Set();
  for (const f of fixtures()) {
    for (let i = 0; i < profOf(f).footprint; i++) {
      const key = `${f.universe}:${f.address + i}`;
      if (owners.has(key)) { clash.add(f.id); clash.add(owners.get(key)); }
      else owners.set(key, f.id);
    }
  }
  const tb = $('#fixTable');
  if (!fixtures().length) {
    tb.replaceChildren(h('tr', {}, h('td', { colSpan: 5, className: 'hint' }, 'Nothing patched yet. Add your lights above.')));
  } else {
    tb.replaceChildren(
      ...fixtures().map((f) =>
        h('tr', { className: clash.has(f.id) ? 'clash' : '', title: clash.has(f.id) ? 'This light shares DMX channels with another light' : '' },
          cell(h('input', { value: f.name, onchange: (e) => act('fixture.edit', { id: f.id, name: e.target.value }) })),
          cell(h('select', { onchange: (e) => act('fixture.edit', { id: f.id, profile: e.target.value }) }, ...profileOptions(f.profile))),
          cell(h('input', { type: 'number', min: 1, value: f.universe, onchange: (e) => act('fixture.edit', { id: f.id, universe: e.target.value }) })),
          cell(h('input', { type: 'number', min: 1, max: 512, value: f.address, title: `Uses ${f.address}–${f.address + profOf(f).footprint - 1}`, onchange: (e) => act('fixture.edit', { id: f.id, address: e.target.value }) })),
          h('td', { className: 'acts' }, h('button', { className: 'btn warn', onclick: () => confirm(`Remove "${f.name}"? It will also be removed from all cues and scenes.`) && act('fixture.delete', { fixtures: [f.id] }) }, '✕'))
        )
      )
    );
  }
}
$('#addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(e.target));
  if (!d.address) delete d.address;
  if (await act('fixture.add', d)) {
    toast('Added');
    e.target.name.value = '';
    e.target.address.value = '';
  }
});
$('#arrangeBtn').onclick = () => {
  S.arranging = !S.arranging;
  $('#arrangeWrap').hidden = !S.arranging;
  $('#arrangeBtn').textContent = S.arranging ? 'Done arranging' : 'Arrange stage';
  if (S.arranging) buildStage($('#arrangeStage'), 'arrange');
  renderLive();
};

function renderProfiles() {
  const list = Object.values(S.profiles);
  $('#profileList').replaceChildren(
    h('div', { className: 'proflist' },
      ...list.map((p) =>
        h('div', { className: 'profrow' },
          h('b', {}, p.name), h('code', { title: p.channels }, p.channels),
          p.builtin
            ? h('button', { className: 'btn small', title: 'Copy into a new custom type', onclick: () => editProfile({ name: `${p.name} (copy)`, channels: p.channels }) }, 'Copy')
            : [h('button', { className: 'btn small', onclick: () => editProfile(p) }, 'Edit'),
               h('button', { className: 'btn small warn', onclick: () => confirm(`Delete type "${p.name}"?`) && act('profile.delete', { id: p.id }) }, '✕')]
        )
      )
    )
  );
}
function editProfile(p) {
  const f = $('#profForm');
  f.id.value = p.id || '';
  f.name.value = p.name;
  f.channels.value = p.channels;
  $('#profFormTitle').textContent = p.id ? `Edit "${p.name}"` : 'New fixture type';
  f.name.focus();
}
$('#profCancel').onclick = () => editProfile({ name: '', channels: '' });
$('#profForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(e.target));
  if (await act('profile.save', d)) {
    toast('Fixture type saved');
    editProfile({ name: '', channels: '' });
  }
});

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

// ----- live control (busking) ------------------------------------------------
const BUSK_COLORS = [['Open', '#ffffff'], ['Warm', '#ffc78f'], ['Red', '#ff0000'], ['Amber', '#ffa400'], ['Green', '#00ff1e'], ['Cyan', '#00e1ff'], ['Blue', '#0028ff'], ['Purple', '#8a00ff'], ['Magenta', '#ff00d0']];
const FX = [['off', 'Off'], ['pulse', 'Pulse'], ['chase', 'Chase'], ['sparkle', 'Sparkle'], ['rainbow', 'Rainbow'], ['wave', 'Move']];
const rgbToHex = (c) => '#' + c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');

function storedEffects() {
  const base = S.runtime.base || { kind: 'cue' };
  const src = base.kind === 'look' ? lookById(base.lookId) : S.show.cues[S.runtime.cueIndex];
  return new Map(((src && src.effects) || []).map((e) => [e.groupId, e]));
}

function renderBusk() {
  for (const box of [$('#liveBusk'), $('#songsBusk')]) {
    const bar = h('div', { className: 'bk-bar' },
      h('h2', {}, 'Live control'),
      h('span', { className: 'beatdot', title: 'Beat' }),
      h('span', { className: 'bk-bpm', title: 'Tap to type a tempo' }, '120 BPM'),
      h('button', { className: 'btn small bk-tap', title: 'Tap on the beat (or press T)' }, 'TAP'),
      h('button', { className: 'btn small bk-release', title: 'Undo all live changes' }, 'Release live'));
    if (!S.show.groups.length) {
      box.replaceChildren(bar, h('div', { className: 'empty' }, 'Make groups on the Program tab (select lights, then "+ Save group") to get live faders, colours and effects here.'));
      continue;
    }
    box.replaceChildren(bar, h('div', { className: 'bk-grid' },
      ...S.show.groups.map((g) => {
        const has = (attr) => g.fixtures.some((id) => { const f = fixById(id); return f && profOf(f).attrs.includes(attr); });
        const movers = has('pan');
        const colour = ['red', 'green', 'blue', 'white'].some(has) && g.fixtures.some((id) => { const f = fixById(id); return f && profOf(f).attrs.some((a) => ['red', 'green', 'blue'].includes(a)); });
        const card = h('div', { className: 'bk-card' },
          h('div', { className: 'bk-head' }, h('b', {}, g.name), h('span', { className: 'lvl' }, '100%'),
            h('button', { className: 'btn flash', title: 'Hold for full' }, 'Flash')),
          h('input', { type: 'range', min: 0, max: 1000, value: 1000, className: 'bk-level', 'aria-label': `${g.name} level` }),
          !colour ? null : h('div', { className: 'bk-pal' }, ...['P', 'S', 'T'].map((l, i) => h('button', { 'data-brole': i + 1, title: ['Primary', 'Secondary', 'Tertiary'][i] }, l))),
          !colour ? null : h('div', { className: 'bk-colors' },
            ...BUSK_COLORS.map(([name, hex]) => h('button', { title: name, style: { background: hex }, 'data-bcolor': hex })),
            h('button', { className: 'x', title: 'Back to the planned colour', 'data-bcolor': '' }, '×')),
          h('div', { className: 'bk-fx' },
            ...FX.filter(([k]) => (k !== 'wave' || movers) && (k !== 'rainbow' || colour)).map(([k, label]) => h('button', { 'data-fx': k }, label)),
            h('select', { className: 'bk-more', title: 'More effects' }, h('option', { value: '' }, 'More…'), ...effectOptions()),
            h('select', { className: 'bk-rate', title: 'Speed (beats)' },
              ...[[0.5, '½×'], [1, '1×'], [2, '2×'], [4, '4×']].map(([v, l]) => h('option', { value: v, selected: v === 1 }, l)))));
        card.dataset.g = g.id;
        const lvl = card.querySelector('.bk-level');
        bindFader(lvl, (v) => {
          card.querySelector('.lvl').textContent = pct(v);
          actThrottled(`bk-${g.id}`, 'busk.level', { groupId: g.id, level: v });
        });
        return card;
      })));
  }
  updateBusk();
}

function updateBusk() {
  if (!S.show) return;
  const busk = S.runtime.busk || {};
  const stored = storedEffects();
  for (const el of $$('.bk-bpm')) el.replaceChildren(`${Math.round(S.runtime.bpm || 120)} BPM `, h('small', {}, S.runtime.clock ? 'MIDI clock' : ''));
  for (const card of $$('.bk-card')) {
    const b = busk[card.dataset.g] || {};
    const level = b.level ?? 1;
    const lvl = card.querySelector('.bk-level');
    if (!lvl.dragging) lvl.value = Math.round(level * 1000);
    card.querySelector('.lvl').textContent = pct(level);
    const isRole = typeof b.color === 'string';
    const hex = b.color && !isRole ? rgbToHex(b.color) : null;
    for (const c of card.querySelectorAll('[data-bcolor]')) c.classList.toggle('on', !!hex && c.dataset.bcolor === hex);
    const pal = S.runtime.palette || [];
    for (const c of card.querySelectorAll('[data-brole]')) {
      c.style.background = pal[c.dataset.brole - 1] || '#888';
      c.classList.toggle('on', isRole && b.color === `pal:${c.dataset.brole}`);
    }
    const live = b.fx && b.fx !== 'off' ? b.fx.type : b.fx === 'off' ? 'off' : null;
    const auto = stored.get(card.dataset.g);
    for (const btn of card.querySelectorAll('[data-fx]')) {
      const k = btn.dataset.fx;
      btn.classList.toggle('on', live ? k === live : k === 'off' && !auto);
      const autoId = auto && (auto.effectId || auto.type);
      btn.classList.toggle('auto', !live && !!auto && k === autoId);
      btn.title = !live && auto && k === autoId ? 'Planned in this look/cue' : '';
    }
    if (b.fx && b.fx.rate) card.querySelector('.bk-rate').value = String(b.fx.rate);
    const more = card.querySelector('.bk-more');
    const cur = live || (auto && auto.effectId) || '';
    more.value = cur && !card.querySelector(`[data-fx="${cur}"]`) ? cur : '';
    more.classList.toggle('on', !!more.value);
    card.querySelector('.flash').classList.toggle('on', !!b.flash);
    card.classList.toggle('touched', !!(b.color || b.fx || level < 1));
  }
}

const flashing = new Map();
document.addEventListener('pointerdown', (e) => {
  const btn = e.target.closest('.bk-card .flash');
  if (!btn) return;
  e.preventDefault();
  const gid = btn.closest('.bk-card').dataset.g;
  btn.setPointerCapture(e.pointerId);
  btn.classList.add('on');
  flashing.set(e.pointerId, gid);
  act('busk.flash', { groupId: gid, on: true });
});
const endFlash = (e) => {
  const gid = flashing.get(e.pointerId);
  if (!gid) return;
  flashing.delete(e.pointerId);
  act('busk.flash', { groupId: gid, on: false });
};
document.addEventListener('pointerup', endFlash);
document.addEventListener('pointercancel', endFlash);
document.addEventListener('contextmenu', (e) => e.target.closest('.flash') && e.preventDefault());
document.addEventListener('click', async (e) => {
  const t = e.target;
  const card = t.closest('.bk-card');
  if (card && t.dataset.brole) return act('busk.color', { groupId: card.dataset.g, role: Number(t.dataset.brole) });
  if (card && t.dataset.bcolor !== undefined) {
    return act('busk.color', { groupId: card.dataset.g, rgb: t.dataset.bcolor ? hexToRgb(t.dataset.bcolor) : null });
  }
  if (card && t.dataset.fx) {
    return act('busk.fx', { groupId: card.dataset.g, fx: t.dataset.fx, rate: card.querySelector('.bk-rate').value });
  }
  if (t.closest('.bk-tap')) return act('tempo.tap');
  if (t.closest('.bk-release')) return act('busk.release');
  if (t.closest('.bk-bpm')) {
    const v = await ask('Tempo (BPM)', String(Math.round(S.runtime.bpm || 120)));
    if (v) act('tempo.set', { bpm: v });
  }
});
document.addEventListener('change', (e) => {
  if (e.target.classList.contains('bk-more')) {
    const card = e.target.closest('.bk-card');
    if (e.target.value) act('busk.fx', { groupId: card.dataset.g, fx: e.target.value, rate: card.querySelector('.bk-rate').value });
    return;
  }
  if (!e.target.classList.contains('bk-rate')) return;
  const card = e.target.closest('.bk-card');
  const b = (S.runtime.busk || {})[card.dataset.g] || {};
  const st = storedEffects().get(card.dataset.g);
  const type = b.fx && b.fx !== 'off' ? b.fx.type : st && (st.effectId || st.type);
  if (type) act('busk.fx', { groupId: card.dataset.g, fx: type, rate: e.target.value });
});

// ----- effects helpers --------------------------------------------------------
const FXM = window.FXMath;
const CAT_NAMES = { dim: 'Dimmer', color: 'Colour', position: 'Position', beam: 'Beam' };
const allEffects = () => [...FXM.BUILTIN, ...((S.show && S.show.effects) || [])];
const effectById = (id) => allEffects().find((e) => e.id === id);
const groupName = (id) => (id ? (S.show.groups.find((g) => g.id === id) || {}).name || '?' : 'All lights');
function effectOptions(selected) {
  const custom = (S.show && S.show.effects) || [];
  const groups = Object.entries(CAT_NAMES).map(([cat, label]) => h('optgroup', { label }, ...FXM.BUILTIN.filter((e) => e.cat === cat).map((e) => h('option', { value: e.id, selected: e.id === selected }, e.name))));
  if (custom.length) groups.push(h('optgroup', { label: 'My effects' }, ...custom.map((e) => h('option', { value: e.id, selected: e.id === selected }, e.name))));
  return groups;
}

// ----- pads & hot buttons --------------------------------------------------------
S.padEdit = false;
function padLabel(p) {
  if (p.kind === 'effect') return (effectById(p.effectId) || {}).name || 'Effect?';
  if (p.kind === 'preset') return /^pal:/.test(p.presetId || '') ? ['Primary', 'Secondary', 'Tertiary'][p.presetId.slice(4) - 1] : (S.show.presets.find((x) => x.id === p.presetId) || {}).name || 'Preset?';
  return 'Flash';
}
function renderPads() {
  for (const box of [$('#livePads'), $('#songsPads')]) {
    const head = h('div', { className: 'bk-bar' }, h('h2', {}, 'Pads'),
      h('span', { className: 'hint', style: { margin: 0 } }, 'Tap or press the key. Hold-pads work while held.'),
      h('button', { className: 'btn small', onclick: () => { S.padEdit = !S.padEdit; renderPads(); } }, S.padEdit ? 'Done' : 'Edit pads'));
    const grid = h('div', { className: 'pads-grid' },
      ...S.show.pads.map((p) => {
        const b = h('div', { className: `pad-btn${p.mode === 'hold' ? ' hold' : ''}`, role: 'button', tabIndex: 0 },
          h('b', {}, p.name), h('small', {}, `${padLabel(p)} · ${groupName(p.groupId)}`),
          p.key ? h('kbd', {}, p.key.toUpperCase()) : null,
          S.padEdit ? h('span', { className: 'pad-edit' },
            h('button', { className: 'btn', onclick: () => openPad(p) }, 'Edit'),
            h('button', { className: 'btn', onclick: () => act('pad.move', { id: p.id, dir: -1 }) }, '←'),
            h('button', { className: 'btn', onclick: () => act('pad.move', { id: p.id, dir: 1 }) }, '→'),
            h('button', { className: 'btn warn', onclick: () => confirm(`Delete pad "${p.name}"?`) && act('pad.delete', { id: p.id }) }, '✕')) : null);
        b.dataset.pad = p.id;
        return b;
      }),
      S.padEdit ? h('button', { className: 'pad-btn add', onclick: () => openPad(null) }, '+ Pad') : null);
    box.replaceChildren(head, grid);
  }
  updatePads();
}
function updatePads() {
  const on = S.runtime.padsOn || {};
  for (const b of $$('.pad-btn[data-pad]')) b.classList.toggle('on', !!on[b.dataset.pad]);
  $('#strobeBtn').classList.toggle('on', !!S.runtime.strobe);
  $('#flashBtn').classList.toggle('on', !!S.runtime.flashAll);
}
const padPointers = new Map();
document.addEventListener('pointerdown', (e) => {
  const b = e.target.closest('.pad-btn[data-pad]');
  if (!b || S.padEdit || e.target.closest('.pad-edit')) return;
  e.preventDefault();
  b.setPointerCapture(e.pointerId);
  padPointers.set(e.pointerId, b.dataset.pad);
  b.classList.add('on');
  act('pad.press', { id: b.dataset.pad, down: true });
});
const padUp = (e) => {
  const id = padPointers.get(e.pointerId);
  if (!id) return;
  padPointers.delete(e.pointerId);
  act('pad.press', { id, down: false });
};
document.addEventListener('pointerup', padUp);
document.addEventListener('pointercancel', padUp);

function holdButton(btn, type) {
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    btn.setPointerCapture(e.pointerId);
    btn.classList.add('on');
    act(type, { on: true });
  });
  const up = () => { btn.classList.remove('on'); act(type, { on: false }); };
  btn.addEventListener('pointerup', up);
  btn.addEventListener('pointercancel', up);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
}
holdButton($('#strobeBtn'), 'strobe.hold');
holdButton($('#flashBtn'), 'flash.all');
$('#helpBtn').onclick = () => $('#helpDialog').showModal();

// Global hotkeys (hold keys send "down" and "up")
const heldKeys = new Map();
const typingNow = (e) => e.target.matches('input, select, textarea') || document.querySelector('dialog[open]');
document.addEventListener('keydown', (e) => {
  if (typingNow(e) || e.metaKey || e.ctrlKey || e.altKey || !S.show) return;
  const k = e.key.toLowerCase();
  const pad = S.show.pads.find((x) => x.key && x.key === k);
  if (e.repeat) {
    if (k === 's' || k === 'f' || pad) e.preventDefault();
    return;
  }
  if (k === 's') { act('strobe.hold', { on: true }); heldKeys.set(k, () => act('strobe.hold', { on: false })); }
  else if (k === 'f') { act('flash.all', { on: true }); heldKeys.set(k, () => act('flash.all', { on: false })); }
  else if (k === 'b') act('blackout.set', { on: !S.runtime.blackout });
  else if (k === 'r') { act('busk.release'); toast('Live changes released'); }
  else if (e.key === '?') $('#helpDialog').showModal();
  else if (pad) { act('pad.press', { id: pad.id, down: true }); heldKeys.set(k, () => act('pad.press', { id: pad.id, down: false })); }
  else return;
  e.preventDefault();
});
document.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  const release = heldKeys.get(k);
  if (release) { heldKeys.delete(k); release(); }
});
window.addEventListener('blur', () => { for (const release of heldKeys.values()) release(); heldKeys.clear(); });

function openPad(p) {
  const f = $('#padForm');
  const pad = p || { name: '', kind: 'effect', effectId: 'pulse', presetId: '', groupId: '', mode: 'toggle', key: '', rate: 1 };
  $('#padDlgTitle').textContent = p ? `Edit pad "${p.name}"` : 'New pad';
  $('#padEffect').replaceChildren(...effectOptions(pad.effectId));
  $('#padPreset').replaceChildren(
    ...['Primary', 'Secondary', 'Tertiary'].map((n, i) => h('option', { value: `pal:${i + 1}`, selected: pad.presetId === `pal:${i + 1}` }, `${n} colour (palette)`)),
    ...S.show.presets.map((x) => h('option', { value: x.id, selected: x.id === pad.presetId }, `${x.name} (${KIND_NAMES[x.kind]})`)));
  $('#padGroup').replaceChildren(h('option', { value: '' }, 'All lights'), ...S.show.groups.map((g) => h('option', { value: g.id, selected: g.id === pad.groupId }, g.name)));
  f.id.value = p ? p.id : '';
  f.name.value = pad.name;
  f.key.value = pad.key || '';
  f.kind.value = pad.kind;
  f.mode.value = pad.mode;
  f.rate.value = String(pad.rate || 1);
  const showKind = () => {
    for (const el of $$('.pk-effect', f)) el.hidden = f.kind.value !== 'effect';
    for (const el of $$('.pk-preset', f)) el.hidden = f.kind.value !== 'preset';
  };
  f.kind.onchange = showKind;
  showKind();
  const dlg = $('#padDialog');
  dlg.returnValue = '';
  dlg.onclose = () => {
    if (dlg.returnValue !== 'ok') return;
    const d = Object.fromEntries(new FormData(f));
    if (!d.name) d.name = f.kind.value === 'effect' ? $('#padEffect').selectedOptions[0]?.textContent : 'Pad';
    act('pad.save', { pad: d });
  };
  dlg.showModal();
}

// ----- FX & Presets tab ----------------------------------------------------------
const KIND_NAMES = { dim: 'Dimmer', color: 'Colour', position: 'Position', beam: 'Beam', all: 'All' };
S.presetKind = 'all-kinds';
S.fxCat = 'dim';
S.fxPick = 'pulse';
S.presetEditing = false;

function renderFx() {
  renderFxSel();
  renderPresets();
  renderFxList();
  renderFxRunBar();
  renderFxEditor();
  updateFxLive();
}
function renderFxSel() {
  $('#fxGroups').replaceChildren(...S.show.groups.map((g) => h('button', { className: 'chip', onclick: () => setSel(g.fixtures) }, g.name)));
  const view = new Map(trickView().map((x) => [x.id, x]));
  const t = S.runtime.tricks || {};
  const timed = tricksOn() && ['fadeFrom', 'fadeTo', 'delayFrom', 'delayTo'].some((k) => FXM.hasValue(t[k]));
  $('#fxSelList').replaceChildren(...fixtures().map((f) => {
    const v = view.get(f.id);
    const sub = v && tricksOn() ? [
      `step ${v.k + 1}`,
      timed ? ` · ${(v.f !== undefined ? (FXM.hasValue(t.delayFrom) || FXM.hasValue(t.delayTo) ? (Number(FXM.hasValue(t.delayFrom) ? t.delayFrom : t.delayTo) + (Number(FXM.hasValue(t.delayTo) ? t.delayTo : t.delayFrom) - Number(FXM.hasValue(t.delayFrom) ? t.delayFrom : t.delayTo)) * v.f) : 0) : FXM.spread(t.delayFrom, t.delayTo, v.k, v.m, false) ?? 0).toFixed(1)}s` : '',
    ].join('') : '';
    return h('button', { className: `selchip${v ? ' on' : ''}${v && !v.active ? ' idle' : ''}`, title: v && !v.active ? 'Not in the active part' : '', onclick: () => toggleSel(f.id) },
      v ? h('i', {}, v.i + 1) : null, f.name, sub ? h('small', {}, sub) : null);
  }));
  renderTricks();
}
$('#fxSelAll').onclick = () => setSel(fixtures().map((f) => f.id));
$('#fxSelNone').onclick = () => setSel([]);
$('#fxClearProg').onclick = () => act('prog.clear');

$('#presetKinds').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-kind]');
  if (!b) return;
  S.presetKind = b.dataset.kind;
  for (const x of $$('#presetKinds button')) x.classList.toggle('on', x === b);
  renderPresets();
});
$('#presetEdit').onclick = () => { S.presetEditing = !S.presetEditing; $('#presetEdit').textContent = S.presetEditing ? 'Done' : 'Edit'; renderPresets(); };
function renderPresets() {
  const list = S.show.presets.filter((p) => S.presetKind === 'all-kinds' || p.kind === S.presetKind);
  const used = new Set();
  for (const fid of S.sel) for (const pid of Object.values((S.runtime.progRefs || {})[fid] || {})) used.add(pid);
  if (!list.length) {
    $('#presetGrid').replaceChildren(h('div', { className: 'empty', style: { gridColumn: '1 / -1' } }, 'No presets yet. Set some lights, select them and tap "+ Record preset".'));
    return;
  }
  $('#presetGrid').replaceChildren(...list.map((p) => {
    const b = h('div', { className: `preset${used.has(p.id) ? ' used' : ''}`, role: 'button', tabIndex: 0, title: `${KIND_NAMES[p.kind]} preset`, onclick: (e) => {
      if (e.target.closest('.pe')) return;
      if (!S.sel.size) return toast('Select lights first', true);
      act('preset.apply', { id: p.id, fixtures: effSel() });
    } },
      p.color ? h('span', { className: 'swatch', style: { background: p.color } }) : null,
      h('small', {}, KIND_NAMES[p.kind]), h('b', {}, p.name),
      S.presetEditing ? h('span', { className: 'pe' },
        h('button', { className: 'btn', title: 'Rename', onclick: async () => { const n = await ask('Preset name', p.name); if (n) act('preset.edit', { id: p.id, name: n }); } }, '✎'),
        h('button', { className: 'btn', title: 'Update from the selected lights', onclick: () => {
          if (!S.sel.size) return toast('Select the lights to take values from', true);
          if (confirm(`Update "${p.name}" from the selected lights? Cues and looks using it will change.`)) act('preset.record', { id: p.id, kind: p.kind, fixtures: [...S.sel], merge: true });
        } }, '⟳'),
        h('button', { className: 'btn', onclick: () => act('preset.move', { id: p.id, dir: -1 }) }, '←'),
        h('button', { className: 'btn warn', onclick: () => confirm(`Delete preset "${p.name}"?`) && act('preset.delete', { id: p.id }) }, '✕')) : null);
    return b;
  }));
}
$('#presetRecord').onclick = async () => {
  if (!S.sel.size) return toast('Select the lights to record from', true);
  const kind = S.presetKind === 'all-kinds' ? 'all' : S.presetKind;
  const name = await ask(`Name for this ${KIND_NAMES[kind].toLowerCase()} preset${kind === 'all' ? ' (pick a type above for just colour, position…)' : ''}`);
  if (name !== null && (await act('preset.record', { kind, name, fixtures: [...S.sel] }))) toast(`Recorded "${name}"`);
};

$('#fxCats').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-cat]');
  if (!b) return;
  S.fxCat = b.dataset.cat;
  for (const x of $$('#fxCats button')) x.classList.toggle('on', x === b);
  renderFxList();
});
function renderFxList() {
  const list = S.fxCat === 'custom' ? S.show.effects : FXM.BUILTIN.filter((e) => e.cat === S.fxCat);
  const running = new Set(Object.values(S.runtime.running || {}).map((r) => r.effectId));
  $('#fxList').replaceChildren(...(list.length ? list.map((e) => h('button', { className: `fxbtn${e.id === S.fxPick ? ' sel' : ''}${running.has(e.id) ? ' run' : ''}`, onclick: () => { S.fxPick = e.id; renderFxList(); renderFxRunBar(); renderFxEditor(); } }, e.name))
    : [h('div', { className: 'empty', style: { gridColumn: '1 / -1' } }, 'No effects of your own yet. Tap "+ New effect", or pick a built-in one and "Copy to edit".')]));
}
function runKey() {
  const t = $('#fxRunTarget').value || 'sel';
  return `fx:${S.fxPick}:${t}`;
}
function renderFxRunBar() {
  const fx = effectById(S.fxPick);
  const sel = $('#fxRunTarget');
  const keep = sel.value || 'sel';
  sel.replaceChildren(h('option', { value: 'sel' }, `Selected lights (${S.sel.size})`), h('option', { value: 'all' }, 'All lights'), ...S.show.groups.map((g) => h('option', { value: `g:${g.id}` }, g.name)));
  sel.value = [...sel.options].some((o) => o.value === keep) ? keep : 'sel';
  $('#fxPicked').textContent = fx ? fx.name : 'Pick an effect.';
  const running = (S.runtime.running || {})[runKey()];
  $('#fxRun').textContent = running ? '■ Stop' : '▶ Run';
  $('#fxRun').classList.toggle('warn', !!running);
}
$('#fxRunTarget').addEventListener('change', renderFxRunBar);
$('#fxRun').onclick = () => {
  const key = runKey();
  if ((S.runtime.running || {})[key]) return act('fx.stop', { key });
  const t = $('#fxRunTarget').value;
  const payload = { key, effectId: S.fxPick, rate: $('#fxRunRate').value };
  if (t.startsWith('g:')) payload.groupId = t.slice(2);
  else payload.fixtures = t === 'all' ? fixtures().map((f) => f.id) : effSel();
  act('fx.run', payload);
};
$('#fxStopAll').onclick = () => act('fx.stop', {});

function updateFxLive() {
  if (!S.show) return;
  renderFxRunBar();
  const running = Object.entries(S.runtime.running || {});
  const box = $('#fxRunning');
  if (!running.length) {
    box.replaceChildren(h('p', { className: 'hint' }, 'Nothing running. Effects started from pads, the live control strips and here all show up in this list.'));
  } else if (box.dataset.sig !== running.map(([k]) => k).join('|')) {
    box.dataset.sig = running.map(([k]) => k).join('|');
    box.replaceChildren(...running.map(([key, inst]) => {
      const pad = S.show.pads.find((p) => p.id === key);
      const target = inst.groupId ? groupName(inst.groupId) : inst.fixtures ? `${inst.fixtures.length} light${inst.fixtures.length === 1 ? '' : 's'}` : 'All lights';
      const size = h('input', { type: 'range', min: 0, max: 1000, value: Math.round((inst.size ?? 1) * 1000), title: 'Size' });
      bindFader(size, (v) => actThrottled(`size-${key}`, 'fx.adjust', { key, size: v }));
      size.dataset.key = key;
      const rate = h('select', { title: 'Speed', onchange: (e) => act('fx.adjust', { key, rate: e.target.value }) },
        ...[[0.25, '¼×'], [0.5, '½×'], [1, '1×'], [2, '2×'], [4, '4×']].map(([v, l]) => h('option', { value: v, selected: v === (inst.rate || 1) }, l)));
      return h('div', { className: 'runrow' },
        h('div', {}, h('b', {}, (effectById(inst.effectId) || {}).name || inst.effectId), h('small', {}, `${target}${pad ? ` · pad ${pad.name}` : ''}`)),
        rate, size,
        h('button', { className: 'btn small warn', onclick: () => act(pad ? 'pad.press' : 'fx.stop', pad ? { id: pad.id, down: pad.mode === 'toggle' } : { key }) }, 'Stop'));
    }));
  } else {
    for (const inp of $$('#fxRunning input[type=range]')) if (!inp.dragging) inp.value = Math.round(((S.runtime.running[inp.dataset.key] || {}).size ?? 1) * 1000);
  }
  if (S.tab === 'fx') renderFxList();
}

// Effect editor
let fxSaveTimer = null;
function saveDraft(fx) {
  clearTimeout(fxSaveTimer);
  fxSaveTimer = setTimeout(() => act('effect.save', { effect: fx }), 150);
}
function renderFxEditor() {
  const fx = effectById(S.fxPick);
  const box = $('#fxEditor');
  $('#fxCopy').hidden = !fx;
  $('#fxDelete').hidden = !fx || fx.builtin;
  if (!fx) { box.replaceChildren(h('p', { className: 'hint' }, 'Pick an effect to see how it is built.')); return; }
  $('#fxEdTitle').textContent = fx.builtin ? `${fx.name} (built-in)` : `Edit: ${fx.name}`;
  const draft = JSON.parse(JSON.stringify(fx));
  const ro = !!fx.builtin;
  const field = (label, input) => h('label', {}, label, input);
  const numIn = (val, onv, attrs = {}) => {
    const i = h('input', { type: 'number', value: val, disabled: ro, ...attrs });
    i.addEventListener('change', () => { onv(Number(i.value)); saveDraft(draft); });
    return i;
  };
  const selIn = (val, opts, onv) => {
    const i = h('select', { disabled: ro }, ...opts.map(([v, l]) => h('option', { value: v, selected: String(v) === String(val) }, l)));
    i.addEventListener('change', () => { onv(i.value); saveDraft(draft); if (i.dataset.rerender) setTimeout(renderFxEditor, 250); });
    return i;
  };
  const name = h('input', { value: draft.name, disabled: ro });
  name.addEventListener('change', () => { draft.name = name.value; saveDraft(draft); });
  const speedType = draft.speed && draft.speed.hz ? 'hz' : 'beats';
  const speedVal = numIn(draft.speed.hz || draft.speed.beats || 1, (v) => { draft.speed = speedType === 'hz' ? { hz: v } : { beats: v }; }, { step: 0.25, min: 0.0625 });
  const speedSel = selIn(speedType, [['beats', 'Beats per cycle'], ['hz', 'Times per second']], (v) => { draft.speed = v === 'hz' ? { hz: 2 } : { beats: 2 }; });
  speedSel.dataset.rerender = '1';

  const layers = draft.layers.map((l, li) => {
    const attrSel = selIn(l.attr, Object.entries(FXM.ATTRS), (v) => { l.attr = v; if (v === 'dim') l.mode = 'scale'; else if (v === 'pan' || v === 'tilt') l.mode = 'rel'; else l.mode = 'abs'; });
    attrSel.dataset.rerender = '1';
    const isColor = l.attr === 'color' || l.attr === 'hue' || l.attr === 'palette';
    const modes = l.attr === 'dim' ? [['scale', 'Scale planned level'], ['abs', 'Exact level']] : isColor ? [['abs', '—']] : [['rel', 'Around planned position'], ['abs', 'Exact values']];
    const pctIn = (k, label) => field(label, numIn(Math.round((l[k] ?? 0) * 100), (v) => { l[k] = Math.max(0, Math.min(100, v)) / 100; }, { min: 0, max: 100, step: 1 }));
    const rows = [
      h('div', { className: 'row' }, field('Moves', attrSel), field('Wave', selIn(l.wave, Object.entries(FXM.WAVES), (v) => { l.wave = v; })),
        !isColor ? field('Mode', selIn(l.mode, modes, (v) => { l.mode = v; })) : null),
      h('div', { className: 'row' },
        l.attr === 'color' ? field('Colour A', colorPick(l, 'colorA', ro, draft)) : l.attr === 'palette' ? field('Blend', selIn(l.smooth ? '1' : '0', [['0', 'Steps (P, S, T)'], ['1', 'Smooth fade']], (v) => { l.smooth = v === '1'; })) : pctIn('low', l.mode === 'rel' ? 'From %' : 'Low %'),
        l.attr === 'color' ? field('Colour B', colorPick(l, 'colorB', ro, draft)) : l.attr === 'palette' ? null : pctIn('high', l.mode === 'rel' ? 'To % (size)' : 'High %'),
        pctIn('width', 'Width % (0 = auto)'),
        field('Speed ×', numIn(l.speed ?? 1, (v) => { l.speed = v; }, { step: 0.5, min: 0.125 })),
        field('Offset °', numIn(l.offset ?? 0, (v) => { l.offset = v; }, { step: 15 }))),
    ];
    if (!ro && draft.layers.length > 1) rows.push(h('button', { className: 'btn small warn', onclick: () => { draft.layers.splice(li, 1); saveDraft(draft); setTimeout(renderFxEditor, 250); } }, 'Remove layer'));
    return h('div', { className: 'layer' }, h('div', { className: 'label' }, `Layer ${li + 1}`), ...rows);
  });

  const canvas = h('canvas', { width: 600, height: 70 });
  S.previewCanvas = canvas;
  box.replaceChildren(
    h('fieldset', { disabled: ro, style: { border: 0, padding: 0, margin: 0 } },
      h('div', { className: 'row' }, field('Name', name), field('Type', selIn(draft.cat, Object.entries(CAT_NAMES), (v) => { draft.cat = v; }))),
      h('div', { className: 'row' }, field('Speed', speedSel), field(speedType === 'hz' ? 'Hz' : 'Beats', speedVal),
        field('Direction', selIn(draft.dir || 1, [[1, 'Forward'], [-1, 'Backward']], (v) => { draft.dir = Number(v); }))),
      h('div', { className: 'label', style: { marginTop: '6px' } }, 'Phase: how the effect spreads over the selected lights'),
      h('div', { className: 'row' },
        field('Phase from °', numIn(draft.phaseFrom ?? 0, (v) => { draft.phaseFrom = v; }, { step: 15 })),
        field('Phase to °', numIn(draft.phaseTo ?? 0, (v) => { draft.phaseTo = v; }, { step: 15 })),
        field('Groups', numIn(draft.groups || 1, (v) => { draft.groups = v; }, { min: 1, step: 1 })),
        field('Wings', numIn(draft.wings || 1, (v) => { draft.wings = v; }, { min: 1, step: 1 }))),
      h('div', { className: 'row wrap', style: { gap: '6px' } }, ...[['All together', 0, 0], ['Spread 360°', 0, 360], ['Half (odd/even)', 0, 180], ['Mirror', 0, 360, 2]].map(([l, a, b, w]) =>
        h('button', { type: 'button', className: 'btn small', onclick: () => { draft.phaseFrom = a; draft.phaseTo = b; draft.wings = w || 1; saveDraft(draft); setTimeout(renderFxEditor, 250); } }, l)))),
    h('div', { className: 'phasebox' }, h('div', { className: 'hint', style: { margin: '0 0 4px' } }, `Preview over ${Math.max(S.sel.size, 8)} lights (bars = first layer)`), canvas),
    ...layers,
    ro ? h('p', { className: 'hint' }, 'Built-in effects cannot be changed. Tap "Copy to edit" to make your own version.') :
      h('button', { className: 'btn small', onclick: () => { draft.layers.push({ attr: 'dim', mode: 'scale', wave: 'sine', low: 0, high: 1, width: 0, speed: 1, offset: 0 }); saveDraft(draft); setTimeout(renderFxEditor, 250); } }, '+ Layer'));
  S.previewFx = draft;
}
$('#fxNew').onclick = async () => {
  const name = await ask('Name for the new effect');
  if (name === null) return;
  const cat = S.fxCat === 'custom' ? 'dim' : S.fxCat;
  const layer = cat === 'position' ? { attr: 'pan', mode: 'rel', wave: 'sine', low: 0, high: 0.2 } : cat === 'color' ? { attr: 'hue', wave: 'saw' } : cat === 'beam' ? { attr: 'zoom', wave: 'sine', low: 0.2, high: 0.8 } : { attr: 'dim', mode: 'scale', wave: 'sine' };
  const r = await act('effect.save', { effect: { name: name || 'My effect', cat, speed: { beats: 2 }, phaseTo: 360, layers: [layer] } });
  if (r) { S.fxPick = r.id; S.fxCat = 'custom'; for (const x of $$('#fxCats button')) x.classList.toggle('on', x.dataset.cat === 'custom'); renderFx(); }
};
$('#fxCopy').onclick = async () => {
  const fx = effectById(S.fxPick);
  if (!fx) return;
  const copy = { ...JSON.parse(JSON.stringify(fx)), id: undefined, builtin: undefined, name: `${fx.name} copy` };
  const r = await act('effect.save', { effect: copy });
  if (r) { S.fxPick = r.id; S.fxCat = 'custom'; for (const x of $$('#fxCats button')) x.classList.toggle('on', x.dataset.cat === 'custom'); renderFx(); toast('Copied. Change it below; it saves as you go.'); }
};
$('#fxDelete').onclick = () => {
  const fx = effectById(S.fxPick);
  if (fx && !fx.builtin && confirm(`Delete effect "${fx.name}"?`)) act('effect.delete', { id: fx.id }).then(() => { S.fxPick = 'pulse'; renderFx(); });
};

// Animated phase preview
(() => {
  let beats = 0, last = performance.now();
  const frame = (now) => {
    requestAnimationFrame(frame);
    const dt = (now - last) / 1000;
    last = now;
    beats += dt * ((S.runtime && S.runtime.bpm) || 120) / 60;
    const c = S.previewCanvas, fx = S.previewFx;
    if (!c || !fx || S.tab !== 'fx' || !c.isConnected) return;
    const ctx = c.getContext('2d');
    const W = (c.width = c.clientWidth * (window.devicePixelRatio || 1));
    const H = (c.height = 70 * (window.devicePixelRatio || 1));
    ctx.clearRect(0, 0, W, H);
    const n = Math.max(S.sel.size, 8);
    const cycles = FXM.cyclesAt(fx, beats, now / 1000, 1);
    const bw = W / n;
    for (let i = 0; i < n; i++) {
      const r = FXM.evaluate(fx, i, n, cycles)[0];
      if (!r) continue;
      let color = '#f2b33d';
      if (r.layer.attr === 'hue') { const [R, G, B] = FXM.hsvToRgb(((r.value % 1) + 1) % 1, 1, 1); color = `rgb(${R * 255},${G * 255},${B * 255})`; }
      if (r.layer.attr === 'color') { const a = tokenRgb(r.layer.colorA), b = tokenRgb(r.layer.colorB); color = `rgb(${a.map((v, k) => (v + (b[k] - v) * r.w) * 255).join(',')})`; }
      if (r.layer.attr === 'palette') { const x = (((r.value % 1) + 1) % 1) * 3, i0 = Math.floor(x) % 3; const a = tokenRgb(`pal:${i0 + 1}`), b = tokenRgb(`pal:${((i0 + 1) % 3) + 1}`); const f = r.layer.smooth ? x - Math.floor(x) : 0; color = `rgb(${a.map((v, k) => (v + (b[k] - v) * f) * 255).join(',')})`; }
      const v = r.layer.attr === 'hue' || r.layer.attr === 'color' || r.layer.attr === 'palette' ? 1 : r.layer.mode === 'rel' ? r.w : r.value;
      const bh = Math.max(2, v * (H - 8));
      ctx.fillStyle = color;
      ctx.fillRect(i * bw + 3, H - 4 - bh, bw - 6, bh);
    }
  };
  requestAnimationFrame(frame);
})();

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
      const r = await fetch(`/api/upload/audio?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
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

// ----- selection tricks ---------------------------------------------------------
function tricksOn() {
  const t = (S.runtime && S.runtime.tricks) || {};
  return t.active !== false && Object.entries(t).some(([k, v]) => k !== 'active' && (k === 'order' ? v && v !== 'tap' : FXM.hasValue(v)));
}
function trickPosClient(id) {
  const f = fixById(id);
  if (!f) return { x: 0, y: 0, z: 0 };
  return window.Geom.placement(f, S.show.stage3d.stage).pos;
}
// Small top-down dial showing the sweep direction (drag or tap to turn)
function dirDial(t) {
  const c = h('canvas', { width: 120, height: 120, className: 'dirdial', title: 'Tap to point the sweep (top = back of the stage)' });
  const draw = () => {
    const g = c.getContext('2d');
    g.clearRect(0, 0, 120, 120);
    g.strokeStyle = '#3d4556'; g.lineWidth = 2;
    g.beginPath(); g.arc(60, 60, 50, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#8b93a5'; g.font = '10px sans-serif'; g.textAlign = 'center';
    g.fillText('BACK', 60, 18); g.fillText('AUDIENCE', 60, 110);
    const a = ((Number(t.turn) || 0) * Math.PI) / 180;
    const len = 40 * Math.cos(((Number(t.tilt) || 0) * Math.PI) / 180);
    const x = 60 + Math.cos(a) * len, y = 60 - Math.sin(a) * len;
    g.strokeStyle = '#f2b33d'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(60 - (x - 60), 60 - (y - 60)); g.lineTo(x, y); g.stroke();
    g.fillStyle = '#f2b33d'; g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fill();
  };
  draw();
  c.addEventListener('pointerdown', (e) => {
    const r = c.getBoundingClientRect();
    const dx = (e.clientX - r.left) / r.width * 120 - 60, dy = 60 - (e.clientY - r.top) / r.height * 120;
    const turn = Math.round(((Math.atan2(dy, dx) * 180) / Math.PI) / 15) * 15;
    setTricks({ turn });
  });
  return c;
}

// The selection after tricks: [{ id, i (order), k (step), m (steps), active }]
function trickView() {
  const ids = [...S.sel];
  const t = S.runtime.tricks || {};
  if (!tricksOn()) return ids.map((id, i) => ({ id, i, k: i, m: ids.length, active: true }));
  const ord = FXM.trickOrder(ids, t, trickPosClient);
  const steps = FXM.trickSteps(ord.length, t);
  const act = FXM.trickActive(ord.length, t);
  const fr = FXM.trickFractions(ord, t, trickPosClient);
  return ord.map((id, i) => ({ id, i, ...steps[i], ...(fr ? { f: fr[i] } : {}), active: act.active(i) }));
}
// Lights that programming applies to: the active part of the selection, in trick order.
function effSel() {
  return trickView().filter((x) => x.active).map((x) => x.id);
}

const setTricks = (patch) => act('tricks.set', { tricks: patch });
function stepper(key, label, opts = {}) {
  const t = S.runtime.tricks || {};
  const inp = h('input', { type: 'number', value: FXM.hasValue(t[key]) ? t[key] : '', placeholder: opts.none || '—', step: opts.step || 1, 'aria-label': label });
  inp.addEventListener('change', () => setTricks({ [key]: inp.value === '' ? null : Number(inp.value) }));
  const bump = (d) => {
    const cur = FXM.hasValue(t[key]) ? Number(t[key]) : opts.start ?? 0;
    let next = +(cur + d * (opts.step || 1)).toFixed(3);
    if (opts.min !== undefined && next < opts.min) next = null;
    setTricks({ [key]: next });
  };
  return h('div', { className: `stepper${FXM.hasValue(t[key]) ? ' set' : ''}` },
    h('span', { className: 'st-label' }, label),
    h('div', { className: 'st-row' },
      h('button', { type: 'button', className: 'btn', onclick: () => bump(-1) }, '−'), inp,
      h('button', { type: 'button', className: 'btn', onclick: () => bump(1) }, '+')));
}
function renderTricks() {
  const box = $('#tricksBox');
  if (!box || box.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
  const t = S.runtime.tricks || {};
  const on = t.active !== false;
  const view = trickView();
  const parts = FXM.hasValue(t.width) ? Math.ceil(Math.max(1, view.length) / t.width) : 0;
  const order = h('select', { onchange: (e) => setTricks({ order: e.target.value }) },
    ...[['tap', 'Tap order'], ['left-right', 'Left → right'], ['right-left', 'Right → left'], ['front-back', 'Front → back'], ['back-front', 'Back → front'], ['low-high', 'Low → high'], ['high-low', 'High → low'], ['centre-out', 'Centre → out'], ['outside-in', 'Outside → in'], ['direction', '3D direction (turn / tilt)…']]
      .map(([v, l]) => h('option', { value: v, selected: (t.order || 'tap') === v }, l)));
  const pair = (label, kf, kt, opts) => h('div', { className: 'pairrow' }, h('span', {}, label), stepper(kf, 'From', opts), h('span', { className: 'arrow' }, '→'), stepper(kt, 'To', opts));
  const fanAttr = h('select', {}, ...[['dim', 'Intensity'], ['pan', 'Pan'], ['tilt', 'Tilt'], ['zoom', 'Zoom']].map(([v, l]) => h('option', { value: v }, l)));
  const fanFrom = h('input', { type: 'number', min: 0, max: 100, value: 0 });
  const fanTo = h('input', { type: 'number', min: 0, max: 100, value: 100 });
  box.replaceChildren(
    h('div', { className: 'tr-head' },
      h('button', { className: `btn small${on ? ' primary' : ''}`, onclick: () => setTricks({ active: !on }), title: 'Switch all tricks on/off without losing them' }, on ? 'Tricks on' : 'Tricks off'),
      h('button', { className: 'btn small', onclick: () => act('tricks.shuffle') }, 'Shuffle'),
      FXM.hasValue(t.shuffle) ? h('button', { className: 'btn small', onclick: () => setTricks({ shuffle: null }) }, 'Unshuffle') : null,
      h('button', { className: 'btn small warn', onclick: () => act('tricks.reset') }, 'Reset')),
    h('div', { className: `tr-body${on ? '' : ' off'}` },
      h('div', { className: 'tr-sec' }, h('div', { className: 'label' }, 'Order'),
        h('div', { className: 'tr-grid' }, h('label', { className: 'st-label tr-sel' }, 'Sort', order), stepper('shift', 'Shift', { start: 0 })),
        t.order === 'direction' ? h('div', { className: 'tr-grid', style: { marginTop: '6px' } },
          stepper('turn', 'Turn ° (0 = L→R, 90 = front→back)', { step: 15, start: 0 }),
          stepper('tilt', 'Tilt ° (90 = floor→ceiling)', { step: 15, start: 0 }),
          h('div', { className: 'stepper' }, h('span', { className: 'st-label' }, 'Direction'), dirDial(t))) : null,
        t.order && t.order !== 'tap' ? h('label', { className: 'check plain', style: { marginTop: '6px', display: 'flex', gap: '6px', alignItems: 'center', fontSize: '13px' } },
          h('input', { type: 'checkbox', checked: !!t.spatial, onchange: (e) => setTricks({ spatial: e.target.checked }) }),
          'Spread by distance (uneven spacing = uneven timing, like a real wave)') : null),
      h('div', { className: 'tr-sec' }, h('div', { className: 'label' }, 'Pattern'),
        h('div', { className: 'tr-grid' }, stepper('block', 'Block', { min: 2, start: 1 }), stepper('groups', 'Groups', { min: 2, start: 1 }), stepper('wings', 'Wings', { min: 2, start: 1 }))),
      h('div', { className: 'tr-sec' }, h('div', { className: 'label' }, 'Parts'),
        h('div', { className: 'tr-grid' }, stepper('width', 'Width', { min: 1, start: 0 }),
          h('div', { className: 'stepper' }, h('span', { className: 'st-label' }, 'Active part'),
            h('div', { className: 'st-row' },
              h('button', { className: 'btn', disabled: !parts, onclick: () => act('tricks.part', { n: view.length, dir: -1 }) }, '◀'),
              h('span', { className: 'partlbl' }, parts ? (t.part ? `${t.part} / ${parts}` : `All ${parts}`) : '—'),
              h('button', { className: 'btn', disabled: !parts, onclick: () => act('tricks.part', { n: view.length, dir: 1 }) }, '▶'),
              h('button', { className: 'btn', disabled: !parts || !t.part, onclick: () => act('tricks.part', { n: view.length, all: true }) }, 'All'))))),
      h('div', { className: 'tr-sec' }, h('div', { className: 'label' }, 'Spread over the lights (From → To)'),
        pair('Phase °', 'phaseFrom', 'phaseTo', { step: 45 }),
        pair('Speed ×', 'speedFrom', 'speedTo', { step: 0.25, min: 0.125, start: 1 }),
        pair('Fade s', 'fadeFrom', 'fadeTo', { step: 0.5, min: 0 }),
        pair('Delay s', 'delayFrom', 'delayTo', { step: 0.25, min: 0 })),
      h('div', { className: 'tr-sec' }, h('div', { className: 'label' }, 'Spread a value now'),
        h('div', { className: 'row fanrow' }, fanAttr, h('label', {}, 'From %', fanFrom), h('label', {}, 'To %', fanTo),
          h('button', { className: 'btn small primary', onclick: () => {
            if (!S.sel.size) return toast('Select lights first', true);
            act('prog.fan', { fixtures: effSel(), attr: fanAttr.value, from: fanFrom.value / 100, to: fanTo.value / 100 });
          } }, 'Apply')))),
    h('p', { className: 'hint' }, 'Tricks work on the current selection. Phase and Speed shape effects you run on it. Fade and Delay are saved into the next cue or look you record, so the lights change one after another. Width splits the selection into parts: programming then goes to the active part only.'));
}

// ----- Palette: primary / secondary / tertiary -------------------------------------
const PAL_LABELS = ['Primary', 'Secondary', 'Tertiary'];
function tokenRgb(tok) {
  const m = /^pal:([123])$/.exec(tok || '');
  const hex = m ? ((S.runtime && S.runtime.palette) || [])[m[1] - 1] || '#ffffff' : tok;
  return FXM.hexToRgb(hex);
}
function colorPick(l, key, ro, draft) {
  const isPal = /^pal:/.test(l[key] || '');
  const sel = h('select', { disabled: ro }, ...PAL_LABELS.map((n, i) => h('option', { value: `pal:${i + 1}`, selected: l[key] === `pal:${i + 1}` }, n)), h('option', { value: 'custom', selected: !isPal }, 'Custom…'));
  const pick = h('input', { type: 'color', value: isPal ? '#ffffff' : l[key], disabled: ro, hidden: isPal });
  sel.addEventListener('change', () => {
    l[key] = sel.value === 'custom' ? pick.value : sel.value;
    pick.hidden = sel.value !== 'custom';
    saveDraft(draft);
  });
  pick.addEventListener('change', () => { l[key] = pick.value; saveDraft(draft); });
  return h('div', { className: 'colsel' }, sel, pick);
}
function renderPalette() {
  if (!S.show || !S.runtime.palette) return;
  const box = $('#palBar');
  const pal = S.runtime.palette;
  const live = S.runtime.paletteLive || {};
  const song = S.show.songs.find((x) => x.id === S.runtime.songId);
  const sig = JSON.stringify([pal, live, song && song.id, S.runtime.paletteSource]);
  if (sig !== box.dataset.sig && !box.contains(document.activeElement)) {
    box.dataset.sig = sig;
    box.replaceChildren(
      ...pal.map((c, i) => {
        const inp = h('input', { type: 'color', value: c, title: `${PAL_LABELS[i]} colour${song ? ` of "${song.name}"` : ' (default)'}` });
        inp.addEventListener('input', () => actThrottled(`pal${i}`, 'palette.set', { index: i, color: inp.value, scope: 'live' }));
        inp.addEventListener('change', () => act('palette.set', { index: i, color: inp.value }));
        return h('label', { className: `palsw${live[i] ? ' live' : ''}`, style: { background: c } }, inp, h('b', {}, ['P', 'S', 'T'][i]));
      }),
      h('span', { className: 'lbl' }, song ? (S.runtime.paletteSource === 'song' ? `${song.name} colours` : 'Default colours') : 'Default colours',
        song && S.runtime.paletteSource === 'song' ? h('button', { className: 'btn small', style: { padding: '0 4px', marginLeft: '4px', fontSize: '10px' }, title: 'Use the default colours for this song', onclick: () => act('palette.reset') }, '↺') : null));
  }
  renderProgSwatches();
}
function renderOscStatus() {
  const el = $('#oscStatus');
  if (!el || !S.show) return;
  const o = S.oscConn;
  const last = S.runtime.lastOsc;
  const port = (S.show.settings.osc && S.show.settings.osc.port) || 8000;
  el.replaceChildren(
    o && o.listening ? h('span', { style: { color: 'var(--go-hi)' } }, `● Listening on UDP ${port}`) : h('span', { style: { color: '#ff8a80' } }, o && o.error ? `● ${o.error}` : '● Off'),
    last ? ` · last: ${last.address}${last.args && last.args.length ? ` ${last.args.map((x) => JSON.stringify(x)).join(' ')}` : ''} → ${last.result}` : '');
}

// ----- ProPresenter ---------------------------------------------------------------
function renderPpStatus() {
  const el = $('#ppStatus');
  if (!el || !S.show) return;
  const pp = S.show.settings.pp || {};
  const c = S.ppConn;
  const live = S.runtime.pp;
  if (!pp.enabled) { el.textContent = 'Off.'; return; }
  el.replaceChildren(
    c && c.connected ? h('span', { style: { color: 'var(--go-hi)' } }, '● Connected') : h('span', { style: { color: '#ff8a80' } }, `● Not connected${c && c.error ? `: ${c.error}` : ''}`),
    live && live.presentation ? ` · ${live.presentation.name}${live.group ? ` · ${live.group}` : ''}${live.result ? ` → ${live.result}` : ''}` : '',
    live && live.presentation ? h('button', { type: 'button', className: 'btn small', style: { marginLeft: '8px' }, title: 'Make a song with this name and one section per group', onclick: () => act('pp.importSong').then((r) => r && toast(`Song "${live.presentation.name}" ready. Pick looks for its sections on the Songs tab.`)) }, 'Make song from this presentation') : null);
}

// The live slide image: shown on the 3D screens, and (if chosen) its colour is sent to the lights.
// Only the desktop app window or the audio computer does the colour maths, so it happens once.
const isColorWorker = () => /[?&]app=1/.test(location.search) || isHost() || lsGet('ppColorWorker') === '1';
let lastSlideKey = '';
function ppSlideChanged() {
  const live = S.runtime.pp;
  const pp = S.show && S.show.settings.pp;
  if (!live || !live.presentation || !live.presentation.uuid || !pp || !pp.enabled) {
    if (stage3d) stage3d.setSlide(null);
    return;
  }
  const key = `${live.presentation.uuid}|${live.index}`;
  if (key === lastSlideKey) return;
  lastSlideKey = key;
  const url = `/api/pp/thumb?uuid=${encodeURIComponent(live.presentation.uuid)}&index=${live.index}&q=480`;
  if (stage3d) stage3d.setSlide(url);
  if (pp.colorMode === 'slide' && isColorWorker()) slideColor(url).then((rgb) => rgb && act('pp.color', { rgb, key })).catch(() => {});
}
// Strong colours count more than greys, black and white (text on a dark background stays out of it).
function slideColor(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = 48; c.height = 27;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0, 48, 27);
      const d = g.getImageData(0, 0, 48, 27).data;
      let r = 0, gr = 0, b = 0, wsum = 0;
      for (let i = 0; i < d.length; i += 4) {
        const R = d[i] / 255, G = d[i + 1] / 255, B = d[i + 2] / 255;
        const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
        const sat = mx ? (mx - mn) / mx : 0;
        const w = sat * sat * mx + 0.002;
        r += R * w; gr += G * w; b += B * w; wsum += w;
      }
      let rgb = [r / wsum, gr / wsum, b / wsum];
      const mx = Math.max(...rgb);
      const mn = Math.min(...rgb);
      if (mx < 0.08 || (mx - mn) / mx < 0.12) return resolve([1, 1, 1]); // no real colour on screen: open white
      rgb = rgb.map((v) => v / mx); // full brightness, keep the hue
      resolve(rgb.map((v) => Math.round(v * 1000) / 1000));
    };
    img.onerror = reject;
    img.src = url;
  });
}

// ----- screens in the 3D setup ----------------------------------------------------
S.screenSel = null;
function renderScreens() {
  const st = S.show.stage3d;
  const list = st.screens || [];
  const box = $('#screenList');
  if (!box || (box.contains(document.activeElement) && document.activeElement.tagName === 'INPUT')) return;
  const update = (id, patch) => act('stage3d.set', { screens: list.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
  box.replaceChildren(...list.map((sc) => {
    const num = (k, label, step = 0.1) => {
      const i = h('input', { type: 'number', step, value: Math.round((sc[k] || 0) * 100) / 100 });
      i.addEventListener('change', () => update(sc.id, { [k]: Number(i.value) }));
      return h('label', { className: 'mini3' }, label, i);
    };
    return h('div', { className: `modelrow${S.screenSel === sc.id ? ' selscreen' : ''}` },
      h('div', { className: 'row' },
        h('input', { className: 'nm', value: sc.name, style: { flex: 1 }, onchange: (e) => update(sc.id, { name: e.target.value }) }),
        h('button', { className: 'btn small', onclick: () => { S.screenSel = S.screenSel === sc.id ? null : sc.id; stage3d && stage3d.selectScreen(S.screenSel); renderScreens(); } }, S.screenSel === sc.id ? 'Done' : 'Move'),
        h('button', { className: 'btn small warn', onclick: () => act('stage3d.set', { screens: list.filter((x) => x.id !== sc.id) }) }, '✕')),
      h('div', { className: 'row' }, num('x', 'Left/right'), num('y', 'Height (centre)'), num('z', 'Front/back')),
      h('div', { className: 'row' }, num('w', 'Width m'), num('h', 'Height m'), num('rotY', 'Turn °', 5), num('rotX', 'Tilt °', 5)),
      h('div', { className: 'row' },
        h('label', { className: 'check plain', style: { display: 'flex', gap: '6px', alignItems: 'center', fontSize: '12px' } }, h('input', { type: 'checkbox', checked: sc.protect !== false, onchange: (e) => update(sc.id, { protect: e.target.checked }) }), 'Keep light off it'),
        h('label', { className: 'check plain', style: { display: 'flex', gap: '6px', alignItems: 'center', fontSize: '12px' } }, h('input', { type: 'checkbox', checked: sc.slides !== false, onchange: (e) => update(sc.id, { slides: e.target.checked }) }), 'Show slides')));
  }));
}
function addScreen(kind) {
  const st = S.show.stage3d;
  const back = -st.stage.d + 0.05;
  const list = st.screens || [];
  const side = list.length % 2 ? 1 : -1;
  const sc = kind === 'led'
    ? { name: `LED wall ${list.length + 1}`, kind: 'led', x: 0, y: Math.round((st.stage.h + 2.2) * 100) / 100, z: Math.round(back * 100) / 100, w: 6, h: 3.375 }
    : { name: `Screen ${list.length + 1}`, kind: 'projector', x: list.length ? side * (st.stage.w / 2 + 1.5) : 0, y: 3.5, z: list.length ? -st.stage.d / 2 : back, w: 4, h: 2.25, rotY: list.length ? -side * 20 : 0 };
  act('stage3d.set', { screens: [...list, sc] });
}
$('#addScreen').onclick = () => addScreen('projector');
$('#addLed').onclick = () => addScreen('led');
function updateScreenWarn() {
  const el = $('#screenWarn');
  if (!el || !S.show) return;
  const hit = Object.entries(S.live.fixtures || {}).filter(([, l]) => l.x).map(([id]) => (fixById(id) || {}).name).filter(Boolean);
  const mode = S.show.settings.screenProtect || 'warn';
  el.textContent = hit.length && mode !== 'off' ? `${mode === 'block' ? 'Switched off' : 'Shining on a screen'}: ${hit.join(', ')}` : '';
}

// ----- 3D -----------------------------------------------------------------------
let stage3d = null;
let no3d = null;
S.patchSel = null;
try { S.view3d = localStorage.getItem('view3d') === '1'; } catch { S.view3d = false; }
function get3d() {
  if (stage3d || no3d) return stage3d;
  try {
    stage3d = new Stage3D();
    stage3d.onSelect = (id, add) => {
      if (S.tab === 'patch') {
        S.patchSel = id;
        if (id && S.screenSel) { S.screenSel = null; stage3d.selectScreen(null); renderScreens(); }
        stage3d.setSelection(id ? [id] : []);
        renderSel3d();
      } else if (S.tab === 'program' && id) {
        toggleSel(id);
      }
    };
    stage3d.onMove = (id, pos) => act('fixture.edit', { id, pos3d: pos }).then(renderSel3d);
    stage3d.onError = (m) => toast(m, true);
    stage3d.onSelectScreen = (id) => { S.screenSel = id; stage3d.selectScreen(id); renderScreens(); };
    stage3d.onMoveScreen = (id, p) => act('stage3d.set', { screens: S.show.stage3d.screens.map((x) => (x.id === id ? { ...x, x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2) } : x)) });
    if (S.show) {
      stage3d.setShow(S.show, S.profiles);
      stage3d.setLive(S.live.fixtures);
      lastSlideKey = '';
      ppSlideChanged();
    }
  } catch (e) {
    console.error(e);
    no3d = 'This browser cannot show 3D (WebGL is turned off or not supported).';
  }
  return stage3d;
}
function tools3d(el) {
  if (el.querySelector('.tools3d')) return;
  const views = [['front', 'Front'], ['foh', 'FOH'], ['top', 'Top'], ['side', 'Side']];
  const work = h('button', { className: 'btn', title: 'Room light, to see the stage while setting up' }, 'Work light');
  const haze = h('input', { type: 'range', min: 0, max: 100, value: Math.round((stage3d ? stage3d.haze : 0.35) * 100) });
  haze.addEventListener('input', () => stage3d && stage3d.setHaze(haze.value / 100));
  work.onclick = () => {
    S.work = !S.work;
    stage3d && stage3d.setWorkLight(S.work);
    for (const b of $$('.tools3d .work')) b.classList.toggle('on', S.work);
  };
  work.classList.add('work');
  el.append(h('div', { className: 'tools3d' }, ...views.map(([k, l]) => h('button', { className: 'btn', onclick: () => stage3d && stage3d.view(k) }, l)), work, h('label', {}, 'Haze', haze)));
}
function place3d() {
  document.body.classList.toggle('v3d', !!S.view3d);
  for (const b of $$('.viewseg button')) b.classList.toggle('on', (b.dataset.view === '3d') === !!S.view3d);
  const target = S.tab === 'patch' ? ['#patch3d', 'edit'] : S.view3d && S.tab === 'live' ? ['#live3d', 'view'] : S.view3d && S.tab === 'program' ? ['#prog3d', 'select'] : null;
  if (!target) return;
  const el = $(target[0]);
  const s3 = get3d();
  if (!s3) {
    el.replaceChildren(h('div', { className: 'no3d' }, no3d));
    return;
  }
  s3.attach(el, target[1]);
  tools3d(el);
  s3.setSelection(target[1] === 'edit' ? (S.patchSel ? [S.patchSel] : []) : target[1] === 'select' ? [...S.sel] : []);
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('.viewseg button');
  if (!b) return;
  S.view3d = b.dataset.view === '3d';
  try { localStorage.setItem('view3d', S.view3d ? '1' : ''); } catch {}
  place3d();
});

function vecInputs(label, v, onChange) {
  const mk = (k, name) => {
    const inp = h('input', { type: 'number', step: 0.1, value: v ? v[k] : '' });
    inp.addEventListener('change', () => {
      const next = { ...v, [k]: Number(inp.value) };
      onChange(next);
    });
    return h('label', { className: 'mini3' }, name, inp);
  };
  return [h('div', { className: 'hint', style: { margin: '6px 0 2px' } }, label), h('div', { className: 'row' }, mk('x', 'Left/right'), mk('y', 'Height'), mk('z', 'Front/back'))];
}
function renderSel3d() {
  const box = $('#sel3d');
  const f = S.patchSel && fixById(S.patchSel);
  if (!f) {
    box.replaceChildren(h('h3', {}, 'Selected light'), h('p', { className: 'hint' }, 'Tap a light in the 3D view to place it. Drag its arrows to move it, or type the position. Lights not placed yet hang at 6 m in their 2D layout positions.'));
    return;
  }
  const s3 = stage3d;
  const pos = f.pos3d || (s3 ? s3.defaultPos(f) : { x: 0, y: 6, z: 0 });
  const aim = f.aim || (s3 ? s3.defaultAim(f, pos) : { x: 0, y: 0, z: 0 });
  const round = (v) => ({ x: +v.x.toFixed(2), y: +v.y.toFixed(2), z: +v.z.toFixed(2) });
  const beam = h('input', { type: 'number', min: 2, max: 90, value: f.beam || 25 });
  beam.addEventListener('change', () => act('fixture.edit', { id: f.id, beam: beam.value }));
  const st = S.show.stage3d.stage;
  box.replaceChildren(
    h('h3', {}, f.name),
    ...vecInputs('Position (metres)', round(pos), (p) => act('fixture.edit', { id: f.id, pos3d: p })),
    ...vecInputs('Aimed at', round(aim), (a) => act('fixture.edit', { id: f.id, aim: a, pos3d: f.pos3d || pos })),
    h('div', { className: 'row', style: { marginTop: '8px' } }, h('label', { className: 'mini3' }, 'Beam angle (°)', beam)),
    h('div', { className: 'row wrap', style: { marginTop: '10px' } },
      h('button', { className: 'btn small primary', onclick: () => {
        if (!stage3d) return;
        toast('Now tap where this light should point');
        stage3d.startAim(f.id, (id, p) => act('fixture.edit', { id, aim: p, pos3d: f.pos3d || pos }).then(renderSel3d));
      } }, 'Aim: tap the stage'),
      h('button', { className: 'btn small', onclick: () => act('fixture.edit', { id: f.id, pos3d: pos, aim: { x: pos.x, y: Math.min(pos.y - 1, st.h), z: pos.z } }).then(renderSel3d) }, 'Straight down'),
      h('button', { className: 'btn small', onclick: () => act('fixture.edit', { id: f.id, pos3d: pos, aim: { x: 0, y: st.h + 1.5, z: -st.d / 2 } }).then(renderSel3d) }, 'Centre stage')));
}

const UNITS = [['1', 'metres'], ['0.01', 'centimetres'], ['0.001', 'millimetres'], ['0.0254', 'inches'], ['0.3048', 'feet']];
function renderSetup3d() {
  const st = S.show.stage3d;
  for (const inp of $$('#stageSize input')) if (document.activeElement !== inp) inp.value = st.stage[inp.dataset.k];
  const models = st.models;
  const update = (i, patch) => act('stage3d.set', { models: models.map((m, j) => (j === i ? { ...m, ...patch } : m)) });
  const remove = (i) => act('stage3d.set', { models: models.filter((_, j) => j !== i) });
  const list = $('#modelList');
  if (!models.length) list.replaceChildren(h('p', { className: 'hint' }, 'No models yet: the simple stage block is shown.'));
  else {
    const mvrCount = models.filter((m) => m.matrix).length;
    const rows = [];
    if (mvrCount) rows.push(h('div', { className: 'modelrow' }, h('div', { className: 'row' }, h('span', { className: 'nm', style: { flex: 1 } }, `${mvrCount} object${mvrCount === 1 ? '' : 's'} from MVR`),
      h('button', { className: 'btn small warn', onclick: () => confirm('Remove the MVR stage geometry?') && act('stage3d.set', { models: models.filter((m) => !m.matrix) }) }, '✕'))));
    models.forEach((m, i) => {
      if (m.matrix) return;
      const num = (k, label, step = 0.1) => {
        const inp = h('input', { type: 'number', step, value: m[k] ?? 0 });
        inp.addEventListener('change', () => update(i, { [k]: Number(inp.value) }));
        return h('label', { className: 'mini3' }, label, inp);
      };
      const up = h('select', { onchange: (e) => update(i, { rotX: Number(e.target.value) }) },
        ...[[0, 'As is'], [-90, 'Z-up → rotate'], [90, 'Rotate other way'], [180, 'Upside down']].map(([v, l]) => h('option', { value: v, selected: (m.rotX || 0) === v }, l)));
      const unit = h('select', { onchange: (e) => update(i, { scale: Number(e.target.value) }) },
        ...UNITS.map(([v, l]) => h('option', { value: v, selected: Math.abs(Number(v) - (m.scale || 1)) < 1e-9 }, l)));
      rows.push(h('div', { className: 'modelrow' },
        h('div', { className: 'row' }, h('span', { className: 'nm', style: { flex: 1 } }, m.name), h('button', { className: 'btn small warn', onclick: () => remove(i) }, '✕')),
        h('div', { className: 'row' }, num('x', 'X'), num('y', 'Y'), num('z', 'Z'), num('rotY', 'Turn °', 15)),
        h('div', { className: 'row' }, h('label', { className: 'mini3' }, 'Units in file', unit), h('label', { className: 'mini3' }, 'Upright', up))));
    });
    list.replaceChildren(...rows);
  }
  renderSel3d();
}
$('#stageSize').addEventListener('change', (e) => {
  const st = { ...S.show.stage3d.stage, [e.target.dataset.k]: Number(e.target.value) };
  act('stage3d.set', { stage: st });
});

async function upload(url, file) {
  toast(`Uploading ${file.name}…`);
  try {
    const r = await fetch(url, { method: 'POST', body: file });
    const j = await r.json();
    if (!j.ok) toast(j.error || 'Upload failed', true);
    return j.ok ? j : null;
  } catch {
    toast('Upload failed', true);
    return null;
  }
}
$('#modelFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const j = await upload(`/api/upload/model?name=${encodeURIComponent(file.name)}`, file);
  if (!j) return;
  const models = [...S.show.stage3d.models, { file: j.file, name: j.name, x: 0, y: 0, z: 0, rotX: 0, rotY: 0, scale: 1 }];
  if (await act('stage3d.set', { models })) toast('Model added. Use "Work light" to see it, and set its units if it looks the wrong size.');
});

function guessProfile(type) {
  const t = type.toLowerCase();
  if (/haze|fog/.test(t)) return 'haze';
  if (/dimmer|fresnel|ellipsoidal|profile|par ?64|conventional|source four|tungsten|house/.test(t)) return 'dimmer';
  if (/moving|mover|head|beam|spot|hybrid/.test(t)) return 'wash';
  return 'drgbw';
}
$('#mvrFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const j = await upload('/api/upload/mvr', file);
  if (!j) return;
  if (!j.fixtures.length && !j.models.length) return toast('No lights or geometry found in that file', true);
  $('#mvrSummary').textContent = `${j.fixtures.length} light${j.fixtures.length === 1 ? '' : 's'} and ${j.models.length} 3D object${j.models.length === 1 ? '' : 's'} found.`;
  $('#mvrTypes').replaceChildren(...j.types.map((t) =>
    h('tr', {}, h('td', {}, t.type), h('td', {}, String(t.count)),
      h('td', {}, h('select', { 'data-type': t.type }, ...profileOptions(guessProfile(t.type)))))));
  const dlg = $('#mvrDialog');
  dlg.returnValue = '';
  dlg.onclose = async () => {
    if (dlg.returnValue !== 'ok') return;
    const map = Object.fromEntries($$('#mvrTypes select').map((s) => [s.dataset.type, s.value]));
    const useModels = $('#mvrModels').checked;
    const res = await act('mvr.apply', {
      fixtures: j.fixtures.map((f) => ({ ...f, profile: map[f.type] })),
      models: useModels ? j.models : undefined,
      replace: $('#mvrReplace').checked,
    });
    if (res) toast(res.skipped.length ? `Imported. ${res.skipped.length} light(s) skipped (address doesn't fit): ${res.skipped.slice(0, 5).join(', ')}` : 'Imported', !!res.skipped.length);
  };
  dlg.showModal();
});

// ----- start ----------------------------------------------------------------
try {
  const t = localStorage.getItem('tab');
  if (t && $(`#tabs button[data-tab="${t}"]`)) $(`#tabs button[data-tab="${t}"]`).click();
} catch {}
connect();
pollDmx();
place3d();
// Re-join as the audio computer after a reload
setTimeout(() => { if (lsGet('audioHost') === '1') becomeHost(true); }, 800);
try {
  if (localStorage.getItem('webMidi')) {
    $('#webMidi').checked = true;
    startWebMidi(true);
  }
} catch {}
