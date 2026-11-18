'use strict';
// Fixture library import:
//   GDTF (.gdtf)  - the industry fixture format (from gdtf-share.com, or inside MVR files)
//   Open Fixture Library (.json, "OFL JSON" download from open-fixture-library.org)
// Both become fixture types with a channel list: [{ attr, fine?, def?, fixed?, slots? }].
const { readZip, parseXml } = require('./mvr');

// ----- helpers ----------------------------------------------------------------------
const kids = (el, name) => (el ? el.children.filter((c) => c.name === name) : []);
const kid = (el, name) => kids(el, name)[0];
const clean = (s) => String(s || '').trim();
const attrName = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'control';
const hex = (rgb) => '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('');

// CIE xyY (as GDTF stores wheel colours) -> sRGB hex, brightness normalised
function xyToHex(x, y) {
  if (!(y > 0)) return '#ffffff';
  const X = x / y, Y = 1, Z = (1 - x - y) / y;
  let r = 3.2406 * X - 1.5372 * Y - 0.4986 * Z;
  let g = -0.9689 * X + 1.8758 * Y + 0.0415 * Z;
  let b = 0.0557 * X - 0.2040 * Y + 1.0570 * Z;
  [r, g, b] = [r, g, b].map((v) => Math.max(0, v));
  const m = Math.max(r, g, b) || 1;
  const gamma = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  return hex([r / m, g / m, b / m].map(gamma));
}

// GDTF DMX values look like "128/1" (value / bytes) -> 0..1
function gdtfValue(s) {
  const m = /^(\d+)\/(\d)$/.exec(clean(s));
  if (!m) return null;
  return Number(m[1]) / (Math.pow(256, Number(m[2])) - 1);
}
const gdtfDmx8 = (s) => {
  const v = gdtfValue(s);
  return v === null ? null : Math.round(v * 255);
};

// GDTF attribute names -> our attributes
function mapGdtfAttr(a) {
  const n = clean(a);
  const table = {
    Dimmer: 'dim', Pan: 'pan', Tilt: 'tilt', Zoom: 'zoom', Focus1: 'focus', Iris: 'iris', Frost1: 'frost', Prism1: 'prism', Gobo1: 'gobo',
    Shutter1: 'shutter', StrobeFrequency: 'strobe', Shutter1Strobe: 'strobe',
    ColorAdd_R: 'red', ColorAdd_G: 'green', ColorAdd_B: 'blue', ColorAdd_W: 'white', ColorAdd_WW: 'white', ColorAdd_CW: 'white', ColorAdd_A: 'amber', ColorAdd_UV: 'uv',
    ColorRGB_Red: 'red', ColorRGB_Green: 'green', ColorRGB_Blue: 'blue', ColorRGB_White: 'white',
    ColorSub_C: 'cyan', ColorSub_M: 'magenta', ColorSub_Y: 'yellow', Color1: 'colorwheel', CTO: 'cto', CTC: 'cto', CTB: 'cto',
    Fog: 'haze', FogOutput: 'haze', Haze: 'haze', Fan: 'fan',
  };
  if (table[n]) return table[n];
  return attrName(n);
}

// ----- GDTF -----------------------------------------------------------------------------
function readGdtf(buf, source = 'GDTF') {
  const zip = readZip(buf);
  const descName = [...zip.keys()].find((k) => /(^|\/)description\.xml$/i.test(k));
  if (!descName) throw new Error('This is not a GDTF file (no description.xml)');
  const doc = parseXml(zip.get(descName)().toString('utf8'));
  const ft = kid(kid(doc, 'GDTF'), 'FixtureType');
  if (!ft) throw new Error('GDTF file has no fixture type');
  const fixtureName = [clean(ft.attrs.Manufacturer), clean(ft.attrs.LongName) || clean(ft.attrs.Name)].filter(Boolean).join(' ');
  // Wheels: name -> [slot colours]
  const wheels = {};
  for (const w of kids(kid(ft, 'Wheels'), 'Wheel')) {
    wheels[w.attrs.Name] = kids(w, 'Slot').map((s) => {
      const c = (s.attrs.Color || '').split(',').map(Number);
      return { name: clean(s.attrs.Name), color: c.length >= 2 ? xyToHex(c[0], c[1]) : null };
    });
  }
  const profiles = [];
  for (const mode of kids(kid(ft, 'DMXModes'), 'DMXMode')) {
    const slots = new Map(); // DMX position (1-based) -> channel
    for (const ch of kids(kid(mode, 'DMXChannels'), 'DMXChannel')) {
      const offs = clean(ch.attrs.Offset).split(',').map(Number).filter((n) => n > 0);
      if (!offs.length) continue; // virtual channel
      if (Number(ch.attrs.DMXBreak || 1) > 1) continue; // second DMX break: not supported
      const logical = kids(ch, 'LogicalChannel');
      const lc = logical[0];
      const attr = mapGdtfAttr(lc && lc.attrs.Attribute);
      const funcs = logical.flatMap((l) => kids(l, 'ChannelFunction'));
      const f0 = funcs[0];
      // Default value: on the channel (GDTF 1.0) or on the first function (1.1+)
      let def = gdtfValue(ch.attrs.Default);
      if (def === null && f0) def = gdtfValue(f0.attrs.Default);
      const entry = { attr, label: clean(lc && lc.attrs.Attribute) };
      // Shutter: open is the "Open" channel set or function
      if (attr === 'shutter') {
        const open = funcs.flatMap((f) => [f, ...kids(f, 'ChannelSet')]).find((x) => /open/i.test(x.attrs.Name || ''));
        const v = open && gdtfDmx8(open.attrs.DMXFrom);
        if (v !== null && v !== undefined) def = v / 255;
      }
      // Colour wheel slots with colours
      if (attr === 'colorwheel') {
        const wf = funcs.find((f) => f.attrs.Wheel && wheels[f.attrs.Wheel]) || null;
        if (wf) {
          const list = [];
          for (const set of kids(wf, 'ChannelSet')) {
            const idx = Number(set.attrs.WheelSlotIndex);
            const slot = wheels[wf.attrs.Wheel][idx - 1];
            const dmx = gdtfDmx8(set.attrs.DMXFrom);
            if (slot && dmx !== null) list.push({ dmx, color: slot.color, name: slot.name || set.attrs.Name });
          }
          if (list.length) entry.slots = list;
        }
      }
      if (def !== null) entry.def = def;
      slots.set(offs[0], entry);
      if (offs[1]) slots.set(offs[1], { attr, fine: true });
      for (const extra of offs.slice(2)) slots.set(extra, { fixed: 0 });
    }
    const footprint = Math.max(0, ...slots.keys());
    if (!footprint) continue;
    const channelList = Array.from({ length: footprint }, (_, i) => slots.get(i + 1) || { fixed: 0 });
    profiles.push({ name: `${fixtureName} · ${clean(mode.attrs.Name)} (${footprint}ch)`, channelList, source, mode: clean(mode.attrs.Name), fixture: fixtureName, footprint });
  }
  if (!profiles.length) throw new Error('No usable DMX modes in this GDTF file');
  return profiles;
}

// ----- Open Fixture Library -------------------------------------------------------------------
const OFL_COLORS = { Red: 'red', Green: 'green', Blue: 'blue', White: 'white', 'Warm White': 'white', 'Cold White': 'white', Amber: 'amber', UV: 'uv', Cyan: 'cyan', Magenta: 'magenta', Yellow: 'yellow' };

function oflChannel(key, ch, wheels) {
  const caps = ch.capability ? [ch.capability] : ch.capabilities || [];
  const types = new Set(caps.map((c) => c.type));
  const first = caps[0] || {};
  const out = { label: key };
  const by = (t) => caps.find((c) => c.type === t);
  if (types.has('Intensity')) out.attr = 'dim';
  else if (types.has('ColorIntensity')) out.attr = OFL_COLORS[first.color] || attrName(first.color || key);
  else if (types.has('Pan') || types.has('PanContinuous')) out.attr = 'pan';
  else if (types.has('Tilt') || types.has('TiltContinuous')) out.attr = 'tilt';
  else if (types.has('Zoom')) out.attr = 'zoom';
  else if (types.has('Focus')) out.attr = 'focus';
  else if (types.has('Iris')) out.attr = 'iris';
  else if (types.has('Frost')) out.attr = 'frost';
  else if (types.has('Prism')) out.attr = 'prism';
  else if (types.has('ColorTemperature')) out.attr = 'cto';
  else if (types.has('Fog') || types.has('FogOutput')) out.attr = 'haze';
  else if (types.has('ShutterStrobe')) {
    const open = caps.find((c) => c.type === 'ShutterStrobe' && c.shutterEffect === 'Open');
    if (open && caps.length > 1) {
      out.attr = 'shutter';
      out.def = (open.dmxRange ? open.dmxRange[0] : 255) / 255;
    } else out.attr = 'strobe';
  } else if (types.has('WheelSlot')) {
    const wheelName = (by('WheelSlot') || {}).wheel || key;
    const wheel = wheels[wheelName] || {};
    const wslots = wheel.slots || [];
    const isColor = wslots.some((s) => s.type === 'Color');
    out.attr = isColor ? 'colorwheel' : /gobo/i.test(wheelName) ? 'gobo' : attrName(wheelName);
    if (isColor) {
      const list = [];
      for (const c of caps.filter((x) => x.type === 'WheelSlot' && Number.isInteger(x.slotNumber))) {
        const s = wslots[c.slotNumber - 1];
        if (!s) continue;
        const color = s.type === 'Open' ? '#ffffff' : s.colors && s.colors[0];
        if (color && c.dmxRange) list.push({ dmx: c.dmxRange[0], color, name: s.name || s.type });
      }
      if (list.length) out.slots = list;
    }
  } else if (types.has('NoFunction')) return { fixed: 0, label: key };
  else if (types.has('Maintenance') && caps.length === 1) return { fixed: 0, label: key };
  else out.attr = attrName(key);
  // default value
  let dv = ch.defaultValue;
  if (typeof dv === 'string' && dv.endsWith('%')) dv = (parseFloat(dv) / 100) * 255;
  if (out.def === undefined && Number.isFinite(dv)) out.def = Math.max(0, Math.min(1, dv / 255));
  return out;
}

// Pixel keys / groups of a matrix fixture (pixel bars, LED panels): only how many matters to us,
// because every pixel of a light gets the same colour.
function oflRepeat(fx, repeatFor) {
  if (Array.isArray(repeatFor)) return repeatFor;
  const m = fx.matrix || {};
  if (repeatFor === 'eachPixelGroup') return Object.keys(m.pixelGroups || {});
  if (Array.isArray(m.pixelKeys)) return m.pixelKeys.flat(2).filter(Boolean);
  const [x = 1, y = 1, z = 1] = m.pixelCount || [];
  return Array.from({ length: x * y * z }, (_, i) => String(i + 1));
}
const reEsc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function readOfl(json, name = 'Fixture', manufacturer = '') {
  const fx = typeof json === 'string' ? JSON.parse(json) : json;
  if (fx && fx.redirectTo) throw new Error(`This fixture moved to ${fx.redirectTo}`);
  if (!fx || !(fx.availableChannels || fx.templateChannels) || !Array.isArray(fx.modes)) throw new Error('This is not an Open Fixture Library fixture (.json)');
  const wheels = fx.wheels || {};
  const avail = { ...(fx.availableChannels || {}) };
  const templates = fx.templateChannels || {};
  // Template channels ("Red $pixelKey") match generated names ("Red 3")
  const tplMatch = Object.keys(templates).map((t) => [new RegExp(`^${reEsc(t).replace('\\$pixelKey', '.+')}$`), t]);
  const fineOf = {};
  const addFine = (key, ch) => { for (const alias of ch.fineChannelAliases || []) fineOf[alias] = key; };
  for (const [key, ch] of Object.entries(avail)) addFine(key, ch);
  for (const [key, ch] of Object.entries(templates)) addFine(key, ch);
  const lookup = (key) => {
    if (avail[key]) return [key, avail[key]];
    for (const [re, t] of tplMatch) if (re.test(key)) return [t.replace(/\s*\$pixelKey\s*/, ' ').trim() || t, templates[t]];
    return null;
  };
  const fineParent = (key) => {
    if (fineOf[key]) return fineOf[key];
    for (const [alias, parent] of Object.entries(fineOf)) {
      if (!alias.includes('$pixelKey')) continue;
      const re = new RegExp(`^${reEsc(alias).replace('\\$pixelKey', '(.+)')}$`);
      const m = key.match(re);
      if (m) return parent.replace('$pixelKey', m[1]);
    }
    return null;
  };
  const fixtureName = clean(fx.name) || name;
  const maker = clean((fx.meta && fx.meta.manufacturer) || fx.manufacturer || manufacturer || '');
  const fullName = maker && !fixtureName.toLowerCase().startsWith(maker.toLowerCase()) ? `${maker} ${fixtureName}` : fixtureName;
  const one = (key) => {
    if (key === null) return { fixed: 0 };
    const parentKey = fineParent(key);
    if (parentKey) {
      const p = lookup(parentKey);
      const parent = p ? oflChannel(p[0], p[1], wheels) : {};
      return parent.attr ? { attr: parent.attr, fine: true } : { fixed: 0 };
    }
    const found = lookup(key);
    return found ? oflChannel(found[0], found[1], wheels) : { fixed: 0, label: String(key) };
  };
  return fx.modes.map((mode) => {
    const channelList = [];
    for (const key of mode.channels || []) {
      if (key && typeof key === 'object') {
        if (key.insert !== 'matrixChannels') continue;
        const pixels = oflRepeat(fx, key.repeatFor);
        const tpls = key.templateChannels || [];
        const names = key.channelOrder === 'perChannel'
          ? tpls.flatMap((t) => pixels.map((px) => t === null ? null : t.replace('$pixelKey', px)))
          : pixels.flatMap((px) => tpls.map((t) => t === null ? null : t.replace('$pixelKey', px)));
        for (const n of names) channelList.push(one(n));
      } else channelList.push(one(key));
    }
    return { name: `${fullName} · ${clean(mode.name) || clean(mode.shortName)} (${channelList.length}ch)`, channelList, source: 'Open Fixture Library', mode: clean(mode.name), fixture: fullName, footprint: channelList.length };
  }).filter((p) => p.channelList.length);
}

// Entry point for uploads: a .gdtf file or an OFL .json file
function readFixtureFiles(fileName, buf) {
  const isZip = buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b;
  if (isZip) return readGdtf(buf);
  let json;
  try {
    json = JSON.parse(buf.toString('utf8'));
  } catch {
    throw new Error('Use a .gdtf file or an Open Fixture Library .json file');
  }
  return readOfl(json, String(fileName).replace(/\.json$/i, ''));
}

module.exports = { readFixtureFiles, readGdtf, readOfl, xyToHex };
