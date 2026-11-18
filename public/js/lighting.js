// Lighting extras: importing fixture types (GDTF / Open Fixture Library), tracking cue list switch,
// timecode display and the status of input from another desk.
import { $, S, act, authHeaders, h, on, toast } from './core.js';

// ----- timecode text <-> seconds (30 fps display) -------------------------------------
const FPS = 30;
function fmtTc(seconds, fps = FPS) {
  const s = Math.max(0, seconds || 0);
  const t = Math.floor(s);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(t / 3600))}:${p(Math.floor((t % 3600) / 60))}:${p(t % 60)}:${p(Math.floor((s % 1) * fps))}`;
}
// "01:02:03:12", "1:02:03", "2:30" or "62.5" -> seconds; null if it cannot be read
function parseTc(text, fps = FPS) {
  const s = String(text || '').trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const parts = s.split(/[:;.]/).map(Number);
  if (!parts.length || parts.length > 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [hh, mm, ss, ff] = parts.length === 4 ? parts : parts.length === 3 ? [...parts, 0] : [0, ...parts, 0];
  return hh * 3600 + mm * 60 + ss + ff / fps;
}

// ----- fixture import ----------------------------------------------------------------
$('#fixtureFile').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  const found = [];
  for (const file of files) {
    try {
      const r = await fetch(`/api/upload/fixture?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file, headers: authHeaders() });
      const j = await r.json();
      if (!j.ok) toast(`${file.name}: ${j.error}`, true);
      else found.push(...j.profiles);
    } catch {
      toast(`Could not read ${file.name}`, true);
    }
  }
  chooseModes(found);
});

// Tick the modes to add (from files or the library)
export function chooseModes(found, onDone) {
  if (!found.length) return;
  $('#fixtureList').replaceChildren(...found.map((p, i) => {
    const box = h('input', { type: 'checkbox', checked: found.length <= 3 });
    box.dataset.i = i;
    return h('label', {}, box, h('span', {}, p.name), h('small', {}, p.source));
  }));
  const dlg = $('#fixtureDialog');
  dlg.returnValue = '';
  dlg.onclose = async () => {
    if (dlg.returnValue !== 'ok') return;
    const chosen = [...$('#fixtureList').querySelectorAll('input:checked')].map((b) => found[b.dataset.i]);
    if (!chosen.length) return;
    const r = await act('profile.import', { profiles: chosen });
    if (r) toast(`${r.added.length} fixture type${r.added.length === 1 ? '' : 's'} added. Choose them when you add lights.`);
    if (r && onDone) onDone(r.added);
  };
  dlg.showModal();
}

// ----- Open Fixture Library search ---------------------------------------------------
let oflTimer = null;
async function oflSearch() {
  const q = $('#oflQuery').value.trim();
  const box = $('#oflResults');
  if (q.length < 2) return box.replaceChildren();
  try {
    const j = await fetch(`/api/ofl/search?q=${encodeURIComponent(q)}`, { headers: authHeaders() }).then((r) => r.json());
    if (!j.ok) return box.replaceChildren(h('p', { className: 'hint' }, j.error || 'Search failed'));
    if (!j.results.length) return box.replaceChildren(h('p', { className: 'hint' }, `Nothing found for "${q}". Try only the model name, or make the fixture type by hand below.`));
    const close = !j.results[0].exact;
    box.replaceChildren(
      ...(close ? [h('p', { className: 'hint' }, `No exact match for "${q}". Close ones:`)] : []),
      ...j.results.slice(0, 12).map((f) => h('button', { className: 'oflrow', title: f.modes.join(', '), onclick: (e) => oflPick(f, e.currentTarget) },
        h('b', {}, f.name), h('span', {}, f.manufacturer), h('small', {}, `${f.categories.join(', ')} · ${f.modes.length} mode${f.modes.length === 1 ? '' : 's'}`))));
  } catch {
    box.replaceChildren(h('p', { className: 'hint' }, 'Search failed'));
  }
}
export async function oflPick(f, btn, onDone) {
  if (btn) btn.disabled = true;
  try {
    const j = await fetch('/api/ofl/profiles', { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ key: f.key }) }).then((r) => r.json());
    if (!j.ok) return toast(j.error, true);
    chooseModes(j.profiles, onDone);
  } catch {
    toast('Could not get that fixture', true);
  } finally {
    if (btn) btn.disabled = false;
  }
}
$('#oflQuery').addEventListener('input', () => {
  clearTimeout(oflTimer);
  oflTimer = setTimeout(oflSearch, 200);
});

// ----- tracking cue list --------------------------------------------------------------
$('#trackingToggle').addEventListener('change', (e) => act('settings.update', { settings: { tracking: e.target.checked } }));

// ----- status lines -------------------------------------------------------------------
function renderStatus() {
  if (!S.show) return;
  $('#trackingToggle').checked = !!S.show.settings.tracking;
  const di = S.dmxIn;
  const el = $('#dmxInStatus');
  if (el) {
    if (!di || !di.enabled) el.textContent = 'Off.';
    else if (di.error) el.textContent = `● ${di.error}`;
    else if (!di.universes.length) el.textContent = '● Listening… nothing received yet.';
    else el.textContent = di.universes.map((u) => `${u.live ? '●' : '○'} Universe ${u.universe} from ${u.source}${u.live ? '' : ' (stopped)'}`).join(' · ');
  }
}
function renderTc() {
  const el = $('#tcStatus');
  if (!el) return;
  const tc = S.live && S.live.tc;
  el.textContent = tc ? `${tc.running ? '▶' : '■'} ${fmtTc(tc.s, Math.round(tc.fps) || FPS)} (${tc.fps} fps)` : 'No timecode received.';
}

on('state', (d) => {
  S.dmxIn = d && d.dmxIn;
  renderStatus();
});
on('live', renderTc);

export { fmtTc, parseTc };
