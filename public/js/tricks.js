// Selection tricks (order, pattern, parts, spreads).
import { $, S, act, fixById, fixtures, h, selected, toast } from './core.js';
import { FXM } from './fx.js';

// ----- selection tricks ---------------------------------------------------------
function tricksOn() {
  const t = (S.runtime && S.runtime.tricks) || {};
  return t.active !== false && Object.entries(t).some(([k, v]) => k !== 'active' && (k === 'order' ? v && v !== 'tap' : FXM.hasValue(v)));
}
function trickPosClient(id) {
  const f = fixById(id);
  if (!f) return { x: 0, y: 0, z: 0 };
  return window.Geom.placement(f, S.show.stage3d.stage).pos;
}
// Small top-down dial showing the sweep direction (drag or tap to turn)
function dirDial(t) {
  const c = h('canvas', { width: 120, height: 120, className: 'dirdial', title: 'Tap to point the sweep (top = back of the stage)' });
  const draw = () => {
    const g = c.getContext('2d');
    g.clearRect(0, 0, 120, 120);
    g.strokeStyle = '#3d4556'; g.lineWidth = 2;
    g.beginPath(); g.arc(60, 60, 50, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#8b93a5'; g.font = '10px sans-serif'; g.textAlign = 'center';
    g.fillText('BACK', 60, 18); g.fillText('AUDIENCE', 60, 110);
    const a = ((Number(t.turn) || 0) * Math.PI) / 180;
    const len = 40 * Math.cos(((Number(t.tilt) || 0) * Math.PI) / 180);
    const x = 60 + Math.cos(a) * len, y = 60 - Math.sin(a) * len;
    g.strokeStyle = '#f2b33d'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(60 - (x - 60), 60 - (y - 60)); g.lineTo(x, y); g.stroke();
    g.fillStyle = '#f2b33d'; g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fill();
  };
  draw();
  c.addEventListener('pointerdown', (e) => {
    const r = c.getBoundingClientRect();
    const dx = (e.clientX - r.left) / r.width * 120 - 60, dy = 60 - (e.clientY - r.top) / r.height * 120;
    const turn = Math.round(((Math.atan2(dy, dx) * 180) / Math.PI) / 15) * 15;
    setTricks({ turn });
  });
  return c;
}

// The selection after tricks: [{ id, i (order), k (step), m (steps), active }]
function trickView() {
  const ids = [...S.sel];
  const t = S.runtime.tricks || {};
  if (!tricksOn()) return ids.map((id, i) => ({ id, i, k: i, m: ids.length, active: true }));
  const ord = FXM.trickOrder(ids, t, trickPosClient);
  const steps = FXM.trickSteps(ord.length, t);
  const act = FXM.trickActive(ord.length, t);
  const fr = FXM.trickFractions(ord, t, trickPosClient);
  return ord.map((id, i) => ({ id, i, ...steps[i], ...(fr ? { f: fr[i] } : {}), active: act.active(i) }));
}
// Lights that programming applies to: the active part of the selection, in trick order.
function effSel() {
  return trickView().filter((x) => x.active).map((x) => x.id);
}

const setTricks = (patch) => act('tricks.set', { tricks: patch });
function stepper(key, label, opts = {}) {
  const t = S.runtime.tricks || {};
  const inp = h('input', { type: 'number', value: FXM.hasValue(t[key]) ? t[key] : '', placeholder: opts.none || '—', step: opts.step || 1, 'aria-label': label });
  inp.addEventListener('change', () => setTricks({ [key]: inp.value === '' ? null : Number(inp.value) }));
  const bump = (d) => {
    const cur = FXM.hasValue(t[key]) ? Number(t[key]) : opts.start ?? 0;
    let next = +(cur + d * (opts.step || 1)).toFixed(3);
    if (opts.min !== undefined && next < opts.min) next = null;
    setTricks({ [key]: next });
  };
  return h('div', { className: `stepper${FXM.hasValue(t[key]) ? ' set' : ''}` },
    h('span', { className: 'st-label' }, label),
    h('div', { className: 'st-row' },
      h('button', { type: 'button', className: 'btn', onclick: () => bump(-1) }, '−'), inp,
      h('button', { type: 'button', className: 'btn', onclick: () => bump(1) }, '+')));
}
function renderTricks() {
  const box = $('#tricksBox');
  if (!box || box.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
  const t = S.runtime.tricks || {};
  const on = t.active !== false;
  const view = trickView();
  const parts = FXM.hasValue(t.width) ? Math.ceil(Math.max(1, view.length) / t.width) : 0;
  const order = h('select', { onchange: (e) => setTricks({ order: e.target.value }) },
    ...[['tap', 'Tap order'], ['left-right', 'Left → right'], ['right-left', 'Right → left'], ['front-back', 'Front → back'], ['back-front', 'Back → front'], ['low-high', 'Low → high'], ['high-low', 'High → low'], ['centre-out', 'Centre → out'], ['outside-in', 'Outside → in'], ['direction', '3D direction (turn / tilt)…']]
      .map(([v, l]) => h('option', { value: v, selected: (t.order || 'tap') === v }, l)));
  const pair = (label, kf, kt, opts) => h('div', { className: 'pairrow' }, h('span', {}, label), stepper(kf, 'From', opts), h('span', { className: 'arrow' }, '→'), stepper(kt, 'To', opts));
  const fanAttr = h('select', {}, ...[['dim', 'Intensity'], ['pan', 'Pan'], ['tilt', 'Tilt'], ['zoom', 'Zoom']].map(([v, l]) => h('option', { value: v }, l)));
  const fanFrom = h('input', { type: 'number', min: 0, max: 100, value: 0 });
  const fanTo = h('input', { type: 'number', min: 0, max: 100, value: 100 });
  box.replaceChildren(
    h('div', { className: 'tr-head' },
      h('button', { className: `btn small${on ? ' primary' : ''}`, onclick: () => setTricks({ active: !on }), title: 'Switch all tricks on/off without losing them' }, on ? 'Tricks on' : 'Tricks off'),
      h('button', { className: 'btn small', onclick: () => act('tricks.shuffle') }, 'Shuffle'),
      FXM.hasValue(t.shuffle) ? h('button', { className: 'btn small', onclick: () => setTricks({ shuffle: null }) }, 'Unshuffle') : null,
      h('button', { className: 'btn small warn', onclick: () => act('tricks.reset') }, 'Reset')),
    h('div', { className: `tr-body${on ? '' : ' off'}` },
      h('div', { className: 'tr-sec' }, h('div', { className: 'label' }, 'Order'),
        h('div', { className: 'tr-grid' }, h('label', { className: 'st-label tr-sel' }, 'Sort', order), stepper('shift', 'Shift', { start: 0 })),
        t.order === 'direction' ? h('div', { className: 'tr-grid', style: { marginTop: '6px' } },
          stepper('turn', 'Turn ° (0 = L→R, 90 = front→back)', { step: 15, start: 0 }),
          stepper('tilt', 'Tilt ° (90 = floor→ceiling)', { step: 15, start: 0 }),
          h('div', { className: 'stepper' }, h('span', { className: 'st-label' }, 'Direction'), dirDial(t))) : null,
        t.order && t.order !== 'tap' ? h('label', { className: 'check plain', style: { marginTop: '6px', display: 'flex', gap: '6px', alignItems: 'center', fontSize: '13px' } },
          h('input', { type: 'checkbox', checked: !!t.spatial, onchange: (e) => setTricks({ spatial: e.target.checked }) }),
          'Spread by distance (uneven spacing = uneven timing, like a real wave)') : null),
      h('div', { className: 'tr-sec' }, h('div', { className: 'label' }, 'Pattern'),
        h('div', { className: 'tr-grid' }, stepper('block', 'Block', { min: 2, start: 1 }), stepper('groups', 'Groups', { min: 2, start: 1 }), stepper('wings', 'Wings', { min: 2, start: 1 }))),
      h('div', { className: 'tr-sec' }, h('div', { className: 'label' }, 'Parts'),
        h('div', { className: 'tr-grid' }, stepper('width', 'Width', { min: 1, start: 0 }),
          h('div', { className: 'stepper' }, h('span', { className: 'st-label' }, 'Active part'),
            h('div', { className: 'st-row' },
              h('button', { className: 'btn', disabled: !parts, onclick: () => act('tricks.part', { n: view.length, dir: -1 }) }, '◀'),
              h('span', { className: 'partlbl' }, parts ? (t.part ? `${t.part} / ${parts}` : `All ${parts}`) : '—'),
              h('button', { className: 'btn', disabled: !parts, onclick: () => act('tricks.part', { n: view.length, dir: 1 }) }, '▶'),
              h('button', { className: 'btn', disabled: !parts || !t.part, onclick: () => act('tricks.part', { n: view.length, all: true }) }, 'All'))))),
      h('div', { className: 'tr-sec' }, h('div', { className: 'label' }, 'Spread over the lights (From → To)'),
        pair('Phase °', 'phaseFrom', 'phaseTo', { step: 45 }),
        pair('Speed ×', 'speedFrom', 'speedTo', { step: 0.25, min: 0.125, start: 1 }),
        pair('Fade s', 'fadeFrom', 'fadeTo', { step: 0.5, min: 0 }),
        pair('Delay s', 'delayFrom', 'delayTo', { step: 0.25, min: 0 })),
      h('div', { className: 'tr-sec' }, h('div', { className: 'label' }, 'Spread a value now'),
        h('div', { className: 'row fanrow' }, fanAttr, h('label', {}, 'From %', fanFrom), h('label', {}, 'To %', fanTo),
          h('button', { className: 'btn small primary', onclick: () => {
            if (!S.sel.size) return toast('Select lights first', true);
            act('prog.fan', { fixtures: effSel(), attr: fanAttr.value, from: fanFrom.value / 100, to: fanTo.value / 100 });
          } }, 'Apply')))),
    h('p', { className: 'hint' }, 'Tricks work on the current selection. Phase and Speed shape effects you run on it. Fade and Delay are saved into the next cue or look you record, so the lights change one after another. Width splits the selection into parts: programming then goes to the active part only.'));
}

export { tricksOn, trickPosClient, dirDial, trickView, effSel, setTricks, stepper, renderTricks };
