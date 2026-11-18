// Practice mode: rehearse without touching the real lights (for training volunteers, or trying a
// plan midweek). The real lights keep what they had; every screen shows what WOULD happen.
import { $, S, act, h, on, toast } from './core.js';

function render() {
  if (!S.runtime) return;
  const p = S.runtime.practice;
  document.body.classList.toggle('practicing', !!p);
  const btn = $('#practiceBtn');
  btn.classList.toggle('on', !!p);
  btn.textContent = p ? 'Practising' : 'Practice';
  const bar = $('#practiceBanner');
  bar.hidden = !p;
  if (!p) return;
  if (bar.dataset.since === String(p.since)) return;
  bar.dataset.since = String(p.since);
  bar.replaceChildren(
    h('b', {}, 'PRACTICE MODE'),
    h('span', {}, 'The real lights are not changing. Everything here is a rehearsal: watch it in the 2D / 3D view.'),
    h('span', { className: 'grow' }),
    h('button', { className: 'btn small primary', title: 'The lights stay as they are; the screens go back to them too', onclick: () => leave(false) }, 'Back to the real stage'),
    h('button', { className: 'btn small warn', title: 'Send what is on screen now to the real lights', onclick: () => confirm('Send what you practised to the real lights now?') && leave(true) }, 'Send this to the lights'));
}

async function leave(keep) {
  if (await act('practice.set', { on: false, keep })) toast(keep ? 'Practice sent to the lights' : 'Back to the real stage');
}

$('#practiceBtn').addEventListener('click', async () => {
  if (S.runtime.practice) return leave(false);
  if (await act('practice.set', { on: true })) toast('Practice mode: the real lights stay as they are. Try anything.');
});

on('runtime', render);
on('state', render);
