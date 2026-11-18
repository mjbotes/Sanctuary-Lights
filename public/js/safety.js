// Panic button (hold 1 second) and the safe look it goes to.
import { $, S, act, h, on, toast } from './core.js';

const HOLD_MS = 1000;
const btn = $('#panicBtn');
const fill = h('span', { className: 'fill' });
btn.prepend(fill);
let timer = null;

function start(e) {
  e.preventDefault();
  btn.setPointerCapture && e.pointerId !== undefined && btn.setPointerCapture(e.pointerId);
  fill.style.transition = `width ${HOLD_MS}ms linear`;
  fill.style.width = '100%';
  timer = setTimeout(async () => {
    timer = null;
    if (await act('panic')) toast('Panic: live changes stopped, back to the safe look');
    reset();
  }, HOLD_MS);
}
function reset() {
  clearTimeout(timer);
  timer = null;
  fill.style.transition = 'none';
  fill.style.width = '0';
}
btn.addEventListener('pointerdown', start);
btn.addEventListener('pointerup', reset);
btn.addEventListener('pointercancel', reset);
btn.addEventListener('pointerleave', () => timer && reset());
btn.addEventListener('contextmenu', (e) => e.preventDefault());

function renderSafeLook() {
  const sel = $('#safeLook');
  if (!sel || !S.show || document.activeElement === sel) return;
  const cur = S.show.settings.safeLookId || '';
  sel.replaceChildren(h('option', { value: '' }, '— keep the current look —'), ...S.show.looks.map((l) => h('option', { value: l.id, selected: l.id === cur }, l.name)));
}
$('#safeLook').addEventListener('change', (e) => act('settings.update', { settings: { safeLookId: e.target.value || null } }));
on('state', renderSafeLook);

export { renderSafeLook };
