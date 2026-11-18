'use strict';
// Pictures of the stage for the AI assistant.
// - plan(): a 2D plan drawn here on the server, as a PNG (no browser needed): every light is a glow
//   in its colour and brightness at its place on the stage plan (audience at the bottom).
// - describe(): the same in words, per group: brightness, colour, effects.
// (A real 3D render comes from an open app window when there is one: see routes / mcp.)
const zlib = require('zlib');
const { nameKey } = require('./engine/util');
const { NAMED } = require('./engine/actions/compose');
const FX = require('../public/fxmath');

// ----- tiny PNG encoder ------------------------------------------------------------------
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0; // filter: none
    rgb.copy ? rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3) : raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ----- the 2D plan --------------------------------------------------------------------------
function plan(engine, look, w = 800, h = 480) {
  const live = engine.liveState(look).fixtures;
  const img = new Float32Array(w * h * 3);
  // background, and the stage (top 80%)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3;
    const stage = y < h * 0.82 && x > w * 0.04 && x < w * 0.96 && y > h * 0.04;
    const v = stage ? 22 : 12;
    img[i] = v; img[i + 1] = v; img[i + 2] = v + 6;
  }
  const add = (cx, cy, r, rgb, k) => {
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - cx, y - cy) / r;
      if (d > 1) continue;
      const f = k * (1 - d) ** 2;
      const i = (y * w + x) * 3;
      img[i] += rgb[0] * f; img[i + 1] += rgb[1] * f; img[i + 2] += rgb[2] * f;
    }
  };
  for (const f of engine.show.fixtures) {
    const l = live[f.id];
    if (!l) continue;
    const cx = w * (0.06 + 0.88 * (Number(f.x) || 0.5));
    const cy = h * (0.06 + 0.74 * (Number(f.y) || 0.5));
    const [r, g, b] = l.c || [0, 0, 0];
    add(cx, cy, w * 0.11, [r, g, b], 0.9); // the glow on stage
    add(cx, cy, 7, [255, 255, 255], 0.15); // the light itself (visible even when off)
    if (l.x) add(cx, cy, 10, [255, 0, 0], 1); // pointing at a screen
  }
  const rgb = Buffer.alloc(w * h * 3);
  for (let i = 0; i < img.length; i++) rgb[i] = Math.max(0, Math.min(255, Math.round(img[i])));
  return encodePng(w, h, rgb);
}

// Nearest colour name ("deep blue", "amber"…) for an rgb 0-255
function colourName([r, g, b]) {
  if (Math.max(r, g, b) < 12) return 'off';
  const m = Math.max(r, g, b);
  const n = [r / m, g / m, b / m];
  let best = 'white', bd = Infinity;
  for (const [name, hex] of Object.entries(NAMED)) {
    const c = FX.hexToRgb(hex);
    const d = (n[0] - c[0]) ** 2 + (n[1] - c[1]) ** 2 + (n[2] - c[2]) ** 2;
    if (d < bd) { bd = d; best = name; }
  }
  return best;
}

// The stage in words: per group (or role), brightness, colour, effects; plus what is driving it
function describe(engine, look) {
  const live = engine.liveState(look).fixtures;
  const sh = engine.show, rt = engine.rt;
  const groups = sh.groups.length ? sh.groups.map((g) => [g.name, g.fixtures]) : Object.entries(engine.rigRoles()).filter(([, l]) => l.length);
  const covered = new Set(groups.flatMap(([, l]) => l));
  const rest = sh.fixtures.map((f) => f.id).filter((id) => !covered.has(id));
  if (rest.length) groups.push(['other lights', rest]);
  const lines = groups.map(([name, ids]) => {
    const ls = ids.map((id) => live[id]).filter(Boolean);
    if (!ls.length) return null;
    const on = ls.filter((l) => l.d > 0.01);
    if (!on.length) return `- ${name} (${ls.length}): off`;
    const avg = Math.round((on.reduce((s, l) => s + l.d, 0) / ls.length) * 100);
    const names = [...new Set(on.map((l) => colourName(l.c)))];
    const hits = ls.filter((l) => l.x).length;
    return `- ${name} (${ls.length}): ${avg}% average, ${on.length} on, ${names.join(' / ')}${hits ? `, ${hits} pointing at a screen` : ''}`;
  }).filter(Boolean);
  const fx = Object.values(rt.running || {}).map((r) => r.effectId);
  const base = rt.base.kind === 'look' ? (sh.looks.find((l) => l.id === rt.base.lookId) || {}).name : 'cue list';
  const song = engine.song(rt.songId);
  const sec = song && song.sections.find((s) => s.id === rt.sectionId);
  return [
    `On stage: ${base}${song ? ` (song ${song.name}${sec ? ` · ${sec.name}` : ''})` : ''}; service part ${(engine.part(rt.partId) || {}).name}; master ${Math.round(rt.gm * 100)}%${rt.blackout ? ', BLACKOUT on' : ''}${rt.practice ? '; PRACTICE MODE (the real lights are not changing)' : ''}.`,
    ...lines,
    fx.length ? `Live effects running: ${fx.join(', ')}.` : '',
  ].filter(Boolean).join('\n');
}

module.exports = { plan, describe, encodePng, colourName };
