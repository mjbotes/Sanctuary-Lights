// Help tab: the user guides (public/docs/*.md), with search, links between guides and printing.
// The "?" button opens the guide for the screen you are on.
import { $, $$, S, h } from './core.js';
import { render, plain } from './markdown.js';

const GUIDES = [
  ['index.md', 'Start here'],
  ['volunteer-card.md', 'Volunteer quick card'],
  ['sunday.md', 'Running a service'],
  ['troubleshooting.md', 'When something goes wrong'],
  ['getting-started.md', 'Getting started'],
  ['connections.md', 'Connecting lights and gear'],
  ['looks-and-cues.md', 'Looks, cues and scenes'],
  ['songs.md', 'Songs'],
  ['service-parts.md', 'Service parts'],
  ['propresenter.md', 'ProPresenter'],
  ['live-effects.md', 'Live control, pads and effects'],
  ['tracks.md', 'Tracks'],
  ['stage-3d.md', '3D stage'],
  ['safety.md', 'Safety, PINs and backups'],
  ['glossary.md', 'Glossary'],
];
// Which guide the "?" button opens on each tab
const FOR_TAB = {
  simple: 'volunteer-card.md', live: 'sunday.md', songs: 'songs.md', tracks: 'tracks.md', program: 'looks-and-cues.md',
  fx: 'live-effects.md', show: 'looks-and-cues.md', patch: 'looks-and-cues.md', setup: 'connections.md',
};

const cache = new Map();
let current = 'index.md';
let returnTab = null;

async function load(file) {
  if (!cache.has(file)) {
    const r = await fetch(`docs/${file}`);
    cache.set(file, r.ok ? await r.text() : `# Not found\n\nThe guide "${file}" is missing.`);
  }
  return cache.get(file);
}

// Links between guides stay in the Help tab; other links open in a new window
const linkFn = (href) => (/^[a-z0-9-]+\.md(#.*)?$/.test(href) ? `#help/${href}` : href);

async function show(file, anchor) {
  current = file;
  const md = await load(file);
  const art = $('#helpArticle');
  art.innerHTML = render(md, linkFn);
  for (const a of art.querySelectorAll('a[href^="#help/"]')) {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const [f, hash] = a.getAttribute('href').slice(6).split('#');
      show(f, hash);
    });
  }
  renderList();
  const target = anchor && art.querySelector(`#${CSS.escape(anchor)}`);
  if (target) target.scrollIntoView();
  else art.scrollTop = 0;
  $('#tab-help').scrollTop = 0;
}

function renderList(results) {
  const list = $('#helpList');
  if (results) {
    list.replaceChildren(...(results.length ? results.map((r) => h('button', { className: 'help-item res', onclick: () => show(r.file) },
      h('b', {}, r.title), h('small', {}, r.snippet))) : [h('p', { className: 'hint' }, 'Nothing found. Try another word.')]));
    return;
  }
  list.replaceChildren(...GUIDES.map(([file, title], i) => h('button', { className: `help-item${file === current ? ' on' : ''}${i === 4 ? ' gap' : ''}`, onclick: () => show(file) }, title)));
}

async function search(q) {
  q = q.trim().toLowerCase();
  if (q.length < 2) return renderList();
  await Promise.all(GUIDES.map(([f]) => load(f)));
  const words = q.split(/\s+/);
  const results = [];
  for (const [file, title] of GUIDES) {
    const text = plain(cache.get(file));
    const low = text.toLowerCase();
    if (!words.every((w) => low.includes(w))) continue;
    const at = low.indexOf(words[0]);
    const score = words.reduce((n, w) => n + low.split(w).length - 1, 0) + (title.toLowerCase().includes(q) ? 50 : 0);
    results.push({ file, title, score, snippet: `…${text.slice(Math.max(0, at - 50), at + 90).trim()}…` });
  }
  results.sort((a, b) => b.score - a.score);
  renderList(results);
}

// Open Help at a guide (from the "?" button: the guide for the current screen)
function openHelp(file) {
  if (S.tab !== 'help') returnTab = S.tab;
  $('nav button[data-tab=help]').click();
  show(file || FOR_TAB[returnTab] || current);
}

$('#helpSearch').addEventListener('input', (e) => search(e.target.value));
$('#helpPrint').addEventListener('click', () => window.print());
$('#helpBack').addEventListener('click', () => {
  const b = returnTab && $(`nav button[data-tab="${returnTab}"]`);
  if (b && !b.hidden) b.click();
});
$('#helpBtn').onclick = () => openHelp();
$('#helpFull') && $('#helpFull').addEventListener('click', () => { $('#helpDialog').close(); openHelp('live-effects.md'); });
// Opening the Help tab from the menu shows the start page the first time
$('nav button[data-tab=help]').addEventListener('click', () => { if (!$('#helpArticle').childElementCount) show(current); });

export { openHelp, GUIDES };
