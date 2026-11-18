// Screens and LED walls in the 3D setup.
import { $, S, act, fixById, h } from './core.js';
import { stage3d } from './view3d.js';

// ----- screens in the 3D setup ----------------------------------------------------
S.screenSel = null;
function renderScreens() {
  const st = S.show.stage3d;
  const list = st.screens || [];
  const box = $('#screenList');
  if (!box || (box.contains(document.activeElement) && document.activeElement.tagName === 'INPUT')) return;
  const update = (id, patch) => act('stage3d.set', { screens: list.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
  box.replaceChildren(...list.map((sc) => {
    const num = (k, label, step = 0.1) => {
      const i = h('input', { type: 'number', step, value: Math.round((sc[k] || 0) * 100) / 100 });
      i.addEventListener('change', () => update(sc.id, { [k]: Number(i.value) }));
      return h('label', { className: 'mini3' }, label, i);
    };
    return h('div', { className: `modelrow${S.screenSel === sc.id ? ' selscreen' : ''}` },
      h('div', { className: 'row' },
        h('input', { className: 'nm', value: sc.name, style: { flex: 1 }, onchange: (e) => update(sc.id, { name: e.target.value }) }),
        h('button', { className: 'btn small', onclick: () => { S.screenSel = S.screenSel === sc.id ? null : sc.id; stage3d && stage3d.selectScreen(S.screenSel); renderScreens(); } }, S.screenSel === sc.id ? 'Done' : 'Move'),
        h('button', { className: 'btn small warn', onclick: () => act('stage3d.set', { screens: list.filter((x) => x.id !== sc.id) }) }, '✕')),
      h('div', { className: 'row' }, num('x', 'Left/right'), num('y', 'Height (centre)'), num('z', 'Front/back')),
      h('div', { className: 'row' }, num('w', 'Width m'), num('h', 'Height m'), num('rotY', 'Turn °', 5), num('rotX', 'Tilt °', 5)),
      h('div', { className: 'row' },
        h('label', { className: 'check plain', style: { display: 'flex', gap: '6px', alignItems: 'center', fontSize: '12px' } }, h('input', { type: 'checkbox', checked: sc.protect !== false, onchange: (e) => update(sc.id, { protect: e.target.checked }) }), 'Keep light off it'),
        h('label', { className: 'check plain', style: { display: 'flex', gap: '6px', alignItems: 'center', fontSize: '12px' } }, h('input', { type: 'checkbox', checked: sc.slides !== false, onchange: (e) => update(sc.id, { slides: e.target.checked }) }), 'Show slides')));
  }));
}
function addScreen(kind) {
  const st = S.show.stage3d;
  const back = -st.stage.d + 0.05;
  const list = st.screens || [];
  const side = list.length % 2 ? 1 : -1;
  const sc = kind === 'led'
    ? { name: `LED wall ${list.length + 1}`, kind: 'led', x: 0, y: Math.round((st.stage.h + 2.2) * 100) / 100, z: Math.round(back * 100) / 100, w: 6, h: 3.375 }
    : { name: `Screen ${list.length + 1}`, kind: 'projector', x: list.length ? side * (st.stage.w / 2 + 1.5) : 0, y: 3.5, z: list.length ? -st.stage.d / 2 : back, w: 4, h: 2.25, rotY: list.length ? -side * 20 : 0 };
  act('stage3d.set', { screens: [...list, sc] });
}
$('#addScreen').onclick = () => addScreen('projector');
$('#addLed').onclick = () => addScreen('led');
function updateScreenWarn() {
  const el = $('#screenWarn');
  if (!el || !S.show) return;
  const hit = Object.entries(S.live.fixtures || {}).filter(([, l]) => l.x).map(([id]) => (fixById(id) || {}).name).filter(Boolean);
  const mode = S.show.settings.screenProtect || 'warn';
  el.textContent = hit.length && mode !== 'off' ? `${mode === 'block' ? 'Switched off' : 'Shining on a screen'}: ${hit.join(', ')}` : '';
}

export { renderScreens, addScreen, updateScreenWarn };
