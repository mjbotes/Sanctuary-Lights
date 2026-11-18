// Program tab: intensity, colour, position, recording.
import { $, $$, S, act, actThrottled, ask, fixtures, h, pct, profOf, progValue, selAttrs, selected, toast } from './core.js';
import { bindFader } from './live.js';
import { colorPick } from './palette.js';
import { effSel } from './tricks.js';

// ----- program tab --------------------------------------------------------
const SWATCHES = [
  ['Open', '#ffffff'], ['Warm', '#ffc78f'], ['Cool', '#dbe7ff'], ['Red', '#ff0000'], ['Orange', '#ff5a00'],
  ['Amber', '#ffa400'], ['Yellow', '#ffe600'], ['Green', '#00ff1e'], ['Teal', '#00ffa0'], ['Cyan', '#00e1ff'],
  ['Sky', '#4aa8ff'], ['Blue', '#0028ff'], ['Indigo', '#3c00ff'], ['Purple', '#8a00ff'], ['Magenta', '#ff00d0'], ['Pink', '#ff6aa8'],
];
const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
function renderProgSwatches() {
  const pal = (S.runtime && S.runtime.palette) || ['#ffb070', '#2050ff', '#a020f0'];
  $('#swatches').replaceChildren(
    ...['Primary', 'Secondary', 'Tertiary'].map((name, i) =>
      h('button', { className: 'palbtn', style: { background: pal[i] }, title: `${name} colour of the song (stays linked: change the song's ${name.toLowerCase()} and this follows)`, onclick: () => setPalette(i + 1) }, h('span', {}, name.slice(0, 3).toUpperCase()))),
    ...SWATCHES.map(([name, hex]) =>
      h('button', { style: { background: hex }, title: name, onclick: () => setColor(hex) }, h('span', {}, name))));
}
renderProgSwatches();
function setPalette(n) {
  if (!S.sel.size) return toast('Select some lights first', true);
  act('preset.apply', { id: `pal:${n}`, fixtures: effSel() });
  const off = selected().filter((f) => (S.live.fixtures[f.id]?.d ?? 0) === 0 && profOf(f).attrs.includes('dim'));
  if (off.length) act('prog.set', { fixtures: off.map((f) => f.id), values: { dim: 1 } });
}
function setColor(hex) {
  if (!S.sel.size) return toast('Select some lights first', true);
  act('prog.color', { fixtures: effSel(), rgb: hexToRgb(hex) });
  // Lights that are off would not show the colour, so bring them up.
  const off = selected().filter((f) => (S.live.fixtures[f.id]?.d ?? 0) === 0 && profOf(f).attrs.includes('dim'));
  if (off.length) act('prog.set', { fixtures: off.map((f) => f.id), values: { dim: 1 } });
}
$('#colorPick').addEventListener('input', (e) => {
  if (!S.sel.size) return;
  actThrottled('color', 'prog.color', { fixtures: effSel(), rgb: hexToRgb(e.target.value) });
});

bindFader($('#dim'), (v) => {
  $('#dimVal').textContent = pct(v);
  actThrottled('dim', 'prog.set', { fixtures: effSel(), values: { dim: v } });
});
for (const b of $$('[data-dim]')) b.onclick = () => S.sel.size && act('prog.set', { fixtures: effSel(), values: { dim: Number(b.dataset.dim) } });
$('#locateBtn').onclick = () => S.sel.size && act('prog.locate', { fixtures: effSel() });
$('#clearSelBtn').onclick = () => S.sel.size && act('prog.clear', { fixtures: effSel() });
$('#clearAllBtn').onclick = () => act('prog.clear');
$('#centerPos').onclick = () => act('prog.set', { fixtures: effSel(), values: { pan: 0.5, tilt: 0.5 } });

const COLOR_ATTRS = ['red', 'green', 'blue', 'white', 'amber', 'uv'];
const LABELS = { red: 'Red', green: 'Green', blue: 'Blue', white: 'White', amber: 'Amber', uv: 'UV', zoom: 'Zoom', focus: 'Focus', strobe: 'Strobe', haze: 'Haze', fan: 'Fan' };

function miniSlider(attr) {
  const input = h('input', { type: 'range', min: 0, max: 1000, value: 0 });
  const out = h('b', {}, '—');
  input.dataset.attr = attr;
  bindFader(input, (v) => {
    out.textContent = pct(v);
    actThrottled(`attr-${attr}`, 'prog.set', { fixtures: effSel(), values: { [attr]: v } });
  });
  return h('div', { className: 'mini' }, h('span', {}, LABELS[attr] || attr), input, out);
}

function renderControls() {
  const attrs = selAttrs();
  $('#controls').classList.toggle('disabled', !S.sel.size);
  $('#colorCtl').hidden = S.sel.size > 0 && !COLOR_ATTRS.some((a) => attrs.has(a));
  $('#extraColor').replaceChildren(...COLOR_ATTRS.filter((a) => attrs.has(a)).map(miniSlider));
  $('#moveCtl').hidden = !(attrs.has('pan') || attrs.has('tilt'));
  const other = [...attrs].filter((a) => a !== 'dim' && a !== 'pan' && a !== 'tilt' && !COLOR_ATTRS.includes(a));
  $('#otherCtl').replaceChildren(...(other.length ? [h('div', { className: 'ctl' }, h('div', { className: 'ctlhead' }, h('span', {}, 'Other')), ...other.map(miniSlider))] : []));
  syncControlValues();
}
function updateDimReadout() {
  const p = progValue('dim');
  let v = p;
  if (v === null) {
    const first = selected()[0];
    v = first ? S.live.fixtures[first.id]?.d ?? 0 : null;
  }
  $('#dimVal').textContent = v === null ? '—' : pct(v) + (p === null ? ' (live)' : '');
  if (v !== null && !$('#dim').dragging) $('#dim').value = Math.round(v * 1000);
}
function syncControlValues() {
  updateDimReadout();
  for (const input of $$('#extraColor input, #otherCtl input')) {
    if (input.dragging) continue;
    const v = progValue(input.dataset.attr);
    input.value = Math.round((v ?? 0) * 1000);
    input.nextSibling.textContent = v === null ? '—' : pct(v);
  }
  if (!xyDragging) {
    const pan = progValue('pan') ?? 0.5, tilt = progValue('tilt') ?? 0.5;
    $('#xyDot').style.left = pct(pan);
    $('#xyDot').style.top = pct(1 - tilt);
  }
}
let xyDragging = false;
(() => {
  const pad = $('#xy');
  const set = (e) => {
    const r = pad.getBoundingClientRect();
    const pan = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const tilt = 1 - Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    $('#xyDot').style.left = pct(pan);
    $('#xyDot').style.top = pct(1 - tilt);
    actThrottled('xy', 'prog.set', { fixtures: effSel(), values: { pan, tilt } });
  };
  pad.addEventListener('pointerdown', (e) => { xyDragging = true; pad.setPointerCapture(e.pointerId); set(e); });
  pad.addEventListener('pointermove', (e) => xyDragging && set(e));
  pad.addEventListener('pointerup', () => (xyDragging = false));
})();

$('#recCue').onclick = async () => {
  const name = await ask('Name for the new cue (e.g. "Worship 1", "Sermon")', `Cue ${S.show.cues.length + 1}`);
  if (name !== null && (await act('cue.record', { name, fixtures: [...S.sel] }))) toast(`Recorded "${name}"`);
};
$('#updCue').onclick = async () => {
  const cur = S.show.cues[S.runtime.cueIndex];
  if (!cur) return toast('No cue is running. Use "Record new cue".', true);
  if (confirm(`Replace cue "${cur.name}" with what is on stage now?`) && (await act('cue.update', { fixtures: [...S.sel] }))) toast(`Updated "${cur.name}"`);
};
$('#recScene').onclick = async () => {
  if (!Object.keys(S.runtime.programmer).length) return toast('Change some lights first, then save them as a scene', true);
  const name = await ask('Name for the scene (e.g. "Pulpit", "Baptism")');
  if (name !== null && (await act('scene.record', { name }))) toast(`Saved scene "${name || 'Scene'}"`);
};

export { SWATCHES, hexToRgb, renderProgSwatches, setPalette, setColor, COLOR_ATTRS, LABELS, miniSlider, renderControls, updateDimReadout, syncControlValues, xyDragging };
