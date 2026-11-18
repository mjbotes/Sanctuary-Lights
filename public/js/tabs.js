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
  b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  place3d();
});

// Fade the tab bar's edge while more tabs are hidden to the right
const nav = $('#tabs');
const markMore = () => nav.classList.toggle('more', nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 4);
nav.addEventListener('scroll', markMore, { passive: true });
window.addEventListener('resize', markMore);
setTimeout(markMore, 300);
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (b) act(b.dataset.act);
});
