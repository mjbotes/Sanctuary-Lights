// Pads, hot buttons (Strobe/Flash) and keyboard shortcuts.
import { $, $$, S, act, h, selected, toast } from './core.js';
import { KIND_NAMES, effectById, effectOptions, groupName } from './fx.js';

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

export { padLabel, renderPads, updatePads, padPointers, padUp, holdButton, heldKeys, typingNow, openPad };
