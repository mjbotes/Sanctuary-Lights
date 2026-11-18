// Service parts: Worship, Hosting, Sermon, Video…
// - The part bar (Live, Songs and Volunteer screens): one tap switches the lighting for that part of the service
// - Setup → Service parts: what each part does
import { $, $$, S, act, h, on, toast } from './core.js';

const part = (id) => S.show.parts.find((p) => p.id === id);

function describe(p) {
  const look = p.lookId && S.show.looks.find((l) => l.id === p.lookId);
  return [
    look ? `Look: ${look.name}` : 'Keeps the song / cue lights',
    p.level < 1 ? `Brightness ${Math.round(p.level * 100)}%` : '',
    p.sections ? 'Songs change the lights' : 'Songs do not change the lights',
    p.screenColor ? 'Follows screen colours' : 'Ignores screen colours',
  ].filter(Boolean).join(' · ');
}

function renderBars() {
  if (!S.show) return;
  const rt = S.runtime;
  const cur = part(rt.partId);
  const why = rt.ppVideo ? `▶ Video playing${rt.ppVideo.name ? `: ${rt.ppVideo.name}` : ''}`
    : rt.partAuto && rt.partResult ? `Auto: ${rt.partResult}`
      : cur && !cur.sections ? 'Songs are not changing the lights' : '';
  for (const bar of $$('.partbar')) {
    bar.replaceChildren(
      h('span', { className: 'lbl' }, 'Service'),
      ...S.show.parts.map((p) => h('button', {
        className: `btn${p.id === rt.partId ? ' on' : ''}${p.video ? ' video' : ''}`,
        title: describe(p),
        onclick: () => act('part.go', { id: p.id }),
      }, p.name)),
      h('span', { className: 'why' }, why));
  }
}

function renderEditor() {
  const box = $('#partsBox');
  if (!box || !S.show) return;
  if (box.contains(document.activeElement) && document.activeElement.matches('input:not([type=checkbox]), select')) return;
  const pp = S.show.settings.pp || {};
  $('#ppVideoPart').checked = pp.videoPart !== false;
  $('#ppAutoParts').checked = pp.autoParts !== false;
  const save = (p, patch) => act('part.save', { part: { id: p.id, ...patch } });
  box.replaceChildren(...S.show.parts.map((p) => {
    const looks = h('select', { onchange: (e) => save(p, { lookId: e.target.value || null }) },
      h('option', { value: '' }, p.video ? 'Keep the current lights' : 'Keep the song / cue lights'),
      ...S.show.looks.map((l) => h('option', { value: l.id, selected: l.id === p.lookId }, `Look: ${l.name}`)));
    const level = h('input', { type: 'range', min: 0, max: 100, value: Math.round(p.level * 100) });
    const lv = h('b', {}, `${Math.round(p.level * 100)}%`);
    level.oninput = () => { lv.textContent = `${level.value}%`; };
    level.onchange = () => save(p, { level: level.value / 100 });
    const check = (key, label, title) => h('label', { className: 'check plain', title },
      h('input', { type: 'checkbox', checked: p[key], onchange: (e) => save(p, { [key]: e.target.checked }) }), ` ${label}`);
    return h('div', { className: `part-row${p.id === S.runtime.partId ? ' cur' : ''}` },
      h('div', { className: 'row' },
        h('input', { className: 'pname', value: p.name, onchange: (e) => save(p, { name: e.target.value }) }),
        p.video ? h('span', { className: 'tag' }, 'while videos play') : null,
        h('span', { className: 'grow' }),
        p.video ? null : h('button', { className: 'btn small warn', title: 'Delete this part', onclick: () => confirm(`Delete the "${p.name}" part?`) && act('part.delete', { id: p.id }) }, '×')),
      h('div', { className: 'row wrap' }, looks,
        h('label', { className: 'mini', title: 'Overall brightness during this part' }, 'Brightness ', level, lv),
        h('label', { className: 'mini' }, 'Fade ', h('input', { type: 'number', min: 0, max: 30, step: 0.5, value: p.fade, style: { width: '64px' }, onchange: (e) => save(p, { fade: Number(e.target.value) || 0 }) }), ' s')),
      h('div', { className: 'row wrap' },
        check('sections', 'Songs change the lights', 'MIDI from the tracks, track markers, ProPresenter groups and timecode. Tapping a song section always works, and switches back to a part where songs change the lights.'),
        check('screenColor', 'Follow screen colours', 'ProPresenter colour sync. Switching to a part without it drops the screen colour.')),
      p.video ? null : h('label', { className: 'mini wide', title: 'Comma-separated. A ProPresenter presentation whose name contains one of these picks this part.' }, 'Presentations named',
        h('input', { value: p.match, placeholder: p.sections ? 'songs pick this part automatically' : 'e.g. sermon, message', onchange: (e) => save(p, { match: e.target.value }) })));
  }));
}

$('#partAdd').addEventListener('click', () => act('part.save', { part: { name: 'New part', sections: false, screenColor: false } }).then((r) => r && toast('Part added. Choose its look below.')));
$('#ppVideoPart').addEventListener('change', (e) => act('settings.update', { settings: { pp: { videoPart: e.target.checked } } }));
$('#ppAutoParts').addEventListener('change', (e) => act('settings.update', { settings: { pp: { autoParts: e.target.checked } } }));

on('state', () => { renderBars(); renderEditor(); });
on('runtime', () => {
  renderBars();
  const box = $('#partsBox');
  if (box) [...box.children].forEach((row, i) => row.classList.toggle('cur', !!S.show.parts[i] && S.show.parts[i].id === S.runtime.partId));
});
