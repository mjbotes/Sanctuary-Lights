// Patch tab: adding lights, fixture types.
import { $, S, act, fixtures, h, profOf, selected, toast } from './core.js';
import { cell } from './cues.js';
import { buildStage, renderLive } from './stage2d.js';

// ----- patch tab ----------------------------------------------------------
function profileOptions(selectedId) {
  return Object.values(S.profiles).map((p) => h('option', { value: p.id, selected: p.id === selectedId }, `${p.name}`));
}
function renderPatch() {
  const keep = $('#addProfile').value;
  $('#addProfile').replaceChildren(...profileOptions(keep || 'drgbw'));
  // Find address clashes
  const owners = new Map();
  const clash = new Set();
  for (const f of fixtures()) {
    for (let i = 0; i < profOf(f).footprint; i++) {
      const key = `${f.universe}:${f.address + i}`;
      if (owners.has(key)) { clash.add(f.id); clash.add(owners.get(key)); }
      else owners.set(key, f.id);
    }
  }
  const tb = $('#fixTable');
  if (!fixtures().length) {
    tb.replaceChildren(h('tr', {}, h('td', { colSpan: 5, className: 'hint' }, 'Nothing patched yet. Add your lights above.')));
  } else {
    tb.replaceChildren(
      ...fixtures().map((f) =>
        h('tr', { className: clash.has(f.id) ? 'clash' : '', title: clash.has(f.id) ? 'This light shares DMX channels with another light' : '' },
          cell(h('input', { value: f.name, onchange: (e) => act('fixture.edit', { id: f.id, name: e.target.value }) })),
          cell(h('select', { onchange: (e) => act('fixture.edit', { id: f.id, profile: e.target.value }) }, ...profileOptions(f.profile))),
          cell(h('input', { type: 'number', min: 1, value: f.universe, onchange: (e) => act('fixture.edit', { id: f.id, universe: e.target.value }) })),
          cell(h('input', { type: 'number', min: 1, max: 512, value: f.address, title: `Uses ${f.address}–${f.address + profOf(f).footprint - 1}`, onchange: (e) => act('fixture.edit', { id: f.id, address: e.target.value }) })),
          h('td', { className: 'acts' }, h('button', { className: 'btn warn', onclick: () => confirm(`Remove "${f.name}"? It will also be removed from all cues and scenes.`) && act('fixture.delete', { fixtures: [f.id] }) }, '✕'))
        )
      )
    );
  }
}
$('#addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(e.target));
  if (!d.address) delete d.address;
  if (await act('fixture.add', d)) {
    toast('Added');
    e.target.name.value = '';
    e.target.address.value = '';
  }
});
$('#arrangeBtn').onclick = () => {
  S.arranging = !S.arranging;
  $('#arrangeWrap').hidden = !S.arranging;
  $('#arrangeBtn').textContent = S.arranging ? 'Done arranging' : 'Arrange stage';
  if (S.arranging) buildStage($('#arrangeStage'), 'arrange');
  renderLive();
};

function renderProfiles() {
  const list = Object.values(S.profiles);
  $('#profileList').replaceChildren(
    h('div', { className: 'proflist' },
      ...list.map((p) =>
        h('div', { className: 'profrow' },
          h('b', {}, p.name), h('code', { title: p.channels }, p.channels),
          p.builtin
            ? h('button', { className: 'btn small', title: 'Copy into a new custom type', onclick: () => editProfile({ name: `${p.name} (copy)`, channels: p.channels }) }, 'Copy')
            : [h('button', { className: 'btn small', onclick: () => editProfile(p) }, 'Edit'),
               h('button', { className: 'btn small warn', onclick: () => confirm(`Delete type "${p.name}"?`) && act('profile.delete', { id: p.id }) }, '✕')]
        )
      )
    )
  );
}
function editProfile(p) {
  const f = $('#profForm');
  f.id.value = p.id || '';
  f.name.value = p.name;
  f.channels.value = p.channels;
  $('#profFormTitle').textContent = p.id ? `Edit "${p.name}"` : 'New fixture type';
  f.name.focus();
}
$('#profCancel').onclick = () => editProfile({ name: '', channels: '' });
$('#profForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(e.target));
  if (await act('profile.save', d)) {
    toast('Fixture type saved');
    editProfile({ name: '', channels: '' });
  }
});

export { profileOptions, renderPatch, renderProfiles, editProfile };
