/* Sanctuary Lights – browser UI. Talks to server.js over /api. */
import { Stage3D } from './stage3d.js';

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
  renderSetup3d();
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
  if (e.target.matches('input, select, textarea') || $('#prompt').open) return;
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
$('#swatches').replaceChildren(
  ...SWATCHES.map(([name, hex]) =>
    h('button', { style: { background: hex }, title: name, onclick: () => setColor(hex) }, h('span', {}, name))
  )
);
function setColor(hex) {
  if (!S.sel.size) return toast('Select some lights first', true);
  act('prog.color', { fixtures: [...S.sel], rgb: hexToRgb(hex) });
  // Lights that are off would not show the colour, so bring them up.
  const off = selected().filter((f) => (S.live.fixtures[f.id]?.d ?? 0) === 0 && profOf(f).attrs.includes('dim'));
  if (off.length) act('prog.set', { fixtures: off.map((f) => f.id), values: { dim: 1 } });
}
$('#colorPick').addEventListener('input', (e) => {
  if (!S.sel.size) return;
  actThrottled('color', 'prog.color', { fixtures: [...S.sel], rgb: hexToRgb(e.target.value) });
});

bindFader($('#dim'), (v) => {
  $('#dimVal').textContent = pct(v);
  actThrottled('dim', 'prog.set', { fixtures: [...S.sel], values: { dim: v } });
});
for (const b of $$('[data-dim]')) b.onclick = () => S.sel.size && act('prog.set', { fixtures: [...S.sel], values: { dim: Number(b.dataset.dim) } });
$('#locateBtn').onclick = () => S.sel.size && act('prog.locate', { fixtures: [...S.sel] });
$('#clearSelBtn').onclick = () => S.sel.size && act('prog.clear', { fixtures: [...S.sel] });
$('#clearAllBtn').onclick = () => act('prog.clear');
$('#centerPos').onclick = () => act('prog.set', { fixtures: [...S.sel], values: { pan: 0.5, tilt: 0.5 } });

const COLOR_ATTRS = ['red', 'green', 'blue', 'white', 'amber', 'uv'];
const LABELS = { red: 'Red', green: 'Green', blue: 'Blue', white: 'White', amber: 'Amber', uv: 'UV', zoom: 'Zoom', focus: 'Focus', strobe: 'Strobe', haze: 'Haze', fan: 'Fan' };

function miniSlider(attr) {
  const input = h('input', { type: 'range', min: 0, max: 1000, value: 0 });
  const out = h('b', {}, '—');
  input.dataset.attr = attr;
  bindFader(input, (v) => {
    out.textContent = pct(v);
    actThrottled(`attr-${attr}`, 'prog.set', { fixtures: [...S.sel], values: { [attr]: v } });
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
    actThrottled('xy', 'prog.set', { fixtures: [...S.sel], values: { pan, tilt } });
  };
  pad.addEventListener('pointerdown', (e) => { xyDragging = true; pad.setPointerCapture(e.pointerId); set(e); });
  pad.addEventListener('pointermove', (e) => xyDragging && set(e));
  pad.addEventListener('pointerup', () => (xyDragging = false));
})();

$('#recCue').onclick = async () => {
  const name = await ask('Name for the new cue (e.g. "Worship 1", "Sermon")', `Cue ${S.show.cues.length + 1}`);
  if (name !== null && (await act('cue.record', { name }))) toast(`Recorded "${name}"`);
};
$('#updCue').onclick = async () => {
  const cur = S.show.cues[S.runtime.cueIndex];
  if (!cur) return toast('No cue is running. Use "Record new cue".', true);
  if (confirm(`Replace cue "${cur.name}" with what is on stage now?`) && (await act('cue.update'))) toast(`Updated "${cur.name}"`);
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
    midiInput: f.midiInput.value, midiChannel: f.midiChannel.value, noteBase: f.noteBase.value, pcSelectsSong: f.pcSelectsSong.checked,
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
          h('button', { className: 'btn', title: 'Replace with what is on stage now', onclick: () => confirm(`Replace "${l.name}" with what is on stage now? Every song using it will change.`) && act('look.update', { id: l.id }) }, 'Update'),
          h('button', { className: 'btn warn', onclick: () => confirm(`Delete look "${l.name}"? Sections using it will keep the current lights instead.`) && act('look.delete', { id: l.id }) }, '✕')))
    )
  );
}
$('#recLook').onclick = async () => {
  const name = await ask('Name for this look (e.g. "Chorus", "Verse", "Bridge build")');
  if (name !== null && (await act('look.record', { name }))) toast(`Recorded look "${name}"`);
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
          !colour ? null : h('div', { className: 'bk-colors' },
            ...BUSK_COLORS.map(([name, hex]) => h('button', { title: name, style: { background: hex }, 'data-bcolor': hex })),
            h('button', { className: 'x', title: 'Back to the planned colour', 'data-bcolor': '' }, '×')),
          h('div', { className: 'bk-fx' },
            ...FX.filter(([k]) => (k !== 'wave' || movers) && (k !== 'rainbow' || colour)).map(([k, label]) => h('button', { 'data-fx': k }, label)),
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
    const hex = b.color ? rgbToHex(b.color) : null;
    for (const c of card.querySelectorAll('[data-bcolor]')) c.classList.toggle('on', !!hex && c.dataset.bcolor === hex);
    const live = b.fx && b.fx !== 'off' ? b.fx.type : b.fx === 'off' ? 'off' : null;
    const auto = stored.get(card.dataset.g);
    for (const btn of card.querySelectorAll('[data-fx]')) {
      const k = btn.dataset.fx;
      btn.classList.toggle('on', live ? k === live : k === 'off' && !auto);
      btn.classList.toggle('auto', !live && !!auto && k === auto.type);
      btn.title = !live && auto && k === auto.type ? 'Planned in this look/cue' : '';
    }
    if (b.fx && b.fx.rate) card.querySelector('.bk-rate').value = String(b.fx.rate);
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
  if (!e.target.classList.contains('bk-rate')) return;
  const card = e.target.closest('.bk-card');
  const b = (S.runtime.busk || {})[card.dataset.g] || {};
  const type = b.fx && b.fx !== 'off' ? b.fx.type : storedEffects().get(card.dataset.g)?.type;
  if (type) act('busk.fx', { groupId: card.dataset.g, fx: type, rate: e.target.value });
});

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
        stage3d.setSelection(id ? [id] : []);
        renderSel3d();
      } else if (S.tab === 'program' && id) {
        toggleSel(id);
      }
    };
    stage3d.onMove = (id, pos) => act('fixture.edit', { id, pos3d: pos }).then(renderSel3d);
    stage3d.onError = (m) => toast(m, true);
    if (S.show) {
      stage3d.setShow(S.show, S.profiles);
      stage3d.setLive(S.live.fixtures);
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
try {
  if (localStorage.getItem('webMidi')) {
    $('#webMidi').checked = true;
    startWebMidi(true);
  }
} catch {}
