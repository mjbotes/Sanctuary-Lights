// Undo / redo (buttons in the top bar, Cmd/Ctrl+Z) and snapshots (Setup tab).
import { $, S, act, h, on, toast } from './core.js';

async function undo() {
  const r = await act('history.undo');
  if (r) toast(`Undone: ${r.label}`);
}
async function redo() {
  const r = await act('history.redo');
  if (r) toast(`Redone: ${r.label}`);
}

function renderHistoryButtons() {
  const hst = S.history || {};
  const u = $('#undoBtn'), r = $('#redoBtn');
  u.disabled = !hst.undo;
  r.disabled = !hst.redo;
  u.title = hst.undo ? `Undo: ${hst.undo} (Cmd/Ctrl+Z)` : 'Nothing to undo';
  r.title = hst.redo ? `Redo: ${hst.redo} (Shift+Cmd/Ctrl+Z)` : 'Nothing to redo';
  const hide = S.role === 'volunteer';
  u.hidden = r.hidden = hide;
}

$('#undoBtn').onclick = undo;
$('#redoBtn').onclick = redo;
document.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
  if (e.target.matches('input, textarea, select') || document.querySelector('dialog[open]')) return;
  e.preventDefault();
  if (e.shiftKey) redo();
  else undo();
});

// ----- snapshots ---------------------------------------------------------------------
async function loadSnapshots() {
  const box = $('#snapList');
  if (!box) return;
  const r = await act('snapshot.list');
  if (!r) return;
  const list = r.snapshots || [];
  box.replaceChildren(...(list.length ? list.slice(0, 40).map((s) => h('div', { className: 'snaprow' },
    h('span', {}, new Date(s.time).toLocaleString(), ' ', s.auto ? h('small', { className: 'hint' }, 'automatic') : h('b', {}, s.label || 'saved')),
    h('button', { className: 'btn small', onclick: async () => {
      if (!confirm(`Go back to the show as it was at ${new Date(s.time).toLocaleString()}? (You can undo this.)`)) return;
      if (await act('snapshot.restore', { name: s.name })) toast('Snapshot restored');
    } }, 'Restore')))
    : [h('p', { className: 'hint' }, 'No snapshots yet. One is saved automatically every 5 minutes while you make changes.')]));
}
$('#snapSave').onclick = async () => {
  const label = prompt('Name for this snapshot (e.g. "Before Easter changes")', '');
  if (label === null) return;
  if (await act('snapshot.save', { label })) {
    toast('Snapshot saved');
    loadSnapshots();
  }
};
$('#snapRefresh').onclick = loadSnapshots;

on('state', renderHistoryButtons);
on('runtime', renderHistoryButtons);

export { undo, redo, loadSnapshots, renderHistoryButtons };
