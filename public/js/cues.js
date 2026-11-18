// Cues & Scenes tab: editing the cue list and scenes.
import { $, S, act, h } from './core.js';
import { fmtTc, parseTc } from './lighting.js';

// ----- cues & scenes tab --------------------------------------------------
function cell(input) {
  return h('td', {}, input);
}
function renderCueTable() {
  const tb = $('#cueTable');
  if (!S.show.cues.length) {
    tb.replaceChildren(h('tr', {}, h('td', { colSpan: 9, className: 'hint' }, 'No cues yet.')));
    return;
  }
  tb.replaceChildren(
    ...S.show.cues.map((c, i) => {
      const tr = h('tr', { className: i === S.runtime.cueIndex ? 'cur' : '' },
        h('td', {}, h('button', { className: 'btn small', title: 'Go to this cue', onclick: () => act('cue.goto', { id: c.id }) }, i + 1)),
        cell(h('input', { value: c.name, onchange: (e) => act('cue.edit', { id: c.id, name: e.target.value }) })),
        cell(h('input', { type: 'number', min: 0, step: 0.5, value: c.fade, onchange: (e) => act('cue.edit', { id: c.id, fade: e.target.value }) })),
        cell(h('input', { type: 'number', min: 0, step: 0.5, value: c.fadeDown ?? '', placeholder: '=', onchange: (e) => act('cue.edit', { id: c.id, fadeDown: e.target.value }) })),
        cell(h('input', { type: 'number', min: 0, step: 0.5, value: c.delay ?? '', placeholder: '0', onchange: (e) => act('cue.edit', { id: c.id, delay: e.target.value }) })),
        cell(h('input', { type: 'number', min: 0, step: 0.5, value: c.follow ?? '', placeholder: '—', title: 'Seconds after this cue finished (empty = wait for GO)', onchange: (e) => act('cue.edit', { id: c.id, follow: e.target.value }) })),
        cell(h('input', { className: 'tc', value: Number.isFinite(c.tc) ? fmtTc(c.tc) : '', placeholder: 'hh:mm:ss:ff', onchange: (e) => {
          const v = e.target.value.trim() === '' ? '' : parseTc(e.target.value);
          if (v === null) return alert('Use hh:mm:ss:ff, e.g. 00:01:30:00');
          act('cue.edit', { id: c.id, tc: v });
        } })),
        cell(h('input', { value: c.notes || '', placeholder: 'note for operator', onchange: (e) => act('cue.edit', { id: c.id, notes: e.target.value }) })),
        h('td', { className: 'acts' },
          S.show.settings.tracking ? h('label', { className: 'check plain', title: 'Block: this cue does not take anything from the cues before it', style: { fontSize: '11px' } }, h('input', { type: 'checkbox', checked: !!c.block, onchange: (e) => act('cue.edit', { id: c.id, block: e.target.checked }) }), 'Block') : null,
          h('button', { className: 'btn', title: 'Move up', onclick: () => act('cue.move', { id: c.id, dir: -1 }) }, '↑'),
          h('button', { className: 'btn', title: 'Move down', onclick: () => act('cue.move', { id: c.id, dir: 1 }) }, '↓'),
          h('button', { className: 'btn warn', title: 'Delete', onclick: () => confirm(`Delete cue "${c.name}"?`) && act('cue.delete', { id: c.id }) }, '✕'))
      );
      tr.dataset.index = i;
      return tr;
    })
  );
}
function renderSceneTable() {
  const tb = $('#sceneTable');
  if (!S.show.scenes.length) {
    tb.replaceChildren(h('tr', {}, h('td', { colSpan: 4, className: 'hint' }, 'No scenes yet.')));
    return;
  }
  tb.replaceChildren(
    ...S.show.scenes.map((s) =>
      h('tr', {},
        cell(h('input', { type: 'color', value: s.color, onchange: (e) => act('scene.edit', { id: s.id, color: e.target.value }) })),
        cell(h('input', { value: s.name, onchange: (e) => act('scene.edit', { id: s.id, name: e.target.value }) })),
        cell(h('input', { type: 'number', min: 0, step: 0.5, value: s.fade, onchange: (e) => act('scene.edit', { id: s.id, fade: e.target.value }) })),
        h('td', { className: 'acts' },
          h('button', { className: 'btn', title: 'Replace with the Program tab settings', onclick: () => confirm(`Replace scene "${s.name}" with what is set in the programmer?`) && act('scene.update', { id: s.id }) }, 'Update'),
          h('button', { className: 'btn', onclick: () => act('scene.move', { id: s.id, dir: -1 }) }, '↑'),
          h('button', { className: 'btn', onclick: () => act('scene.move', { id: s.id, dir: 1 }) }, '↓'),
          h('button', { className: 'btn warn', onclick: () => confirm(`Delete scene "${s.name}"?`) && act('scene.delete', { id: s.id }) }, '✕'))
      )
    )
  );
}

export { cell, renderCueTable, renderSceneTable };
