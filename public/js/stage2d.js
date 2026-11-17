// 2D stage views (Live / Program / arranging in Patch).
import { $, $$, S, act, fixtures, h, pct } from './core.js';
import { updateDimReadout } from './program.js';
import { renderSelection, toggleSel } from './selection.js';

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

export { buildStage, renderStages, makeDraggable, renderLive };
