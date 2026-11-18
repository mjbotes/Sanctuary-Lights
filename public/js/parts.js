// Service parts: Worship, Hosting, Sermon, Video, and your own (Baptism, Communion…)
// - The part bar (Live, Songs and Volunteer screens): one tap switches the lighting for that part of the service
// - "+" on the bar or in Setup: add a part from a template
// - Setup → Service parts: what each part does
import { $, $$, S, act, ask, h, on, toast } from './core.js';

const part = (id) => S.show.parts.find((p) => p.id === id);

// Ready-made parts. lookName: use a look with this name if the show has one.
const TEMPLATES = [
  { name: 'Baptism', text: 'Bright, clean light on the baptism area so everyone (and the camera) can see.', match: 'baptism, baptise, baptize', sections: false, screenColor: false },
  { name: 'Communion', text: 'Calm and warm. Songs played quietly underneath don\'t change the lights.', match: 'communion, lords supper, eucharist, table', sections: false, screenColor: false },
  { name: 'Prayer', text: 'Softer and lower, for a moment of prayer.', match: 'prayer, pray', level: 0.6, sections: false, screenColor: false },
  { name: 'Offering', text: 'Steady light while the offering is taken.', match: 'offering, giving, tithe', sections: false, screenColor: false },
  { name: 'Response', text: 'Altar call or ministry time: the band plays and songs keep changing the lights, but no screen colours.', match: 'response, altar, ministry time', sections: true, screenColor: false },
  { name: 'Testimony', text: 'Light on the person sharing their story or being interviewed.', match: 'testimony, story, interview', sections: false, screenColor: false },
  { name: 'Dedication', text: 'Child dedication or a special moment at the front.', match: 'dedication, blessing', sections: false, screenColor: false },
  { name: 'Kids', text: 'Kids\' talk or kids leaving: bright and cheerful.', match: 'kids, children, youth', sections: false, screenColor: false },
  { name: 'Pre-service', text: 'Walk-in and countdown: a gentle room look before the service starts.', match: 'pre-service, preservice, walk in, countdown, loop', sections: false, screenColor: false },
  { name: 'Post-service', text: 'Walk-out: room lights up, stage softer.', match: 'post-service, postservice, walk out, dismissal', sections: false, screenColor: false },
];

function describe(p) {
  const look = p.lookId && S.show.looks.find((l) => l.id === p.lookId);
  return [
    look ? `Look: ${look.name}` : 'Keeps the song / cue lights',
    p.level < 1 ? `Brightness ${Math.round(p.level * 100)}%` : '',
    p.sections ? 'Songs change the lights' : 'Songs do not change the lights',
    p.screenColor ? 'Follows screen colours' : 'Ignores screen colours',
  ].filter(Boolean).join(' · ');
}

const canEdit = () => S.role !== 'volunteer';

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
      canEdit() && !bar.classList.contains('big') ? h('button', { className: 'btn add', title: 'Add a part (Baptism, Communion, Prayer…)', onclick: openTemplates }, '+') : null,
      h('span', { className: 'why' }, why));
  }
}

// ----- adding a part from a template -------------------------------------------------
function openTemplates() {
  const have = new Set(S.show.parts.map((p) => p.name.toLowerCase()));
  const add = async (t) => {
    const r = await act('part.save', { part: { name: t.name, match: t.match || '', level: t.level ?? 1, sections: !!t.sections, screenColor: !!t.screenColor, fade: 2, lookName: t.name } });
    if (!r) return;
    $('#partDialog').close();
    const p = S.show.parts.at(-1);
    toast(p && p.lookId ? `"${t.name}" added, using your "${t.name}" look.` : `"${t.name}" added. Set up the stage, then tap "Record look from stage" for it in Setup → Service parts.`);
  };
  $('#partTemplates').replaceChildren(
    ...TEMPLATES.map((t) => h('button', { type: 'button', className: `wz-card${have.has(t.name.toLowerCase()) ? ' have' : ''}`, onclick: () => add(t) },
      h('b', {}, t.name, have.has(t.name.toLowerCase()) ? h('small', {}, ' (you have one)') : ''), h('span', {}, t.text))),
    h('button', { type: 'button', className: 'wz-card', onclick: async () => {
      const name = ((await ask('Name of the part (e.g. "Worship night")')) || '').trim();
      if (name) add({ name, match: '', sections: false, screenColor: false });
    } }, h('b', {}, 'Your own…'), h('span', {}, 'Any other part of your service.')));
  $('#partDialog').showModal();
}

// ----- Setup → Service parts ----------------------------------------------------------
function renderEditor() {
  const box = $('#partsBox');
  if (!box || !S.show) return;
  if (box.contains(document.activeElement) && document.activeElement.matches('input:not([type=checkbox]), select')) return;
  const pp = S.show.settings.pp || {};
  $('#ppVideoPart').checked = pp.videoPart !== false;
  $('#ppAutoParts').checked = pp.autoParts !== false;
  const save = (p, patch) => act('part.save', { part: { id: p.id, ...patch } });
  box.replaceChildren(...S.show.parts.map((p, i) => {
    const looks = h('select', { onchange: (e) => save(p, { lookId: e.target.value || null }) },
      h('option', { value: '' }, p.video ? 'Keep the current lights' : 'Keep the song / cue lights'),
      ...S.show.looks.map((l) => h('option', { value: l.id, selected: l.id === p.lookId }, `Look: ${l.name}`)));
    const level = h('input', { type: 'range', min: 0, max: 100, value: Math.round(p.level * 100) });
    const lv = h('b', {}, `${Math.round(p.level * 100)}%`);
    level.oninput = () => { lv.textContent = `${level.value}%`; };
    level.onchange = () => save(p, { level: level.value / 100 });
    const check = (key, label, title) => h('label', { className: 'check plain', title },
      h('input', { type: 'checkbox', checked: p[key], onchange: (e) => save(p, { [key]: e.target.checked }) }), ` ${label}`);
    const record = h('button', { className: 'btn small', title: `Save what is on stage now as the "${p.name}" look, and use it for this part`, onclick: () => {
      if (p.lookId && !confirm(`Replace the "${p.name}" look with what is on stage now?`)) return;
      act('part.recordLook', { id: p.id }).then((r) => r && toast(`"${p.name}" look saved from the stage`));
    } }, p.lookId ? '● Re-record look' : '● Record look from stage');
    return h('div', { className: `part-row${p.id === S.runtime.partId ? ' cur' : ''}` },
      h('div', { className: 'row' },
        h('input', { className: 'pname', value: p.name, onchange: (e) => save(p, { name: e.target.value }) }),
        p.video ? h('span', { className: 'tag' }, 'while videos play') : null,
        h('span', { className: 'grow' }),
        p.video ? null : record,
        h('button', { className: 'btn small', title: 'Move up', disabled: i === 0, onclick: () => act('part.move', { id: p.id, dir: -1 }) }, '↑'),
        h('button', { className: 'btn small', title: 'Move down', disabled: i === S.show.parts.length - 1, onclick: () => act('part.move', { id: p.id, dir: 1 }) }, '↓'),
        p.video ? null : h('button', { className: 'btn small warn', title: 'Delete this part', onclick: () => confirm(`Delete the "${p.name}" part? (Its look stays.)`) && act('part.delete', { id: p.id }) }, '×')),
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

$('#partAdd').addEventListener('click', openTemplates);
$('#ppVideoPart').addEventListener('change', (e) => act('settings.update', { settings: { pp: { videoPart: e.target.checked } } }));
$('#ppAutoParts').addEventListener('change', (e) => act('settings.update', { settings: { pp: { autoParts: e.target.checked } } }));

on('state', () => { renderBars(); renderEditor(); });
on('runtime', () => {
  renderBars();
  const box = $('#partsBox');
  if (box) [...box.children].forEach((row, i) => row.classList.toggle('cur', !!S.show.parts[i] && S.show.parts[i].id === S.runtime.partId));
});

export { TEMPLATES, openTemplates };
