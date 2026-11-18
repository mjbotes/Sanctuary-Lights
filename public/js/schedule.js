// Setup → Schedule: things the lights do by themselves at a time of the week
// (walk-in look at 9:30 on Sundays, blackout at 12:30…). Times are the lighting computer's clock.
import { $, S, act, h, on, toast } from './core.js';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const KINDS = [['part', 'Switch to part'], ['look', 'Show look'], ['blackout', 'Blackout on'], ['unblackout', 'Blackout off'], ['master', 'Set master to']];

// The next time an entry runs, from now
function nextRun(e, now = new Date()) {
  const [hh, mm] = e.time.split(':').map(Number);
  for (let i = 0; i < 8; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, hh, mm);
    if (e.days.includes(d.getDay()) && d > now) return d;
  }
  return null;
}

function describe(e) {
  if (e.kind === 'part') return (S.show.parts.find((p) => p.id === e.target) || {}).name || 'a part';
  if (e.kind === 'look') return (S.show.looks.find((l) => l.id === e.target) || {}).name || 'a look';
  if (e.kind === 'master') return `master ${Math.round((e.target || 0) * 100)}%`;
  return e.kind === 'blackout' ? 'blackout' : 'blackout off';
}

function render() {
  const box = $('#scheduleBox');
  if (!box || !S.show) return;
  if (box.contains(document.activeElement) && document.activeElement.matches('input, select')) return;
  const list = S.show.schedule || [];
  const save = (e, patch) => act('schedule.save', { entry: { ...e, ...patch } });
  const upcoming = list.filter((e) => e.on && e.days.length).map((e) => ({ e, at: nextRun(e) })).filter((x) => x.at).sort((a, b) => a.at - b.at)[0];
  box.replaceChildren(
    h('p', { className: 'hint' }, upcoming
      ? `Next: ${DAY_NAMES[upcoming.at.getDay()]} ${upcoming.e.time} · ${describe(upcoming.e)}. Times use this computer's clock; it must be on (with the app open) at that time.`
      : 'The lights can change by themselves: a walk-in look before the service, house lights down at the start, everything off afterwards. Times use this computer\'s clock.'),
    ...list.map((e) => {
      const target = e.kind === 'part' ? h('select', { onchange: (ev) => save(e, { target: ev.target.value }) }, ...S.show.parts.map((p) => h('option', { value: p.id, selected: p.id === e.target }, p.name)))
        : e.kind === 'look' ? h('select', { onchange: (ev) => save(e, { target: ev.target.value }) }, h('option', { value: '' }, 'Choose a look'), ...S.show.looks.map((l) => h('option', { value: l.id, selected: l.id === e.target }, l.name)))
          : e.kind === 'master' ? h('input', { type: 'number', min: 0, max: 100, value: Math.round((e.target || 0) * 100), style: { width: '64px' }, onchange: (ev) => save(e, { target: Number(ev.target.value) / 100 }) })
            : null;
      return h('div', { className: `sched-row${e.on ? '' : ' off'}` },
        h('input', { type: 'checkbox', checked: e.on, title: 'On / off', onchange: (ev) => save(e, { on: ev.target.checked }) }),
        h('div', { className: 'days' }, ...DAY_NAMES.map((d, i) => h('button', { className: `day${e.days.includes(i) ? ' on' : ''}`, onclick: () => save(e, { days: e.days.includes(i) ? e.days.filter((x) => x !== i) : [...e.days, i] }) }, d[0]))),
        h('input', { type: 'time', value: e.time, onchange: (ev) => save(e, { time: ev.target.value }) }),
        h('select', { onchange: (ev) => save(e, { kind: ev.target.value, target: null }) }, ...KINDS.map(([v, l]) => h('option', { value: v, selected: v === e.kind }, l))),
        target, e.kind === 'master' ? '%' : null,
        h('span', { className: 'grow' }),
        h('button', { className: 'btn small', title: 'Do it now', onclick: () => act('schedule.run', { id: e.id }).then((r) => r && toast(`Done: ${describe(e)}`)) }, 'Test'),
        h('button', { className: 'btn small warn', title: 'Delete', onclick: () => act('schedule.delete', { id: e.id }) }, '×'));
    }));
}

$('#scheduleAdd').addEventListener('click', () => {
  const pre = S.show.parts.find((p) => /pre/i.test(p.name)) || S.show.parts[0];
  act('schedule.save', { entry: { days: [0], time: '09:30', kind: 'part', target: pre && pre.id } });
});

on('state', render);
on('runtime', () => {
  const ls = S.runtime.lastSchedule;
  if (ls && ls.at !== render.lastToast && Date.now() - ls.at < 5000) {
    render.lastToast = ls.at;
    const e = (S.show.schedule || []).find((x) => x.id === ls.id);
    if (e) toast(`Schedule ${e.time}: ${describe(e)}`);
  }
});

export { nextRun };
