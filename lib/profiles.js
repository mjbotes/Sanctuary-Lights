'use strict';
// Fixture types (profiles) and attribute metadata.
//
// A profile has its DMX channels either as a short text (typed by hand):
//   dim            intensity
//   red green blue white amber uv     additive colour mixing
//   cyan magenta yellow               subtractive colour mixing (CMY)
//   pan tilt zoom focus strobe shutter gobo prism iris frost cto haze fan  (or any other word)
//   pan.fine       16-bit fine channel for "pan"
//   strobe=0       attribute with a default DMX value (0-255)
//   255            fixed value sent on this channel all the time
//   -              unused channel (always 0)
// or as a channel list (imported from GDTF / Open Fixture Library):
//   [{ attr, fine?, def? (0-1), fixed? (0-255), slots?: [{ dmx, color: '#rrggbb', name }] }, ...]
// Optional: curve ('linear' | 'square' | 'scurve' | 'led') changes how intensity maps to DMX.

const ATTRS = {
  dim: { label: 'Intensity', def: 0 },
  red: { label: 'Red', def: 1, color: true },
  green: { label: 'Green', def: 1, color: true },
  blue: { label: 'Blue', def: 1, color: true },
  white: { label: 'White', def: 1, color: true },
  amber: { label: 'Amber', def: 0, color: true },
  uv: { label: 'UV', def: 0, color: true },
  cyan: { label: 'Cyan', def: 0, color: true, sub: true },
  magenta: { label: 'Magenta', def: 0, color: true, sub: true },
  yellow: { label: 'Yellow', def: 0, color: true, sub: true },
  colorwheel: { label: 'Colour wheel', def: 0, color: true, wheel: true },
  pan: { label: 'Pan', def: 0.5 },
  tilt: { label: 'Tilt', def: 0.5 },
  zoom: { label: 'Zoom', def: 0.5 },
  focus: { label: 'Focus', def: 0.5 },
  strobe: { label: 'Strobe', def: 0 },
  shutter: { label: 'Shutter', def: 1 },
  gobo: { label: 'Gobo', def: 0 },
  prism: { label: 'Prism', def: 0 },
  iris: { label: 'Iris', def: 1 },
  frost: { label: 'Frost', def: 0 },
  cto: { label: 'Colour temperature', def: 0 },
  haze: { label: 'Haze', def: 0 },
  fan: { label: 'Fan', def: 0 },
};
const ADDITIVE = ['red', 'green', 'blue', 'white', 'amber', 'uv'];

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
  spot: { name: 'Moving head spot (generic CMY 16ch)', channels: 'pan pan.fine tilt tilt.fine shutter=255 dim dim.fine cyan magenta yellow cto gobo prism focus zoom frost' },
  haze: { name: 'Hazer / fogger (2ch)', channels: 'haze fan' },
};

// Intensity curves: input 0-1 (what you set) -> output 0-1 (what is sent)
const CURVES = {
  linear: (v) => v,
  square: (v) => v * v, // tungsten / dimmer packs: smoother at the bottom
  scurve: (v) => v * v * (3 - 2 * v),
  led: (v) => Math.pow(v, 2.2), // LEDs look brighter than their value; this evens them out
};

function parseChannels(spec) {
  if (Array.isArray(spec)) return cleanChannelList(spec);
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

// Imported channel lists are checked and cleaned.
function cleanChannelList(list) {
  if (!list.length) throw new Error('A profile needs at least one channel');
  if (list.length > 512) throw new Error('Too many channels');
  return list.map((c) => {
    if (!c || c.fixed !== undefined || !c.attr) return { fixed: Math.max(0, Math.min(255, Math.round(Number(c && c.fixed) || 0))) };
    const out = { attr: String(c.attr).toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 24) || 'x' };
    if (c.fine) out.fine = true;
    if (Number.isFinite(c.def)) out.def = Math.max(0, Math.min(1, c.def));
    if (Array.isArray(c.slots) && c.slots.length) {
      out.slots = c.slots.slice(0, 64).map((s) => ({ dmx: Math.max(0, Math.min(255, Math.round(Number(s.dmx) || 0))), color: /^#[0-9a-f]{6}$/i.test(s.color) ? s.color.toLowerCase() : null, name: String(s.name || '').slice(0, 30) }));
    }
    if (c.label) out.label = String(c.label).slice(0, 40);
    return out;
  });
}

const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

// Compile a profile into a fast lookup structure used by the engine.
function compileProfile(profile) {
  const channels = parseChannels(profile.channelList || profile.channels);
  const attrs = [];
  const defs = {};
  const fineAttrs = new Set(channels.filter((c) => c.fine).map((c) => c.attr));
  let wheel = null;
  for (const c of channels) {
    if (!c.attr || c.fine) continue;
    if (!attrs.includes(c.attr)) attrs.push(c.attr);
    if (c.def !== undefined) defs[c.attr] = c.def;
    if (c.attr === 'colorwheel' && c.slots) wheel = c.slots.filter((s) => s.color).map((s) => ({ ...s, rgb: hexRgb(s.color) }));
  }
  const colorAttrs = attrs.filter((a) => ATTRS[a] && ATTRS[a].color);
  const additive = attrs.filter((a) => ADDITIVE.includes(a));
  const hasDimChannel = attrs.includes('dim');
  // Additive colour fixtures without a dimmer channel get a "virtual" intensity.
  if (!hasDimChannel && additive.length) attrs.unshift('dim');
  const hasWhite = attrs.includes('white');
  const defaults = {};
  for (const a of attrs) {
    let d = ATTRS[a] ? ATTRS[a].def : 0;
    // With a white emitter, "open white" means white on and RGB off.
    if (hasWhite && (a === 'red' || a === 'green' || a === 'blue')) d = 0;
    if (defs[a] !== undefined) d = defs[a];
    defaults[a] = d;
  }
  const curve = CURVES[profile.curve] ? profile.curve : 'linear';
  return {
    name: profile.name, channels, attrs, defaults, colorAttrs, additive, hasDimChannel, hasWhite, fineAttrs,
    footprint: channels.length, wheel, cmy: attrs.includes('cyan') || attrs.includes('magenta') || attrs.includes('yellow'),
    curve, curveFn: CURVES[curve],
  };
}

// Short text version of a profile's channels (for lists).
function channelSummary(channels) {
  return parseChannels(channels).map((c) => (c.fixed !== undefined ? String(c.fixed) : `${c.attr}${c.fine ? '.fine' : ''}${c.slots ? `[${c.slots.length}]` : ''}`)).join(' ');
}

// Nearest colour-wheel slot to an rgb colour
function nearestSlot(wheel, rgb) {
  const m = Math.max(...rgb) || 1;
  const t = rgb.map((v) => v / m);
  let best = wheel[0], bestD = Infinity;
  for (const s of wheel) {
    const sm = Math.max(...s.rgb) || 1;
    const d = s.rgb.reduce((acc, v, i) => acc + (v / sm - t[i]) ** 2, 0);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}

// Approximate the colour a fixture makes, for the on-screen stage view.
function displayColor(look, profile) {
  const dim = look.dim ?? 0;
  const g = (a) => (profile.attrs.includes(a) ? look[a] ?? 0 : 0);
  let rgb = null;
  if (profile.additive && profile.additive.length) {
    rgb = [g('red') + g('white') + g('amber') + g('uv') * 0.45, g('green') + g('white') * 0.95 + g('amber') * 0.6, g('blue') + g('white') * 0.9 + g('uv') * 0.9];
  } else if (profile.cmy) {
    rgb = [1 - g('cyan'), 1 - g('magenta'), 1 - g('yellow')];
  } else if (profile.wheel && profile.wheel.length) {
    const dmx = Math.round(g('colorwheel') * 255);
    let slot = profile.wheel[0];
    for (const s of profile.wheel) if (s.dmx <= dmx) slot = s;
    rgb = slot.rgb;
  }
  if (!rgb) {
    if (!profile.attrs.includes('dim')) return [0, 0, 0];
    return [255 * dim, 214 * dim, 170 * dim].map(Math.round); // warm tungsten
  }
  if (profile.attrs.includes('cto') && g('cto')) rgb = rgb.map((v, i) => v * [1, 0.85, 0.6][i] ** g('cto'));
  const max = Math.max(...rgb, 1);
  return rgb.map((v) => Math.round((v / max) * 255 * dim));
}

module.exports = { ATTRS, ADDITIVE, BUILTIN_PROFILES, CURVES, parseChannels, compileProfile, displayColor, channelSummary, nearestSlot };
