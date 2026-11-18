// Setup → Service reports: what happened during each service (songs, sections, parts, problems),
// and what caused it. Printable.
import { $, authHeaders, h } from './core.js';

const KIND = { song: '♪', section: '›', part: '◆', cue: '●', blackout: '■', practice: '🎓', take: '⏺', panic: '⚠', problem: '⚠', fixed: '✓', check: '☑' };
const t = (at) => new Date(at).toTimeString().slice(0, 5);
const get = (u) => fetch(u, { headers: authHeaders() }).then((r) => r.json());

async function render(day) {
  const box = $('#reportBox');
  if (!box) return;
  const list = await get('/api/reports').catch(() => ({ ok: false }));
  if (!list.ok) return box.replaceChildren(h('p', { className: 'hint' }, 'Reports could not be loaded.'));
  if (!list.days.length) return box.replaceChildren(h('p', { className: 'hint' }, 'Nothing yet. Every service is recorded here automatically: songs, sections, service parts, and any problems.'));
  const d = day || list.days[0];
  const r = await get(`/api/report?day=${d}`);
  const showSections = $('#reportSections') ? $('#reportSections').checked : false;
  const entries = r.entries.filter((x) => showSections || x.kind !== 'section');
  box.replaceChildren(
    h('div', { className: 'row wrap' },
      h('select', { onchange: (e) => render(e.target.value) }, ...list.days.map((x) => h('option', { value: x, selected: x === d }, new Date(`${x}T12:00`).toDateString()))),
      h('label', { className: 'check plain' }, h('input', { type: 'checkbox', id: 'reportSections', checked: showSections, onchange: () => render(d) }), ' Show every section change'),
      h('button', { className: 'btn small', onclick: () => { document.body.classList.add('printing-report'); window.print(); setTimeout(() => document.body.classList.remove('printing-report'), 500); } }, 'Print')),
    h('div', { className: 'report', id: 'reportPrint' },
      h('h3', {}, `Service report · ${new Date(`${d}T12:00`).toDateString()}${r.from ? ` · ${t(r.from)}–${t(r.to)}` : ''}`),
      h('p', {}, `${r.songs.length} song${r.songs.length === 1 ? '' : 's'}`, r.problems.length ? h('b', { className: 'bad' }, ` · ${r.problems.length} problem${r.problems.length === 1 ? '' : 's'}`) : h('span', { className: 'ok' }, ' · no problems')),
      r.songs.length ? h('ol', { className: 'report-songs' }, ...r.songs.map((s) => h('li', {}, h('b', {}, s.name), ` ${t(s.at)}${s.minutes !== null ? ` · ${s.minutes} min · ${s.sections} section changes` : ''}`))) : '',
      h('table', { className: 'tbl report-tl' }, h('tbody', {}, ...entries.map((x) => h('tr', { className: `k-${x.kind}` },
        h('td', {}, t(x.at)), h('td', {}, KIND[x.kind] || ''), h('td', {}, x.text), h('td', { className: 'by' }, x.by ? `by ${x.by}` : '')))))));
}

$('nav button[data-tab=setup]').addEventListener('click', () => render());
