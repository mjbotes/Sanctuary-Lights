// Shared state (S), DOM helpers, talking to the server (act, live updates) and small helpers.
// core.js imports nothing from the other modules: they listen to its events instead
// (on('state' | 'runtime' | 'live', fn)), so there are no start-up order problems.


const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid);
  return el;
};
const pct = (v) => `${Math.round(v * 100)}%`;

const S = {
  show: null,
  profiles: {},
  runtime: { cueIndex: -1, gm: 1, blackout: false, programmer: {}, sceneLevels: {} },
  live: { fixtures: {}, cueProgress: 1, sceneLevels: {} },
  sel: new Set(),
  tab: 'live',
  arranging: false,
  midi: { available: false, ports: [], open: [] },
  editingSong: false,
};

// ----- server communication ----------------------------------------------
let toastTimer;
function toast(msg, bad = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (bad ? ' bad' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), bad ? 4000 : 2000);
}

// ----- login token (when PINs are set) ----------------------------------------
const TOKEN_KEY = 'slToken';
function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}
function setToken(t) {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch {}
}
// Headers for every request to the server (the token says who you are)
const authHeaders = (extra = {}) => ({ ...extra, 'x-sl-token': getToken() });

async function act(type, payload = {}) {
  try {
    const r = await fetch('/api/action', { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ type, ...payload }) });
    const j = await r.json();
    if (j.auth) emit('auth', j);
    if (!j.ok) toast(j.error || 'Something went wrong', true);
    return j.ok ? j : false;
  } catch {
    toast('Cannot reach the lighting computer', true);
    return false;
  }
}

// Throttle continuous controls (faders) so we send at most ~25 updates/s per control.
const pending = new Map();
function actThrottled(key, type, payload) {
  const p = pending.get(key);
  if (p) {
    p.payload = payload;
    return;
  }
  const entry = { payload };
  pending.set(key, entry);
  act(type, payload).finally(() =>
    setTimeout(() => {
      pending.delete(key);
      if (entry.payload !== payload) actThrottled(key, type, entry.payload);
    }, 40)
  );
}

// Tiny event bus: other modules react to updates from the server.
const listeners = {};
function on(event, fn) {
  (listeners[event] ||= []).push(fn);
}
function emit(event, data) {
  for (const fn of listeners[event] || []) {
    try {
      fn(data);
    } catch (e) {
      console.error(`Error while handling "${event}":`, e);
    }
  }
}

function connect() {
  if (S.es) S.es.close();
  const es = new EventSource(`/api/events?token=${encodeURIComponent(getToken())}`);
  S.es = es;
  es.addEventListener('auth', () => {
    setToken('');
    es.close();
    emit('auth', { reauth: true });
  });
  es.addEventListener('state', (e) => {
    const d = JSON.parse(e.data);
    S.show = d.show;
    S.profiles = Object.fromEntries(d.profiles.map((p) => [p.id, p]));
    S.runtime = d.runtime;
    S.midi = d.midi || S.midi;
    S.ppConn = d.pp || null;
    S.oscConn = d.osc || null;
    S.usb = d.usb || null;
    S.role = d.role || 'admin';
    S.history = d.history || {};
    S.version = d.version || '';
    S.update = d.update || null;
    S.health = d.health || null;
    for (const id of [...S.sel]) if (!S.show.fixtures.some((f) => f.id === id)) S.sel.delete(id);
    $('#outErr').textContent = d.outputError || '';
    emit('state', d);
  });
  es.addEventListener('runtime', (e) => {
    S.runtime = JSON.parse(e.data);
    emit('runtime');
  });
  es.addEventListener('snapshot', (e) => emit('snapshot', JSON.parse(e.data)));
  es.addEventListener('live', (e) => {
    S.live = JSON.parse(e.data);
    emit('live');
  });
  es.onopen = () => $('#conn').classList.remove('off');
  es.onerror = () => $('#conn').classList.add('off');
  // iPads and phones close the connection while asleep: reconnect when the screen comes back.
  if (!S.watchConn) {
    S.watchConn = true;
    const check = () => { if (S.es && S.es.readyState === 2 && !document.hidden) connect(); };
    document.addEventListener('visibilitychange', check);
    window.addEventListener('pageshow', check);
    setInterval(check, 5000);
  }
}

// ----- helpers ----------------------------------------------------------
const fixtures = () => (S.show ? S.show.fixtures : []);
const fixById = (id) => fixtures().find((f) => f.id === id);
const profOf = (f) => S.profiles[f.profile] || { attrs: [], footprint: 1, name: '?' };
const selected = () => fixtures().filter((f) => S.sel.has(f.id));
function selAttrs() {
  const set = new Set();
  for (const f of selected()) for (const a of profOf(f).attrs) set.add(a);
  return set;
}
function progValue(attr) {
  for (const f of selected()) {
    const p = S.runtime.programmer[f.id];
    if (p && attr in p) return p[attr];
  }
  return null;
}
function ask(title, value = '') {
  return new Promise((resolve) => {
    const d = $('#prompt');
    $('#promptTitle').textContent = title;
    const inp = $('#promptInput');
    inp.value = value;
    d.returnValue = '';
    d.onclose = () => resolve(d.returnValue === 'ok' ? inp.value : null);
    d.showModal();
    inp.select();
  });
}

export { getToken, setToken, authHeaders, on, emit, $, $$, h, pct, S, toastTimer, toast, act, pending, actThrottled, connect, fixtures, fixById, profOf, selected, selAttrs, progValue, ask };
