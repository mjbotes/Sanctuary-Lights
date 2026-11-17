// Selecting lights and groups.
import { $, $$, S, act, ask, fixtures, h, selected, toast } from './core.js';
import { renderFxRunBar, renderFxSel, renderPresets } from './fx.js';
import { renderControls } from './program.js';
import { stage3d } from './view3d.js';

// ----- selection & groups ----------------------------------------------
function toggleSel(id) {
  S.sel.has(id) ? S.sel.delete(id) : S.sel.add(id);
  renderSelection();
  renderControls();
}
function setSel(ids) {
  S.sel = new Set(ids);
  renderSelection();
  renderControls();
}
function renderSelection() {
  for (const node of $$('#progStage .fx')) node.classList.toggle('sel', S.sel.has(node.dataset.id));
  if (stage3d && S.tab === 'program') stage3d.setSelection([...S.sel]);
  if (S.show) { renderFxSel(); renderPresets(); renderFxRunBar(); }
  const n = S.sel.size;
  $('#selInfo').textContent = n ? `${n} selected: ${selected().map((f) => f.name).join(', ')}` : 'Tap lights to select them, or pick a group.';
}
$('#selAll').onclick = () => setSel(fixtures().map((f) => f.id));
$('#selNone').onclick = () => setSel([]);
function renderGroups() {
  const bar = $('#groupBar');
  bar.replaceChildren(
    ...S.show.groups.map((g) =>
      h('button', {
        className: 'chip',
        title: 'Tap to select. Long-press or right-click to delete.',
        onclick: () => setSel(g.fixtures),
        oncontextmenu: async (e) => {
          e.preventDefault();
          if (confirm(`Delete group "${g.name}"?`)) act('group.delete', { id: g.id });
        },
      }, g.name)
    ),
    h('button', {
      className: 'chip add',
      onclick: async () => {
        if (!S.sel.size) return toast('Select some lights first', true);
        const name = await ask('Name for this group');
        if (name) act('group.save', { name, fixtures: [...S.sel] });
      },
    }, '+ Save group')
  );
}

export { toggleSel, setSel, renderSelection, renderGroups };
