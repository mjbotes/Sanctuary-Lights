// Setup → Light health: hours each light has been on, problems found, maintenance reminders,
// and the guided pre-service check (each light blinks in turn: tap Works, or what is wrong).
import { $, S, act, ask, h, on, toast } from './core.js';

let check = null; // { list: [ids], i, results: Map(id -> { ok, problem }) }

const when = (t) => {
  if (!t) return '';
  const d = new Date(t);
  const days = Math.floor((Date.now() - t) / 86400000);
  const time = d.toTimeString().slice(0, 5);
  return days === 0 ? `today ${time}` : days === 1 ? `yesterday ${time}` : `${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`;
};

function render() {
  const box = $('#healthBox');
  if (!box || !S.health) return;
  const hl = S.health;
  const last = hl.lastCheck;
  const order = [...hl.fixtures].sort((a, b) => (b.faults.length - a.faults.length) || (b.due - a.due) || a.name.localeCompare(b.name));
  box.replaceChildren(
    h('div', { className: 'row wrap hl-sum' },
      h('button', { className: 'btn primary', disabled: !hl.fixtures.length, onclick: startCheck }, '▶ Pre-service check'),
      h('span', { className: hl.problems ? 'hl-bad' : 'hl-ok' }, hl.problems ? `⚠ ${hl.problems} light${hl.problems === 1 ? '' : 's'} with a problem` : '✓ No known problems'),
      hl.due ? h('span', { className: 'hl-due' }, `🔧 ${hl.due} due: ${hl.task}`) : null,
      h('small', { className: 'hint', style: { margin: 0 } }, last ? `Last check ${when(last.at)}: ${last.ok} OK${last.problems.length ? `, ${last.problems.length} problem${last.problems.length === 1 ? '' : 's'}` : ''}` : 'Not checked yet')),
    h('p', { className: 'hint' }, 'The check blinks each light in turn; tap Works, or say what is wrong. DMX only goes one way, so the app can\'t tell by itself that a light has died: this is how it finds out. Problems stay listed (and in the service report) until someone taps Fixed.'),
    hl.fixtures.length ? h('table', { className: 'tbl hl-tbl' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Light'), h('th', {}, 'Hours on'), h('th', {}, 'Maintenance'), h('th', {}, 'Problems'), h('th', {}, ''))),
      h('tbody', {}, ...order.map((f) => h('tr', { className: f.faults.length ? 'hl-row-bad' : f.due ? 'hl-row-due' : '' },
        h('td', {}, h('button', { className: 'linkbtn', title: 'Blink this light', onclick: () => act('fixture.identify', { fixtures: [f.id], seconds: 5 }) }, f.name)),
        h('td', {}, `${f.hours} h`),
        h('td', {}, f.every ? `${f.sinceService} / ${f.every} h${f.due ? ' · due' : ''}` : '—',
          h('button', { className: 'btn tiny', title: 'Reminder for this light (hours). Empty = the default', onclick: () => remind(f) }, '⏱')),
        h('td', {}, ...f.faults.map((x) => h('span', { className: 'hl-fault', title: `${when(x.at)}${x.by ? ` · ${x.by}` : ''}` }, x.text,
          h('button', { className: 'btn tiny', onclick: () => act('health.fixed', { id: f.id, faultId: x.id }) }, 'Fixed')))),
        h('td', { className: 'hl-acts' },
          h('button', { className: 'btn tiny', onclick: () => problem(f) }, 'Problem…'),
          f.every ? h('button', { className: 'btn tiny', title: `${hl.task}: done now`, onclick: () => act('health.serviced', { id: f.id }).then((r) => r && toast(`${f.name}: maintenance done`)) }, 'Serviced') : null))))) : h('p', { className: 'empty' }, 'No lights patched yet.'),
    h('div', { className: 'row wrap hl-rem' },
      h('span', {}, 'Remind me every'),
      h('input', { type: 'number', min: 0, step: 50, value: hl.every || '', placeholder: 'never', style: { width: '80px' }, onchange: (e) => act('health.remind', { every: e.target.value, task: $('#hlTask').value }) }),
      h('span', {}, 'hours on to'),
      h('input', { id: 'hlTask', value: hl.task, style: { flex: 1, minWidth: '160px' }, onchange: (e) => act('health.remind', { every: hl.every, task: e.target.value }) }),
      hl.due ? h('button', { className: 'btn small', onclick: () => act('health.serviced', {}).then((r) => r && toast('Maintenance done for every light')) }, 'All serviced') : null),
  );
}

async function problem(f) {
  const text = await ask(`What is wrong with ${f.name}?`, S.health.problemList[0]);
  if (text) act('health.fault', { id: f.id, text });
}
async function remind(f) {
  const v = await ask(`${f.name}: remind every how many hours? (empty = the default, 0 = never)`, f.every ? String(f.every) : '');
  if (v !== null) act('health.remind', { id: f.id, every: v.trim() === '' ? null : Number(v) });
}

// ----- the guided check -----------------------------------------------------------------
function startCheck() {
  check = { list: S.show.fixtures.map((f) => f.id), i: 0, results: new Map() };
  const d = $('#checkDialog');
  d.onclose = () => { act('fixture.identify', { on: false }); check = null; };
  d.showModal();
  step();
}

function step() {
  const d = $('#checkDialog');
  if (!check) return;
  if (check.i >= check.list.length) return finish();
  const id = check.list[check.i];
  const f = S.show.fixtures.find((x) => x.id === id);
  const known = (S.health.fixtures.find((x) => x.id === id) || { faults: [] }).faults;
  act('fixture.identify', { fixtures: [id], seconds: 60 });
  const answer = (ok, problemText) => {
    check.results.set(id, { id, ok, ...(problemText ? { problem: problemText } : {}) });
    check.i++;
    step();
  };
  const prof = S.profiles[f.profile];
  d.querySelector('.ck-body').replaceChildren(
    h('div', { className: 'ck-count' }, `Light ${check.i + 1} of ${check.list.length}`),
    h('div', { className: 'ck-progress' }, h('i', { style: { width: `${(check.i / check.list.length) * 100}%` } })),
    h('h2', { className: 'ck-name' }, f.name),
    h('p', { className: 'hint' }, `${prof ? prof.name : f.profile} · universe ${f.universe}, address ${f.address}. It should be blinking white now.`),
    known.length ? h('p', { className: 'hl-bad' }, `Known problem: ${known.map((x) => x.text).join(', ')}`) : '',
    h('button', { className: 'btn primary ck-ok', autofocus: true, onclick: () => answer(true) }, '✓ Works'),
    h('div', { className: 'ck-probs' }, ...S.health.problemList.map((p) => h('button', { className: 'btn', onclick: () => answer(false, p) }, p)),
      h('button', { className: 'btn', onclick: async () => { const t = await ask('What is wrong?'); if (t) answer(false, t); } }, 'Something else…')),
    h('div', { className: 'row', style: { justifyContent: 'space-between', marginTop: '14px' } },
      h('button', { className: 'btn small', disabled: !check.i, onclick: () => { check.i--; step(); } }, '◀ Back'),
      h('button', { className: 'btn small', onclick: () => { check.i++; step(); } }, 'Skip ▶'),
      h('button', { className: 'btn small', onclick: () => finish() }, 'Finish now')));
  d.querySelector('.ck-ok').focus();
}

async function finish() {
  const d = $('#checkDialog');
  const results = [...check.results.values()];
  act('fixture.identify', { on: false });
  if (!results.length) return d.close();
  const r = await act('health.check', { results });
  const c = r && r.check;
  d.querySelector('.ck-body').replaceChildren(
    h('h2', {}, c && !c.problems.length ? '✓ All good' : 'Check done'),
    c ? h('p', {}, `${c.ok} working${c.problems.length ? `, ${c.problems.length} with a problem` : ''}${c.skipped ? `, ${c.skipped} not checked` : ''}.`) : '',
    c && c.problems.length ? h('ul', {}, ...c.problems.map((p) => h('li', {}, p))) : '',
    c && c.problems.length ? h('p', { className: 'hint' }, 'They are listed under Light health and in today\'s service report until someone taps Fixed.') : '',
    h('div', { className: 'row', style: { justifyContent: 'flex-end' } }, h('button', { className: 'btn primary', onclick: () => d.close() }, 'Close')));
  check = { ...check, done: true };
}

document.addEventListener('keydown', (e) => {
  if (!check || check.done || !$('#checkDialog').open || e.target.tagName === 'INPUT') return;
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#checkDialog .ck-ok') && $('#checkDialog .ck-ok').click(); }
});

on('state', render);
