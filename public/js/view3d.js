// 3D view: creating it, tools, placing lights and models, MVR import.
import { Stage3D } from '../stage3d.js';
import { $, $$, S, act, fixById, fixtures, h, selected, toast, authHeaders } from './core.js';
import { profileOptions } from './patch.js';
import { resetSlide } from './propresenter.js';
import { renderScreens } from './screens.js';
import { toggleSel } from './selection.js';

// ----- 3D -----------------------------------------------------------------------
let stage3d = null;
let no3d = null;
S.patchSel = null;
try { S.view3d = localStorage.getItem('view3d') === '1'; } catch { S.view3d = false; }
function get3d() {
  if (stage3d || no3d) return stage3d;
  try {
    stage3d = new Stage3D();
    stage3d.onSelect = (id, add) => {
      if (S.tab === 'patch') {
        S.patchSel = id;
        if (id && S.screenSel) { S.screenSel = null; stage3d.selectScreen(null); renderScreens(); }
        stage3d.setSelection(id ? [id] : []);
        renderSel3d();
      } else if (S.tab === 'program' && id) {
        toggleSel(id);
      }
    };
    stage3d.onMove = (id, pos) => act('fixture.edit', { id, pos3d: pos }).then(renderSel3d);
    stage3d.onError = (m) => toast(m, true);
    stage3d.onSelectScreen = (id) => { S.screenSel = id; stage3d.selectScreen(id); renderScreens(); };
    stage3d.onMoveScreen = (id, p) => act('stage3d.set', { screens: S.show.stage3d.screens.map((x) => (x.id === id ? { ...x, x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2) } : x)) });
    if (S.show) {
      stage3d.setShow(S.show, S.profiles);
      stage3d.setLive(S.live.fixtures);
      resetSlide();
    }
  } catch (e) {
    console.error(e);
    no3d = 'This browser cannot show 3D (WebGL is turned off or not supported).';
  }
  return stage3d;
}
function tools3d(el) {
  if (el.querySelector('.tools3d')) return;
  const views = [['front', 'Front'], ['foh', 'FOH'], ['top', 'Top'], ['side', 'Side']];
  const work = h('button', { className: 'btn', title: 'Room light, to see the stage while setting up' }, 'Work light');
  const haze = h('input', { type: 'range', min: 0, max: 100, value: Math.round((stage3d ? stage3d.haze : 0.35) * 100) });
  haze.addEventListener('input', () => stage3d && stage3d.setHaze(haze.value / 100));
  work.onclick = () => {
    S.work = !S.work;
    stage3d && stage3d.setWorkLight(S.work);
    for (const b of $$('.tools3d .work')) b.classList.toggle('on', S.work);
  };
  work.classList.add('work');
  el.append(h('div', { className: 'tools3d' }, ...views.map(([k, l]) => h('button', { className: 'btn', onclick: () => stage3d && stage3d.view(k) }, l)), work, h('label', {}, 'Haze', haze)));
}
function place3d() {
  document.body.classList.toggle('v3d', !!S.view3d);
  for (const b of $$('.viewseg button')) b.classList.toggle('on', (b.dataset.view === '3d') === !!S.view3d);
  const target = S.tab === 'patch' ? ['#patch3d', 'edit'] : S.view3d && S.tab === 'live' ? ['#live3d', 'view'] : S.view3d && S.tab === 'program' ? ['#prog3d', 'select'] : null;
  if (!target) return;
  const el = $(target[0]);
  const s3 = get3d();
  if (!s3) {
    el.replaceChildren(h('div', { className: 'no3d' }, no3d));
    return;
  }
  s3.attach(el, target[1]);
  tools3d(el);
  s3.setSelection(target[1] === 'edit' ? (S.patchSel ? [S.patchSel] : []) : target[1] === 'select' ? [...S.sel] : []);
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('.viewseg button');
  if (!b) return;
  S.view3d = b.dataset.view === '3d';
  try { localStorage.setItem('view3d', S.view3d ? '1' : ''); } catch {}
  place3d();
});

function vecInputs(label, v, onChange) {
  const mk = (k, name) => {
    const inp = h('input', { type: 'number', step: 0.1, value: v ? v[k] : '' });
    inp.addEventListener('change', () => {
      const next = { ...v, [k]: Number(inp.value) };
      onChange(next);
    });
    return h('label', { className: 'mini3' }, name, inp);
  };
  return [h('div', { className: 'hint', style: { margin: '6px 0 2px' } }, label), h('div', { className: 'row' }, mk('x', 'Left/right'), mk('y', 'Height'), mk('z', 'Front/back'))];
}
function renderSel3d() {
  const box = $('#sel3d');
  const f = S.patchSel && fixById(S.patchSel);
  if (!f) {
    box.replaceChildren(h('h3', {}, 'Selected light'), h('p', { className: 'hint' }, 'Tap a light in the 3D view to place it. Drag its arrows to move it, or type the position. Lights not placed yet hang at 6 m in their 2D layout positions.'));
    return;
  }
  const s3 = stage3d;
  const pos = f.pos3d || (s3 ? s3.defaultPos(f) : { x: 0, y: 6, z: 0 });
  const aim = f.aim || (s3 ? s3.defaultAim(f, pos) : { x: 0, y: 0, z: 0 });
  const round = (v) => ({ x: +v.x.toFixed(2), y: +v.y.toFixed(2), z: +v.z.toFixed(2) });
  const beam = h('input', { type: 'number', min: 2, max: 90, value: f.beam || 25 });
  beam.addEventListener('change', () => act('fixture.edit', { id: f.id, beam: beam.value }));
  const st = S.show.stage3d.stage;
  box.replaceChildren(
    h('h3', {}, f.name),
    ...vecInputs('Position (metres)', round(pos), (p) => act('fixture.edit', { id: f.id, pos3d: p })),
    ...vecInputs('Aimed at', round(aim), (a) => act('fixture.edit', { id: f.id, aim: a, pos3d: f.pos3d || pos })),
    h('div', { className: 'row', style: { marginTop: '8px' } }, h('label', { className: 'mini3' }, 'Beam angle (°)', beam)),
    h('div', { className: 'row wrap', style: { marginTop: '10px' } },
      h('button', { className: 'btn small primary', onclick: () => {
        if (!stage3d) return;
        toast('Now tap where this light should point');
        stage3d.startAim(f.id, (id, p) => act('fixture.edit', { id, aim: p, pos3d: f.pos3d || pos }).then(renderSel3d));
      } }, 'Aim: tap the stage'),
      h('button', { className: 'btn small', onclick: () => act('fixture.edit', { id: f.id, pos3d: pos, aim: { x: pos.x, y: Math.min(pos.y - 1, st.h), z: pos.z } }).then(renderSel3d) }, 'Straight down'),
      h('button', { className: 'btn small', onclick: () => act('fixture.edit', { id: f.id, pos3d: pos, aim: { x: 0, y: st.h + 1.5, z: -st.d / 2 } }).then(renderSel3d) }, 'Centre stage')));
}

const UNITS = [['1', 'metres'], ['0.01', 'centimetres'], ['0.001', 'millimetres'], ['0.0254', 'inches'], ['0.3048', 'feet']];
function renderSetup3d() {
  const st = S.show.stage3d;
  for (const inp of $$('#stageSize input')) if (document.activeElement !== inp) inp.value = st.stage[inp.dataset.k];
  const models = st.models;
  const update = (i, patch) => act('stage3d.set', { models: models.map((m, j) => (j === i ? { ...m, ...patch } : m)) });
  const remove = (i) => act('stage3d.set', { models: models.filter((_, j) => j !== i) });
  const list = $('#modelList');
  if (!models.length) list.replaceChildren(h('p', { className: 'hint' }, 'No models yet: the simple stage block is shown.'));
  else {
    const mvrCount = models.filter((m) => m.matrix).length;
    const rows = [];
    if (mvrCount) rows.push(h('div', { className: 'modelrow' }, h('div', { className: 'row' }, h('span', { className: 'nm', style: { flex: 1 } }, `${mvrCount} object${mvrCount === 1 ? '' : 's'} from MVR`),
      h('button', { className: 'btn small warn', onclick: () => confirm('Remove the MVR stage geometry?') && act('stage3d.set', { models: models.filter((m) => !m.matrix) }) }, '✕'))));
    models.forEach((m, i) => {
      if (m.matrix) return;
      const num = (k, label, step = 0.1) => {
        const inp = h('input', { type: 'number', step, value: m[k] ?? 0 });
        inp.addEventListener('change', () => update(i, { [k]: Number(inp.value) }));
        return h('label', { className: 'mini3' }, label, inp);
      };
      const up = h('select', { onchange: (e) => update(i, { rotX: Number(e.target.value) }) },
        ...[[0, 'As is'], [-90, 'Z-up → rotate'], [90, 'Rotate other way'], [180, 'Upside down']].map(([v, l]) => h('option', { value: v, selected: (m.rotX || 0) === v }, l)));
      const unit = h('select', { onchange: (e) => update(i, { scale: Number(e.target.value) }) },
        ...UNITS.map(([v, l]) => h('option', { value: v, selected: Math.abs(Number(v) - (m.scale || 1)) < 1e-9 }, l)));
      rows.push(h('div', { className: 'modelrow' },
        h('div', { className: 'row' }, h('span', { className: 'nm', style: { flex: 1 } }, m.name), h('button', { className: 'btn small warn', onclick: () => remove(i) }, '✕')),
        h('div', { className: 'row' }, num('x', 'X'), num('y', 'Y'), num('z', 'Z'), num('rotY', 'Turn °', 15)),
        h('div', { className: 'row' }, h('label', { className: 'mini3' }, 'Units in file', unit), h('label', { className: 'mini3' }, 'Upright', up))));
    });
    list.replaceChildren(...rows);
  }
  renderSel3d();
}
$('#stageSize').addEventListener('change', (e) => {
  const st = { ...S.show.stage3d.stage, [e.target.dataset.k]: Number(e.target.value) };
  act('stage3d.set', { stage: st });
});

async function upload(url, file) {
  toast(`Uploading ${file.name}…`);
  try {
    const r = await fetch(url, { method: 'POST', body: file, headers: authHeaders() });
    const j = await r.json();
    if (!j.ok) toast(j.error || 'Upload failed', true);
    return j.ok ? j : null;
  } catch {
    toast('Upload failed', true);
    return null;
  }
}
$('#modelFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const j = await upload(`/api/upload/model?name=${encodeURIComponent(file.name)}`, file);
  if (!j) return;
  const models = [...S.show.stage3d.models, { file: j.file, name: j.name, x: 0, y: 0, z: 0, rotX: 0, rotY: 0, scale: 1 }];
  if (await act('stage3d.set', { models })) toast('Model added. Use "Work light" to see it, and set its units if it looks the wrong size.');
});

function guessProfile(type) {
  const t = type.toLowerCase();
  if (/haze|fog/.test(t)) return 'haze';
  if (/dimmer|fresnel|ellipsoidal|profile|par ?64|conventional|source four|tungsten|house/.test(t)) return 'dimmer';
  if (/moving|mover|head|beam|spot|hybrid/.test(t)) return 'wash';
  return 'drgbw';
}
$('#mvrFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const j = await upload('/api/upload/mvr', file);
  if (!j) return;
  if (!j.fixtures.length && !j.models.length) return toast('No lights or geometry found in that file', true);
  $('#mvrSummary').textContent = `${j.fixtures.length} light${j.fixtures.length === 1 ? '' : 's'} and ${j.models.length} 3D object${j.models.length === 1 ? '' : 's'} found.`;
  $('#mvrTypes').replaceChildren(...j.types.map((t) =>
    h('tr', {}, h('td', {}, t.type), h('td', {}, String(t.count)),
      h('td', {}, h('select', { 'data-type': t.type }, ...profileOptions(guessProfile(t.type)))))));
  const dlg = $('#mvrDialog');
  dlg.returnValue = '';
  dlg.onclose = async () => {
    if (dlg.returnValue !== 'ok') return;
    const map = Object.fromEntries($$('#mvrTypes select').map((s) => [s.dataset.type, s.value]));
    const useModels = $('#mvrModels').checked;
    const res = await act('mvr.apply', {
      fixtures: j.fixtures.map((f) => ({ ...f, profile: map[f.type] })),
      models: useModels ? j.models : undefined,
      replace: $('#mvrReplace').checked,
    });
    if (res) toast(res.skipped.length ? `Imported. ${res.skipped.length} light(s) skipped (address doesn't fit): ${res.skipped.slice(0, 5).join(', ')}` : 'Imported', !!res.skipped.length);
  };
  dlg.showModal();
});

export { stage3d, no3d, get3d, tools3d, place3d, vecInputs, renderSel3d, UNITS, renderSetup3d, upload, guessProfile };
