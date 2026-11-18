// FX & Presets tab: presets, effects library, effect editor.
import { FX } from './busk.js';
import { $, $$, S, act, actThrottled, ask, fixtures, h, selected, toast } from './core.js';
import { bindFader } from './live.js';
import { colorPick, tokenRgb } from './palette.js';
import { setSel, toggleSel } from './selection.js';
import { effSel, renderTricks, trickView, tricksOn } from './tricks.js';

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

export { FXM, CAT_NAMES, allEffects, effectById, groupName, effectOptions, KIND_NAMES, renderFx, renderFxSel, renderPresets, renderFxList, runKey, renderFxRunBar, updateFxLive, fxSaveTimer, saveDraft, renderFxEditor };
