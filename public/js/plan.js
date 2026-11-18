// Service order (run of show) and Planning Center import.
// - The service order shows on the Songs and Volunteer screens: tap an item (or "Next item") to
//   go to that song (worship lights, first section) or that part (Sermon, Video…).
// - Setup → Planning Center: sign in with a Personal Access Token, choose the service type and
//   plan, import. The Songs tab can then import the next plan in one tap.
import { $, $$, S, act, authHeaders, h, on, toast } from './core.js';

const lsGet = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
let pco = { connected: false, types: [], plans: [] };

const api = async (path, body) => {
  const r = await fetch(path, body ? { method: 'POST', body: JSON.stringify(body), headers: authHeaders() } : { headers: authHeaders() });
  const j = await r.json().catch(() => ({ ok: false, error: 'No answer' }));
  if (!j.ok) throw new Error(j.error || 'Failed');
  return j;
};

// ----- service order -----------------------------------------------------------------
function renderOrder() {
  if (!S.show) return;
  const o = S.show.order;
  for (const box of $$('.orderbox')) {
    const big = box.classList.contains('big');
    if (!o || !o.items.length) {
      box.replaceChildren(big ? '' : h('div', { className: 'order-empty' },
        h('span', { className: 'hint', style: { margin: 0 } }, 'No service order yet.'),
        h('button', { className: 'btn small', onclick: quickImport }, 'Import from Planning Center')));
      box.hidden = big;
      continue;
    }
    box.hidden = false;
    const cur = S.runtime.orderItemId;
    box.replaceChildren(
      h('div', { className: 'order-head' },
        h('b', {}, o.title), h('small', {}, o.date || ''),
        h('span', { className: 'grow' }),
        h('button', { className: 'btn small', title: 'Previous item', onclick: () => act('order.go', { dir: -1 }) }, '◀'),
        h('button', { className: 'btn small primary', title: 'Next item in the service', onclick: () => act('order.go', { dir: 1 }) }, 'Next item ▶')),
      h('div', { className: 'order-list' }, ...o.items.map((it) => {
        if (it.kind === 'header') return h('div', { className: 'order-header' }, it.title);
        const part = it.partId && S.show.parts.find((p) => p.id === it.partId);
        const tag = it.kind === 'song' ? '♪' : part ? part.name : '';
        return h('button', {
          className: `order-item ${it.kind}${it.id === cur ? ' cur' : ''}`,
          disabled: it.kind === 'note',
          title: it.kind === 'note' ? 'No lighting change for this item' : it.kind === 'song' ? 'Go to this song (worship lights, first section)' : `Switch to ${part ? part.name : 'this part'}`,
          onclick: () => act('order.go', { id: it.id }),
        }, h('span', { className: 'tag' }, tag), h('span', {}, it.title), it.detail ? h('small', {}, it.detail) : null);
      })),
      big ? '' : h('div', { className: 'row', style: { marginTop: '6px' } },
        h('button', { className: 'btn small', onclick: quickImport }, '↻ Import again'),
        h('button', { className: 'btn small', onclick: () => confirm('Clear the service order? (Songs stay in the set list.)') && act('order.clear') }, 'Clear')));
  }
}

// Import the next upcoming plan of the chosen service type
async function quickImport() {
  try {
    const st = await api('/api/pco/status');
    if (!st.connected) return toast('Connect Planning Center first: Setup → Planning Center (admin PIN)', true);
    let type = lsGet('pcoType');
    if (!type) {
      const t = await api('/api/pco/types');
      if (!t.types.length) return toast('No service types in Planning Center', true);
      type = t.types[0].id;
      lsSet('pcoType', type);
    }
    const p = await api(`/api/pco/plans?type=${encodeURIComponent(type)}`);
    if (!p.plans.length) return toast('No upcoming plans for that service type', true);
    await doImport(type, p.plans[0].id);
  } catch (e) {
    toast(e.message, true);
  }
}

async function doImport(type, plan) {
  toast('Reading the plan from Planning Center…');
  const design = lsGet('pcoDesign') !== '0';
  const setOnly = lsGet('pcoSetOnly') !== '0';
  const r = await api('/api/pco/import', { type, plan, design, setOnly });
  const known = r.songs - r.created;
  toast(`"${r.title}": ${r.songs} song${r.songs === 1 ? '' : 's'}. ${known ? `${known} already programmed (lighting kept${r.rearranged ? `, ${r.rearranged} with this week's arrangement` : ''}). ` : ''}${r.created ? `${r.created} new${r.designed ? `, lit automatically` : ''}. ` : ''}${r.items} items in the service order.`);
}

// ----- Setup → Planning Center ------------------------------------------------------------
async function renderPco() {
  const box = $('#pcoBox');
  if (!box) return;
  try {
    pco.connected = (await api('/api/pco/status')).connected;
  } catch {
    pco.connected = false;
  }
  if (!pco.connected) {
    const id = h('input', { placeholder: 'Application ID', autocomplete: 'off' });
    const secret = h('input', { placeholder: 'Secret', type: 'password', autocomplete: 'off' });
    box.replaceChildren(
      h('p', { className: 'hint' }, 'Bring each Sunday\'s plan in: songs in order with their keys, BPM and sections, and the service order (welcome, videos, sermon…). Create a Personal Access Token at ',
        h('a', { href: 'https://api.planningcenteronline.com/oauth/applications', target: '_blank', rel: 'noopener' }, 'api.planningcenteronline.com'), ' (Personal Access Tokens → New), and paste its Application ID and Secret here. They are stored on the lighting computer only.'),
      h('div', { className: 'row' }, id, secret, h('button', { className: 'btn primary', onclick: async () => {
        try {
          await api('/api/pco/connect', { appId: id.value, secret: secret.value });
          toast('Planning Center connected');
          renderPco();
        } catch (e) { toast(e.message, true); }
      } }, 'Connect')));
    return;
  }
  const typeSel = h('select', { onchange: async (e) => { lsSet('pcoType', e.target.value); await loadPlans(e.target.value); } });
  const planSel = h('select', {});
  const design = h('input', { type: 'checkbox', checked: lsGet('pcoDesign') !== '0', onchange: (e) => lsSet('pcoDesign', e.target.checked ? '1' : '0') });
  async function loadPlans(type) {
    planSel.replaceChildren(h('option', {}, 'Loading…'));
    try {
      const p = await api(`/api/pco/plans?type=${encodeURIComponent(type)}`);
      planSel.replaceChildren(...(p.plans.length ? p.plans.map((x) => h('option', { value: x.id }, `${x.dates}${x.title ? ` · ${x.title}` : ''}`)) : [h('option', { value: '' }, 'No upcoming plans')]));
    } catch (e) { planSel.replaceChildren(h('option', { value: '' }, e.message)); }
  }
  box.replaceChildren(
    h('p', { className: 'on-ok' }, '● Connected'),
    h('div', { className: 'row wrap' }, h('label', { className: 'form' }, 'Service type', typeSel), h('label', { className: 'form' }, 'Plan', planSel)),
    h('label', { className: 'check plain' }, design, ' Light new songs automatically (✨ Light this song for me)'),
    h('label', { className: 'check plain' }, h('input', { type: 'checkbox', checked: lsGet('pcoSetOnly') !== '0', onchange: (e) => lsSet('pcoSetOnly', e.target.checked ? '1' : '0') }), ' Set list = this service only (other songs go to the song library, still lit)'),
    h('div', { className: 'row' },
      h('button', { className: 'btn primary', onclick: () => planSel.value && doImport(typeSel.value, planSel.value).catch((e) => toast(e.message, true)) }, 'Import this plan'),
      h('button', { className: 'btn small warn', onclick: async () => { if (!confirm('Disconnect Planning Center?')) return; await api('/api/pco/disconnect', {}).catch(() => {}); renderPco(); } }, 'Disconnect')),
    h('p', { className: 'hint' }, 'Importing adds new songs with their arrangement as sections, and fills the service order on the Songs and Volunteer screens. Songs you have programmed before (even in the song library, or named slightly differently) keep all their lighting; their sections follow this week\'s arrangement, and new sections get the look of their kind.'));
  try {
    const t = await api('/api/pco/types');
    typeSel.replaceChildren(...t.types.map((x) => h('option', { value: x.id, selected: x.id === lsGet('pcoType') }, x.name)));
    if (typeSel.value) loadPlans(typeSel.value);
  } catch (e) { toast(e.message, true); }
}

on('state', renderOrder);
on('runtime', renderOrder);
$('nav button[data-tab=setup]').addEventListener('click', () => renderPco());

export { renderOrder, quickImport };
