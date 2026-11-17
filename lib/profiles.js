'use strict';
// Fixture profiles and attribute metadata.
//
// A profile is a list of DMX channel tokens, one per channel, in order:
//   dim            intensity
//   red green blue white amber uv     colour mixing
//   pan tilt zoom focus strobe haze fan  (or any other word you like)
//   pan.fine       16-bit fine channel for "pan"
//   strobe=0       attribute with a default DMX value (0-255)
//   255            fixed value sent on this channel all the time
//   -              unused channel (always 0)

const ATTRS = {
  dim: { label: 'Intensity', def: 0 },
  red: { label: 'Red', def: 1, color: true },
  green: { label: 'Green', def: 1, color: true },
  blue: { label: 'Blue', def: 1, color: true },
  white: { label: 'White', def: 1, color: true },
  amber: { label: 'Amber', def: 0, color: true },
  uv: { label: 'UV', def: 0, color: true },
  pan: { label: 'Pan', def: 0.5 },
  tilt: { label: 'Tilt', def: 0.5 },
  zoom: { label: 'Zoom', def: 0.5 },
  focus: { label: 'Focus', def: 0.5 },
  strobe: { label: 'Strobe', def: 0 },
  haze: { label: 'Haze', def: 0 },
  fan: { label: 'Fan', def: 0 },
};

const BUILTIN_PROFILES = {
  dimmer: { name: 'Dimmer / conventional (1ch)', channels: 'dim' },
  rgb: { name: 'LED par RGB (3ch)', channels: 'red green blue' },
  drgb: { name: 'LED par Dim+RGB (4ch)', channels: 'dim red green blue' },
  rgbw: { name: 'LED par RGBW (4ch)', channels: 'red green blue white' },
  drgbw: { name: 'LED par Dim+RGBW (5ch)', channels: 'dim red green blue white' },
  drgbws: { name: 'LED par Dim+RGBW+Strobe (6ch)', channels: 'dim red green blue white strobe=0' },
  rgbwau: { name: 'LED par RGBWA+UV (6ch)', channels: 'red green blue white amber uv' },
  drgbwau: { name: 'LED par Dim+RGBWA+UV (7ch)', channels: 'dim red green blue white amber uv' },
  wash: { name: 'Moving head wash (generic 12ch)', channels: 'pan pan.fine tilt tilt.fine 0 dim strobe=0 red green blue white zoom' },
  haze: { name: 'Hazer / fogger (2ch)', channels: 'haze fan' },
};

function parseChannels(spec) {
  const tokens = String(spec || '').split(/[\s,]+/).filter(Boolean);
  if (!tokens.length) throw new Error('A profile needs at least one channel');
  if (tokens.length > 512) throw new Error('Too many channels');
  return tokens.map((tok) => {
    if (tok === '-') return { fixed: 0 };
    if (/^\d+$/.test(tok)) {
      const n = Number(tok);
      if (n > 255) throw new Error(`Fixed value ${tok} is above 255`);
      return { fixed: n };
    }
    const m = /^([a-z][a-z0-9_]*)(\.fine)?(?:=(\d+))?$/i.exec(tok);
    if (!m) throw new Error(`Cannot understand channel "${tok}"`);
    const ch = { attr: m[1].toLowerCase() };
    if (m[2]) ch.fine = true;
    if (m[3] !== undefined) {
      const d = Number(m[3]);
      if (d > 255) throw new Error(`Default ${d} in "${tok}" is above 255`);
      ch.def = d / 255;
    }
    return ch;
  });
}

// Compile a profile into a fast lookup structure used by the engine.
function compileProfile(profile) {
  const channels = parseChannels(profile.channels);
  const attrs = [];
  const defs = {};
  const fineAttrs = new Set(channels.filter((c) => c.fine).map((c) => c.attr));
  for (const c of channels) {
    if (!c.attr || c.fine) continue;
    if (!attrs.includes(c.attr)) attrs.push(c.attr);
    if (c.def !== undefined) defs[c.attr] = c.def;
  }
  const colorAttrs = attrs.filter((a) => ATTRS[a] && ATTRS[a].color);
  const hasDimChannel = attrs.includes('dim');
  // Colour fixtures without a dimmer channel get a "virtual" intensity.
  if (!hasDimChannel && colorAttrs.length) attrs.unshift('dim');
  const hasWhite = attrs.includes('white');
  const defaults = {};
  for (const a of attrs) {
    let d = ATTRS[a] ? ATTRS[a].def : 0;
    // With a white emitter, "open white" means white on and RGB off.
    if (hasWhite && (a === 'red' || a === 'green' || a === 'blue')) d = 0;
    if (defs[a] !== undefined) d = defs[a];
    defaults[a] = d;
  }
  return { name: profile.name, channels, attrs, defaults, colorAttrs, hasDimChannel, hasWhite, fineAttrs, footprint: channels.length };
}

// Approximate the colour a fixture makes, for the on-screen stage view.
function displayColor(look, profile) {
  const dim = look.dim ?? 0;
  if (!profile.colorAttrs.length) {
    if (!profile.attrs.includes('dim')) return [0, 0, 0];
    return [255 * dim, 214 * dim, 170 * dim].map(Math.round); // warm tungsten
  }
  const g = (a) => (profile.attrs.includes(a) ? look[a] ?? 0 : 0);
  let r = g('red') + g('white') + g('amber') + g('uv') * 0.45;
  let gr = g('green') + g('white') * 0.95 + g('amber') * 0.6;
  let b = g('blue') + g('white') * 0.9 + g('uv') * 0.9;
  const max = Math.max(r, gr, b, 1);
  return [r, gr, b].map((v) => Math.round((v / max) * 255 * dim));
}

module.exports = { ATTRS, BUILTIN_PROFILES, parseChannels, compileProfile, displayColor };
