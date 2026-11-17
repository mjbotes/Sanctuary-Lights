// Live tab: GO / back, cue list, scenes, master, blackout, keyboard.
import { updateBusk } from './busk.js';
import { $, $$, S, act, actThrottled, h, pct } from './core.js';
import { renderFxSel, updateFxLive } from './fx.js';
import { updatePads } from './pads.js';
import { renderOscStatus, renderPalette } from './palette.js';
import { syncControlValues } from './program.js';
import { ppSlideChanged, renderPpStatus } from './propresenter.js';
import { renderLooks, renderSongLive } from './songs.js';
import { tracksRuntime } from './tracks.js';

// ----- live tab ---------------------------------------------------------
function renderRuntime() {
  if (!S.show) return;
  const cues = S.show.cues;
  const i = S.runtime.cueIndex;
  const cur = cues[i];
  const next = cues[i + 1];
  const base = S.runtime.base || { kind: 'cue' };
  if (base.kind === 'look') {
    const song = S.show.songs.find((x) => x.id === S.runtime.songId);
    const sec = song && song.sections.find((x) => x.id === S.runtime.sectionId);
    const look = S.show.looks.find((l) => l.id === base.lookId);
    $('#nowName').textContent = sec ? `${song.name} · ${sec.name}` : `Look: ${look ? look.name : '?'}`;
    $('#nowNotes').textContent = 'Songs are driving the lights. GO returns to the cue list.';
  } else {
    $('#nowName').textContent = cur ? cur.name : i < 0 ? 'Cue list not started' : '—';
    $('#nowNotes').textContent = cur && cur.notes ? cur.notes : '';
  }
  $('#nextName').textContent = next ? `${next.name}  ·  ${next.fade}s` : cues.length ? 'End of list' : 'No cues yet – record some on the Program tab';
  $('#goBtn').disabled = !next;
  $('#backBtn').disabled = i < 0;
  const list = $('#liveCues');
  list.replaceChildren(
    ...cues.map((c, n) =>
      h('div', { className: `cuerow${n === i ? ' cur' : ''}${n === i + 1 ? ' next' : ''}`, onclick: () => act('cue.goto', { id: c.id }) },
        h('span', { className: 'n' }, n + 1), h('span', {}, c.name), h('span', { className: 'f' }, `${c.fade}s`))
    )
  );
  const curRow = list.querySelector('.cur');
  if (curRow) curRow.scrollIntoView({ block: 'nearest' });
  for (const r of $$('#cueTable tr')) r.classList.toggle('cur', r.dataset.index === String(i));

  const gm = $('#gm');
  if (!gm.dragging) gm.value = Math.round(S.runtime.gm * 1000);
  $('#gmVal').textContent = pct(S.runtime.gm);
  $('#blackout').classList.toggle('on', S.runtime.blackout);
  $('#blackout').textContent = S.runtime.blackout ? 'BLACKOUT ON' : 'Blackout';
  const progCount = Object.keys(S.runtime.programmer).length;
  const badge = $('#progBadge');
  badge.hidden = !progCount;
  badge.textContent = `Editing ${progCount} light${progCount === 1 ? '' : 's'} · Clear`;
  if (S.tab === 'program') syncControlValues();
  renderSongLive();
  updateBusk();
  renderLooks();
  updatePads();
  updateFxLive();
  if (S.tab === 'fx') renderFxSel();
  tracksRuntime();
  renderPpStatus();
  ppSlideChanged();
  renderPalette();
  renderOscStatus();
}
$('#goBtn').onclick = () => act('cue.go');
$('#backBtn').onclick = () => act('cue.back');
$('#blackout').onclick = () => act('blackout.set', { on: !S.runtime.blackout });
$('#progBadge').onclick = () => act('prog.clear');
bindFader($('#gm'), (v) => {
  $('#gmVal').textContent = pct(v);
  actThrottled('gm', 'gm.set', { value: v });
});
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea') || document.querySelector('dialog[open]') || e.repeat || e.metaKey || e.ctrlKey) return;
  if (S.tab === 'songs') {
    if (e.key === 't' || e.key === 'T') return act('tempo.tap');
    if (e.code === 'Space' || e.key === 'ArrowRight') { e.preventDefault(); $('#nextSec').click(); }
    else if (e.key === 'ArrowLeft') $('#prevSec').click();
    return;
  }
  if (e.key === 't' || e.key === 'T') return act('tempo.tap');
  if (e.code === 'Space') { e.preventDefault(); act('cue.go'); }
  else if (e.key === 'Backspace' || e.key === 'ArrowLeft') act('cue.back');
});

function renderScenes() {
  const wrap = $('#liveScenes');
  if (!S.show.scenes.length) {
    wrap.replaceChildren(h('div', { className: 'empty', style: { gridColumn: '1 / -1' } }, 'No scenes yet. Set some lights on the Program tab and tap "Save as scene".'));
    return;
  }
  wrap.replaceChildren(
    ...S.show.scenes.map((s) => {
      const slider = h('input', { type: 'range', min: 0, max: 1000, value: 0, 'aria-label': `${s.name} level` });
      bindFader(slider, (v) => actThrottled(`scene-${s.id}`, 'scene.level', { id: s.id, level: v }));
      const card = h('div', { className: 'scene', style: { '--sc': s.color } },
        h('div', { className: 'fill', style: { background: s.color } }),
        h('button', { className: 'tap', onclick: () => act('scene.toggle', { id: s.id }) }, h('span', { className: 'sw' }), s.name),
        slider);
      card.style.setProperty('--sc', s.color);
      card.dataset.id = s.id;
      return card;
    })
  );
}

// Faders: mark while dragging so live updates don't fight the finger.
function bindFader(input, onValue) {
  input.addEventListener('pointerdown', () => (input.dragging = true));
  const end = () => setTimeout(() => (input.dragging = false), 300);
  input.addEventListener('pointerup', end);
  input.addEventListener('pointercancel', end);
  input.addEventListener('input', () => onValue(input.value / 1000));
}

export { renderRuntime, renderScenes, bindFader };
