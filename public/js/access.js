// Access control on the screen: PIN login, who is logged in, which tabs they see, PIN settings (admin).
//   volunteer -> only the Volunteer screen
//   operator  -> everything except Patch and Setup
//   admin     -> everything
import { $, $$, S, act, authHeaders, connect, emit, getToken, h, on, setToken, toast } from './core.js';

const TABS_FOR = {
  volunteer: ['simple', 'help'],
  operator: ['simple', 'live', 'songs', 'tracks', 'program', 'fx', 'show', 'help'],
  admin: null, // all
};
const ROLE_NAMES = { volunteer: 'Volunteer', operator: 'Operator', admin: 'Admin' };

let pinEntry = '';

function showLogin(message) {
  const box = $('#login');
  box.hidden = false;
  pinEntry = '';
  $('#loginMsg').textContent = message || 'Enter your PIN';
  drawPin();
}

function drawPin() {
  $('#pinDots').textContent = pinEntry ? '●'.repeat(pinEntry.length) : '—';
}

async function tryLogin() {
  try {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: pinEntry }) });
    const j = await r.json();
    if (!j.ok) {
      pinEntry = '';
      drawPin();
      $('#loginMsg').textContent = j.error || 'Wrong PIN';
      $('#login .pinpad').classList.add('shake');
      setTimeout(() => $('#login .pinpad').classList.remove('shake'), 400);
      return;
    }
    setToken(j.token || '');
    $('#login').hidden = true;
    connect();
  } catch {
    $('#loginMsg').textContent = 'Cannot reach the lighting computer';
  }
}

function buildPinPad() {
  const pad = $('#login .keys');
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'OK'];
  pad.replaceChildren(...keys.map((k) => h('button', { className: `btn${k === 'OK' ? ' primary' : ''}`, onclick: () => press(k) }, k)));
}
function press(k) {
  if (k === '⌫') pinEntry = pinEntry.slice(0, -1);
  else if (k === 'OK') return tryLogin();
  else if (pinEntry.length < 8) pinEntry += k;
  drawPin();
}
document.addEventListener('keydown', (e) => {
  if ($('#login').hidden) return;
  if (/^\d$/.test(e.key)) press(e.key);
  else if (e.key === 'Backspace') press('⌫');
  else if (e.key === 'Enter') press('OK');
  else return;
  e.preventDefault();
  e.stopPropagation();
}, true);

// Before connecting: ask the server who we are. No role -> show the PIN pad.
async function startSession() {
  buildPinPad();
  try {
    const r = await fetch('/api/whoami', { headers: authHeaders() });
    const j = await r.json();
    if (!j.role) return showLogin(getToken() ? 'Please log in again' : 'Enter your PIN');
  } catch {}
  connect();
}

function lock() {
  setToken('');
  if (S.es) S.es.close();
  showLogin('Locked. Enter a PIN to continue.');
}

// Show only the tabs this role may use.
function applyRole() {
  const role = S.role || 'admin';
  const allowed = TABS_FOR[role];
  for (const b of $$('#tabs button[data-tab]')) b.hidden = !!allowed && !allowed.includes(b.dataset.tab);
  const active = $('#tabs button.on');
  if (active && active.hidden) $(`#tabs button[data-tab="${allowed[0]}"]`).click();
  const access = (S.show && S.show.settings.access) || {};
  const badge = $('#roleBadge');
  badge.hidden = !access.enabled;
  badge.textContent = `${ROLE_NAMES[role] || role} · Lock`;
  document.body.dataset.role = role;
}

function renderAccessSettings() {
  const box = $('#accessBox');
  if (!box || !S.show) return;
  const a = S.show.settings.access || {};
  const pin = (name, label, help) => h('label', {}, `${label}${(a.levels || []).includes(name) ? ' (set)' : ''}`,
    h('input', { name, type: 'password', inputMode: 'numeric', autocomplete: 'new-password', placeholder: (a.levels || []).includes(name) ? 'leave empty to keep' : '4–8 digits' }),
    h('small', { className: 'hint' }, help));
  const form = h('form', { className: 'form' },
    pin('admin', 'Admin PIN', 'Everything, including patch, settings and PINs.'),
    pin('operator', 'Operator PIN', 'Run and program the show: no patch or settings.'),
    pin('volunteer', 'Volunteer PIN', 'Only the Volunteer screen: GO, song sections, scenes, pads, blackout.'),
    h('label', { className: 'check plain' }, h('input', { type: 'checkbox', name: 'localAdmin', checked: a.localAdmin !== false }), ' This computer is always admin (no PIN on the lighting computer itself)'),
    h('div', { className: 'row wrap' },
      h('button', { className: 'btn primary' }, a.enabled ? 'Save PINs' : 'Turn on PINs'),
      a.enabled ? h('button', { type: 'button', className: 'btn warn', onclick: () => confirm('Turn off PINs? Anyone on the network can then change everything.') && act('access.set', { admin: '', operator: '', volunteer: '' }).then((r) => r && toast('PINs turned off')) }, 'Turn off PINs') : null));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const val = (n) => (f[n].value === '' ? undefined : f[n].value);
    if (!a.enabled && !f.admin.value) return toast('Choose an admin PIN first', true);
    const r = await act('access.set', { admin: val('admin'), operator: val('operator'), volunteer: val('volunteer'), localAdmin: f.localAdmin.checked });
    if (r) toast('PINs saved. Other screens will ask for a PIN.');
  });
  box.replaceChildren(
    h('p', { className: 'hint' }, a.enabled ? `PINs are on (${(a.levels || []).join(', ')}).` : 'Off: anyone on the network can change everything.'),
    form);
}

$('#roleBadge').onclick = lock;
on('state', () => {
  applyRole();
  if (!document.querySelector('#accessBox input:focus')) renderAccessSettings();
});
on('auth', (j) => showLogin(j && j.reauth ? 'PINs changed: please log in again' : 'Enter your PIN'));

export { startSession, lock, applyRole };
