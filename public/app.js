'use strict';
/* Sanctuary Lights – browser UI. Talks to server.js over /api. */

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
    return j.ok;
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
    for (const id of [...S.sel]) if (!S.show.fixtures.some((f) => f.id === id)) S.sel.delete(id);
    renderAll();
    $('#outErr').textContent = d.outputError || '';
  });
  es.addEventListener('runtime', (e) => {
    S.runtime = JSON.parse(e.data);
    renderRuntime();
  });
  es.addEventListener('live', (e) => {
    S.live = JSON.parse(e.data);
    renderLive();
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
  $('#nowName').textContent = cur ? cur.name : i < 0 ? 'Cue list not started' : '—';
  $('#nowNotes').textContent = cur && cur.notes ? cur.notes : '';
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
  renderIfaces();
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

// ----- start ----------------------------------------------------------------
try {
  const t = localStorage.getItem('tab');
  if (t && $(`#tabs button[data-tab="${t}"]`)) $(`#tabs button[data-tab="${t}"]`).click();
} catch {}
connect();
pollDmx();
