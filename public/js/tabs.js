// Switching tabs.
import { $, $$, S, act } from './core.js';
import { loadInfo } from './setup.js';
import { place3d } from './view3d.js';

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
