// Primary / secondary / tertiary colours and OSC status.
import { $, S, act, actThrottled, h, selected } from './core.js';
import { FXM, saveDraft } from './fx.js';
import { renderProgSwatches } from './program.js';

// ----- Palette: primary / secondary / tertiary -------------------------------------
const PAL_LABELS = ['Primary', 'Secondary', 'Tertiary'];
function tokenRgb(tok) {
  const m = /^pal:([123])$/.exec(tok || '');
  const hex = m ? ((S.runtime && S.runtime.palette) || [])[m[1] - 1] || '#ffffff' : tok;
  return FXM.hexToRgb(hex);
}
function colorPick(l, key, ro, draft) {
  const isPal = /^pal:/.test(l[key] || '');
  const sel = h('select', { disabled: ro }, ...PAL_LABELS.map((n, i) => h('option', { value: `pal:${i + 1}`, selected: l[key] === `pal:${i + 1}` }, n)), h('option', { value: 'custom', selected: !isPal }, 'Custom…'));
  const pick = h('input', { type: 'color', value: isPal ? '#ffffff' : l[key], disabled: ro, hidden: isPal });
  sel.addEventListener('change', () => {
    l[key] = sel.value === 'custom' ? pick.value : sel.value;
    pick.hidden = sel.value !== 'custom';
    saveDraft(draft);
  });
  pick.addEventListener('change', () => { l[key] = pick.value; saveDraft(draft); });
  return h('div', { className: 'colsel' }, sel, pick);
}
function renderPalette() {
  if (!S.show || !S.runtime.palette) return;
  const box = $('#palBar');
  const pal = S.runtime.palette;
  const live = S.runtime.paletteLive || {};
  const song = S.show.songs.find((x) => x.id === S.runtime.songId);
  const sig = JSON.stringify([pal, live, song && song.id, S.runtime.paletteSource]);
  if (sig !== box.dataset.sig && !box.contains(document.activeElement)) {
    box.dataset.sig = sig;
    box.replaceChildren(
      ...pal.map((c, i) => {
        const inp = h('input', { type: 'color', value: c, title: `${PAL_LABELS[i]} colour${song ? ` of "${song.name}"` : ' (default)'}` });
        inp.addEventListener('input', () => actThrottled(`pal${i}`, 'palette.set', { index: i, color: inp.value, scope: 'live' }));
        inp.addEventListener('change', () => act('palette.set', { index: i, color: inp.value }));
        return h('label', { className: `palsw${live[i] ? ' live' : ''}`, style: { background: c } }, inp, h('b', {}, ['P', 'S', 'T'][i]));
      }),
      h('span', { className: 'lbl' }, song ? (S.runtime.paletteSource === 'song' ? `${song.name} colours` : 'Default colours') : 'Default colours',
        song && S.runtime.paletteSource === 'song' ? h('button', { className: 'btn small', style: { padding: '0 4px', marginLeft: '4px', fontSize: '10px' }, title: 'Use the default colours for this song', onclick: () => act('palette.reset') }, '↺') : null));
  }
  renderProgSwatches();
}
function renderOscStatus() {
  const el = $('#oscStatus');
  if (!el || !S.show) return;
  const o = S.oscConn;
  const last = S.runtime.lastOsc;
  const port = (S.show.settings.osc && S.show.settings.osc.port) || 8000;
  el.replaceChildren(
    o && o.listening ? h('span', { style: { color: 'var(--go-hi)' } }, `● Listening on UDP ${port}`) : h('span', { style: { color: '#ff8a80' } }, o && o.error ? `● ${o.error}` : '● Off'),
    last ? ` · last: ${last.address}${last.args && last.args.length ? ` ${last.args.map((x) => JSON.stringify(x)).join(' ')}` : ''} → ${last.result}` : '');
}

export { PAL_LABELS, tokenRgb, colorPick, renderPalette, renderOscStatus };
