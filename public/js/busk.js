// Live control strips per group (faders, colours, effects, flash, tempo).
import { $, $$, S, act, actThrottled, ask, fixById, h, pct, profOf, selected } from './core.js';
import { effectOptions } from './fx.js';
import { bindFader } from './live.js';
import { hexToRgb } from './program.js';
import { lookById } from './songs.js';

// ----- live control (busking) ------------------------------------------------
const BUSK_COLORS = [['Open', '#ffffff'], ['Warm', '#ffc78f'], ['Red', '#ff0000'], ['Amber', '#ffa400'], ['Green', '#00ff1e'], ['Cyan', '#00e1ff'], ['Blue', '#0028ff'], ['Purple', '#8a00ff'], ['Magenta', '#ff00d0']];
const FX = [['off', 'Off'], ['pulse', 'Pulse'], ['chase', 'Chase'], ['sparkle', 'Sparkle'], ['rainbow', 'Rainbow'], ['wave', 'Move']];
const rgbToHex = (c) => '#' + c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');

function storedEffects() {
  const base = S.runtime.base || { kind: 'cue' };
  const src = base.kind === 'look' ? lookById(base.lookId) : S.show.cues[S.runtime.cueIndex];
  return new Map(((src && src.effects) || []).map((e) => [e.groupId, e]));
}

function renderBusk() {
  for (const box of [$('#liveBusk'), $('#songsBusk')]) {
    const bar = h('div', { className: 'bk-bar' },
      h('h2', {}, 'Live control'),
      h('span', { className: 'beatdot', title: 'Beat' }),
      h('span', { className: 'bk-bpm', title: 'Tap to type a tempo' }, '120 BPM'),
      h('button', { className: 'btn small bk-tap', title: 'Tap on the beat (or press T)' }, 'TAP'),
      h('button', { className: 'btn small bk-release', title: 'Undo all live changes' }, 'Release live'));
    if (!S.show.groups.length) {
      box.replaceChildren(bar, h('div', { className: 'empty' }, 'Make groups on the Program tab (select lights, then "+ Save group") to get live faders, colours and effects here.'));
      continue;
    }
    box.replaceChildren(bar, h('div', { className: 'bk-grid' },
      ...S.show.groups.map((g) => {
        const has = (attr) => g.fixtures.some((id) => { const f = fixById(id); return f && profOf(f).attrs.includes(attr); });
        const movers = has('pan');
        const colour = ['red', 'green', 'blue', 'white'].some(has) && g.fixtures.some((id) => { const f = fixById(id); return f && profOf(f).attrs.some((a) => ['red', 'green', 'blue'].includes(a)); });
        const card = h('div', { className: 'bk-card' },
          h('div', { className: 'bk-head' }, h('b', {}, g.name), h('span', { className: 'lvl' }, '100%'),
            h('button', { className: 'btn flash', title: 'Hold for full' }, 'Flash')),
          h('input', { type: 'range', min: 0, max: 1000, value: 1000, className: 'bk-level', 'aria-label': `${g.name} level` }),
          !colour ? null : h('div', { className: 'bk-pal' }, ...['P', 'S', 'T'].map((l, i) => h('button', { 'data-brole': i + 1, title: ['Primary', 'Secondary', 'Tertiary'][i] }, l))),
          !colour ? null : h('div', { className: 'bk-colors' },
            ...BUSK_COLORS.map(([name, hex]) => h('button', { title: name, style: { background: hex }, 'data-bcolor': hex })),
            h('button', { className: 'x', title: 'Back to the planned colour', 'data-bcolor': '' }, '×')),
          h('div', { className: 'bk-fx' },
            ...FX.filter(([k]) => (k !== 'wave' || movers) && (k !== 'rainbow' || colour)).map(([k, label]) => h('button', { 'data-fx': k }, label)),
            h('select', { className: 'bk-more', title: 'More effects' }, h('option', { value: '' }, 'More…'), ...effectOptions()),
            h('select', { className: 'bk-rate', title: 'Speed (beats)' },
              ...[[0.5, '½×'], [1, '1×'], [2, '2×'], [4, '4×']].map(([v, l]) => h('option', { value: v, selected: v === 1 }, l)))));
        card.dataset.g = g.id;
        const lvl = card.querySelector('.bk-level');
        bindFader(lvl, (v) => {
          card.querySelector('.lvl').textContent = pct(v);
          actThrottled(`bk-${g.id}`, 'busk.level', { groupId: g.id, level: v });
        });
        return card;
      })));
  }
  updateBusk();
}

function updateBusk() {
  if (!S.show) return;
  const busk = S.runtime.busk || {};
  const stored = storedEffects();
  for (const el of $$('.bk-bpm')) el.replaceChildren(`${Math.round(S.runtime.bpm || 120)} BPM `, h('small', {}, S.runtime.clock ? 'MIDI clock' : ''));
  for (const card of $$('.bk-card')) {
    const b = busk[card.dataset.g] || {};
    const level = b.level ?? 1;
    const lvl = card.querySelector('.bk-level');
    if (!lvl.dragging) lvl.value = Math.round(level * 1000);
    card.querySelector('.lvl').textContent = pct(level);
    const isRole = typeof b.color === 'string';
    const hex = b.color && !isRole ? rgbToHex(b.color) : null;
    for (const c of card.querySelectorAll('[data-bcolor]')) c.classList.toggle('on', !!hex && c.dataset.bcolor === hex);
    const pal = S.runtime.palette || [];
    for (const c of card.querySelectorAll('[data-brole]')) {
      c.style.background = pal[c.dataset.brole - 1] || '#888';
      c.classList.toggle('on', isRole && b.color === `pal:${c.dataset.brole}`);
    }
    const live = b.fx && b.fx !== 'off' ? b.fx.type : b.fx === 'off' ? 'off' : null;
    const auto = stored.get(card.dataset.g);
    for (const btn of card.querySelectorAll('[data-fx]')) {
      const k = btn.dataset.fx;
      btn.classList.toggle('on', live ? k === live : k === 'off' && !auto);
      const autoId = auto && (auto.effectId || auto.type);
      btn.classList.toggle('auto', !live && !!auto && k === autoId);
      btn.title = !live && auto && k === autoId ? 'Planned in this look/cue' : '';
    }
    if (b.fx && b.fx.rate) card.querySelector('.bk-rate').value = String(b.fx.rate);
    const more = card.querySelector('.bk-more');
    const cur = live || (auto && auto.effectId) || '';
    more.value = cur && !card.querySelector(`[data-fx="${cur}"]`) ? cur : '';
    more.classList.toggle('on', !!more.value);
    card.querySelector('.flash').classList.toggle('on', !!b.flash);
    card.classList.toggle('touched', !!(b.color || b.fx || level < 1));
  }
}

const flashing = new Map();
document.addEventListener('pointerdown', (e) => {
  const btn = e.target.closest('.bk-card .flash');
  if (!btn) return;
  e.preventDefault();
  const gid = btn.closest('.bk-card').dataset.g;
  btn.setPointerCapture(e.pointerId);
  btn.classList.add('on');
  flashing.set(e.pointerId, gid);
  act('busk.flash', { groupId: gid, on: true });
});
const endFlash = (e) => {
  const gid = flashing.get(e.pointerId);
  if (!gid) return;
  flashing.delete(e.pointerId);
  act('busk.flash', { groupId: gid, on: false });
};
document.addEventListener('pointerup', endFlash);
document.addEventListener('pointercancel', endFlash);
document.addEventListener('contextmenu', (e) => e.target.closest('.flash') && e.preventDefault());
document.addEventListener('click', async (e) => {
  const t = e.target;
  const card = t.closest('.bk-card');
  if (card && t.dataset.brole) return act('busk.color', { groupId: card.dataset.g, role: Number(t.dataset.brole) });
  if (card && t.dataset.bcolor !== undefined) {
    return act('busk.color', { groupId: card.dataset.g, rgb: t.dataset.bcolor ? hexToRgb(t.dataset.bcolor) : null });
  }
  if (card && t.dataset.fx) {
    return act('busk.fx', { groupId: card.dataset.g, fx: t.dataset.fx, rate: card.querySelector('.bk-rate').value });
  }
  if (t.closest('.bk-tap')) return act('tempo.tap');
  if (t.closest('.bk-release')) return act('busk.release');
  if (t.closest('.bk-bpm')) {
    const v = await ask('Tempo (BPM)', String(Math.round(S.runtime.bpm || 120)));
    if (v) act('tempo.set', { bpm: v });
  }
});
document.addEventListener('change', (e) => {
  if (e.target.classList.contains('bk-more')) {
    const card = e.target.closest('.bk-card');
    if (e.target.value) act('busk.fx', { groupId: card.dataset.g, fx: e.target.value, rate: card.querySelector('.bk-rate').value });
    return;
  }
  if (!e.target.classList.contains('bk-rate')) return;
  const card = e.target.closest('.bk-card');
  const b = (S.runtime.busk || {})[card.dataset.g] || {};
  const st = storedEffects().get(card.dataset.g);
  const type = b.fx && b.fx !== 'off' ? b.fx.type : st && (st.effectId || st.type);
  if (type) act('busk.fx', { groupId: card.dataset.g, fx: type, rate: e.target.value });
});

export { BUSK_COLORS, FX, rgbToHex, storedEffects, renderBusk, updateBusk, flashing, endFlash };
