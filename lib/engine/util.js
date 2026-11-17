'use strict';
// Small helpers shared by the engine: ids, maths, colour and name matching.
const crypto = require('crypto');


const uid = () => crypto.randomBytes(5).toString('hex');

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

const lerp = (a, b, t) => a + (b - a) * t;

const round4 = (v) => Math.round(v * 10000) / 10000;

const ease = (t) => t * t * (3 - 2 * t); // smoothstep: gentle start and end


// Colour channel values for a fixture making the given RGB colour (0-1).
// Fixtures with a white emitter use it for the common part of R, G and B.
function colorValues(prof, [r, g, b]) {
  const has = (x) => prof.attrs.includes(x);
  const out = {};
  const w = has('white') ? Math.min(r, g, b) : 0;
  if (has('red')) out.red = round4(r - w);
  if (has('green')) out.green = round4(g - w);
  if (has('blue')) out.blue = round4(b - w);
  if (has('white')) out.white = round4(w);
  if (has('amber')) out.amber = 0;
  if (has('uv')) out.uv = 0;
  if (!has('red') && !has('green') && !has('blue') && has('white')) out.white = Math.max(r, g, b);
  return out;
}


function hsvToRgb(h, s, v) {
  const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][((i % 6) + 6) % 6];
}


// Names like "Verse 1", "verse", "VERSE 1" -> comparable forms
const nameKey = (n) => String(n || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

const baseKey = (n) => nameKey(String(n || '').replace(/\s*\d+\s*$/, ''));


// Find the section of a song for a ProPresenter group name.
function matchSection(sections, groupName) {
  const k = nameKey(groupName), b = baseKey(groupName);
  return sections.find((s) => nameKey(s.name) === k)
    || (/1$/.test(k) ? sections.find((s) => nameKey(s.name) === b) : null) // "Verse 1" -> "Verse"
    || sections.find((s) => baseKey(s.name) === b)
    || null;
}

const isHex = (c) => /^#[0-9a-f]{6}$/i.test(String(c || ''));

const rgbToHex = (rgb) => '#' + rgb.map((v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0')).join('');

// 'pal:1' -> 0 ; also accepts 'primary', 'secondary', 'tertiary', 'p', 's', 't', 1-3
function palIndex(x) {
  const k = String(x ?? '').toLowerCase().trim();
  const m = /^pal:([123])$/.exec(k);
  if (m) return Number(m[1]) - 1;
  const names = { primary: 0, p: 0, '1': 0, secondary: 1, s: 1, '2': 1, tertiary: 2, t: 2, '3': 2 };
  return k in names ? names[k] : -1;
}


const num = (v, name) => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number`);
  return n;
};

const ids = (a) => (Array.isArray(a.fixtures) ? a.fixtures : []);

module.exports = { uid, clamp01, lerp, round4, ease, colorValues, hsvToRgb, nameKey, baseKey, matchSection, isHex, rgbToHex, palIndex, num, ids };
