// Effect maths shared by the server (Node) and the browser (preview).
// An effect has one or more layers. Each layer moves one attribute with a waveform.
// Phase settings spread the effect across the lights in selection order.
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const frac = (t) => t - Math.floor(t);

  function hash(a, b, c) {
    const s = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453;
    return s - Math.floor(s);
  }

  const WAVES = {
    sine: 'Sine (smooth)',
    triangle: 'Triangle',
    saw: 'Saw up',
    ramp: 'Saw down',
    square: 'On / off',
    pulse: 'Hit (fast attack, fade)',
    random: 'Random',
  };

  // Value 0..1 of a waveform at cycle position t. width is the "on" share for square/pulse;
  // a width of 0 means "one light at a time" (1 / number of lights).
  function wave(kind, t, width, seed, layer) {
    const f = frac(t);
    switch (kind) {
      case 'triangle': return f < 0.5 ? f * 2 : 2 - f * 2;
      case 'saw': return f;
      case 'ramp': return 1 - f;
      case 'square': return f < width ? 1 : 0;
      case 'pulse': return f < width ? Math.pow(1 - f / width, 2) : 0;
      case 'random': return hash(Math.floor(t), seed, layer) < width ? 1 : 0;
      default: return 0.5 - 0.5 * Math.cos(TAU * f);
    }
  }

  // Where light number i (of n) sits in the effect, as a fraction of a cycle.
  function phaseOf(i, n, fx) {
    const g = Math.max(1, Math.floor(fx.groups || 1));
    let k = Math.floor(i / g);
    let m = Math.ceil(n / g);
    const w = Math.max(1, Math.floor(fx.wings || 1));
    if (w > 1 && m > 1) {
      const size = Math.ceil(m / w);
      const wing = Math.floor(k / size);
      k = k % size;
      if (wing % 2 === 1) k = size - 1 - k;
      m = size;
    }
    const from = Number(fx.phaseFrom) || 0;
    const to = fx.phaseTo === undefined ? 0 : Number(fx.phaseTo);
    const span = to - from;
    const full = span !== 0 && Math.abs(span) % 360 === 0;
    const pos = m <= 1 ? 0 : full ? k / m : k / (m - 1);
    return { phase: (from + span * pos) / 360, slots: m };
  }

  // Cycles elapsed for an effect: speed is { beats: n } (beats per cycle) or { hz: n }.
  function cyclesAt(fx, beats, seconds, rate) {
    const sp = fx.speed || { beats: 1 };
    const r = rate || 1;
    if (sp.hz) return seconds * sp.hz * r;
    return (beats / Math.max(0.0625, sp.beats || 1)) * r;
  }

  // Evaluate every layer for light i of n. Returns [{ layer, w, value }].
  // ov (optional, from selection tricks): { phase, slots, speed } replaces the effect's own spread.
  function evaluate(fx, i, n, cycles, ov) {
    const own = phaseOf(i, n, fx);
    const phase = ov && ov.phase !== undefined ? ov.phase : own.phase;
    const slots = ov && ov.slots ? ov.slots : own.slots;
    if (ov && ov.speed) cycles *= ov.speed;
    const dir = fx.dir === -1 ? -1 : 1;
    return (fx.layers || []).map((layer, li) => {
      const width = layer.width === 0 || layer.width === undefined ? (['square', 'pulse'].includes(layer.wave) ? 1 / Math.max(1, slots) : 0.5) : layer.width;
      const t = cycles * dir * (layer.speed || 1) - phase + (layer.offset || 0) / 360;
      const w = wave(layer.wave, t, width, Math.floor(i / Math.max(1, fx.groups || 1)), li);
      const low = layer.low ?? 0, high = layer.high ?? 1;
      return { layer, w, value: low + (high - low) * w };
    });
  }

  function hsvToRgb(h, s, v) {
    const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][((i % 6) + 6) % 6];
  }
  const hexToRgb = (hex) => [1, 3, 5].map((k) => parseInt(String(hex || '#ffffff').slice(k, k + 2), 16) / 255 || 0);

  // Layer attributes: dim, hue (rainbow), color (mix between colorA and colorB), pan, tilt, zoom, focus, strobe, ...
  // Modes: 'scale' (dimmer: multiplies the planned level), 'abs' (low..high), 'rel' (moves around the planned value; size = high - low).
  const ATTRS = {
    dim: 'Intensity', hue: 'Colour: rainbow', color: 'Colour: A ↔ B', palette: 'Colour: primary → secondary → tertiary', pan: 'Pan', tilt: 'Tilt', zoom: 'Zoom', focus: 'Focus', strobe: 'Strobe channel',
  };

  const L = (o) => ({ wave: 'sine', mode: 'abs', low: 0, high: 1, width: 0, speed: 1, offset: 0, ...o });
  const BUILTIN = [
    // Dimmer
    { id: 'pulse', name: 'Pulse', cat: 'dim', speed: { beats: 1 }, layers: [L({ attr: 'dim', mode: 'scale', wave: 'pulse', low: 0.25, width: 1 })] },
    { id: 'chase', name: 'Chase', cat: 'dim', speed: { beats: 4 }, phaseTo: 360, layers: [L({ attr: 'dim', mode: 'scale', wave: 'square' })] },
    { id: 'chase-soft', name: 'Soft chase', cat: 'dim', speed: { beats: 4 }, phaseTo: 360, layers: [L({ attr: 'dim', mode: 'scale', wave: 'pulse', width: 0.5 })] },
    { id: 'dim-wave', name: 'Wave', cat: 'dim', speed: { beats: 4 }, phaseTo: 360, layers: [L({ attr: 'dim', mode: 'scale', low: 0.1 })] },
    { id: 'breathe', name: 'Breathe', cat: 'dim', speed: { beats: 8 }, layers: [L({ attr: 'dim', mode: 'scale', low: 0.3 })] },
    { id: 'sparkle', name: 'Sparkle', cat: 'dim', speed: { beats: 0.5 }, layers: [L({ attr: 'dim', mode: 'scale', wave: 'random', low: 0.1, width: 0.45 })] },
    { id: 'odd-even', name: 'Odd / even', cat: 'dim', speed: { beats: 2 }, phaseTo: 180, layers: [L({ attr: 'dim', mode: 'scale', wave: 'square', width: 0.5 })] },
    { id: 'center-out', name: 'Centre out', cat: 'dim', speed: { beats: 2 }, phaseTo: 270, wings: 2, dir: -1, layers: [L({ attr: 'dim', mode: 'scale', wave: 'pulse', width: 0.6 })] },
    { id: 'strobe', name: 'Strobe', cat: 'dim', speed: { hz: 10 }, layers: [L({ attr: 'dim', mode: 'scale', wave: 'square', width: 0.25 })] },
    { id: 'beat-strobe', name: 'Beat strobe', cat: 'dim', speed: { beats: 0.25 }, layers: [L({ attr: 'dim', mode: 'scale', wave: 'square', width: 0.3 })] },
    { id: 'random-strobe', name: 'Random strobe', cat: 'dim', speed: { hz: 12 }, layers: [L({ attr: 'dim', mode: 'scale', wave: 'random', width: 0.2 })] },
    // Colour
    { id: 'rainbow', name: 'Rainbow', cat: 'color', speed: { beats: 8 }, phaseTo: 360, layers: [L({ attr: 'hue', wave: 'saw' })] },
    { id: 'rainbow-all', name: 'Colour cycle', cat: 'color', speed: { beats: 16 }, layers: [L({ attr: 'hue', wave: 'saw' })] },
    { id: 'color-chase', name: 'Red / blue chase', cat: 'color', speed: { beats: 2 }, phaseTo: 360, layers: [L({ attr: 'color', wave: 'square', width: 0.5, colorA: '#ff0000', colorB: '#0028ff' })] },
    { id: 'pal-chase', name: 'Palette chase (P/S/T)', cat: 'color', speed: { beats: 3 }, phaseTo: 360, layers: [L({ attr: 'palette', wave: 'saw' })] },
    { id: 'pal-fade', name: 'Palette fade', cat: 'color', speed: { beats: 12 }, layers: [L({ attr: 'palette', wave: 'saw', smooth: true })] },
    { id: 'pal-spread', name: 'Palette spread', cat: 'color', speed: { beats: 24 }, phaseTo: 360, layers: [L({ attr: 'palette', wave: 'saw', smooth: true })] },
    { id: 'pal-alt', name: 'Primary / secondary alternate', cat: 'color', speed: { beats: 2 }, phaseTo: 180, layers: [L({ attr: 'color', wave: 'square', width: 0.5, colorA: 'pal:1', colorB: 'pal:2' })] },
    { id: 'warm-cool', name: 'Warm ↔ cool fade', cat: 'color', speed: { beats: 8 }, phaseTo: 180, layers: [L({ attr: 'color', colorA: '#ffb070', colorB: '#a8c8ff' })] },
    { id: 'fire', name: 'Fire flicker', cat: 'color', speed: { beats: 0.25 }, layers: [L({ attr: 'color', wave: 'random', width: 0.5, colorA: '#ff2a00', colorB: '#ff9a00' }), L({ attr: 'dim', mode: 'scale', wave: 'random', low: 0.6, width: 0.6, speed: 1.3 })] },
    // Position (moving heads)
    { id: 'circle', name: 'Circle', cat: 'position', speed: { beats: 4 }, layers: [L({ attr: 'pan', mode: 'rel', low: 0, high: 0.12 }), L({ attr: 'tilt', mode: 'rel', low: 0, high: 0.12, offset: 90 })] },
    { id: 'circle-phase', name: 'Circle (spread)', cat: 'position', speed: { beats: 4 }, phaseTo: 360, layers: [L({ attr: 'pan', mode: 'rel', low: 0, high: 0.12 }), L({ attr: 'tilt', mode: 'rel', low: 0, high: 0.12, offset: 90 })] },
    { id: 'fig8', name: 'Figure 8', cat: 'position', speed: { beats: 4 }, layers: [L({ attr: 'pan', mode: 'rel', low: 0, high: 0.15 }), L({ attr: 'tilt', mode: 'rel', low: 0, high: 0.08, speed: 2 })] },
    { id: 'ballyhoo', name: 'Ballyhoo', cat: 'position', speed: { beats: 4 }, phaseTo: 360, layers: [L({ attr: 'pan', mode: 'rel', low: 0, high: 0.25 }), L({ attr: 'tilt', mode: 'rel', wave: 'triangle', low: 0, high: 0.2, speed: 1.5 })] },
    { id: 'pan-sweep', name: 'Pan sweep', cat: 'position', speed: { beats: 4 }, phaseTo: 120, wings: 2, layers: [L({ attr: 'pan', mode: 'rel', low: 0, high: 0.3 })] },
    { id: 'tilt-saw', name: 'Tilt saw', cat: 'position', speed: { beats: 2 }, phaseTo: 180, layers: [L({ attr: 'tilt', mode: 'rel', wave: 'saw', low: 0, high: 0.25 })] },
    { id: 'tilt-wave', name: 'Tilt wave', cat: 'position', speed: { beats: 4 }, phaseTo: 360, layers: [L({ attr: 'tilt', mode: 'rel', low: 0, high: 0.2 })] },
    { id: 'wave', name: 'Move (gentle)', cat: 'position', speed: { beats: 2 }, phaseTo: 360, layers: [L({ attr: 'tilt', mode: 'rel', low: 0, high: 0.16 }), L({ attr: 'pan', mode: 'rel', low: 0, high: 0.12, offset: 90 })] },
    // Beam
    { id: 'zoom-pulse', name: 'Zoom pulse', cat: 'beam', speed: { beats: 2 }, layers: [L({ attr: 'zoom', low: 0.15, high: 0.85 })] },
  ].map((e) => ({ builtin: true, phaseFrom: 0, phaseTo: 0, groups: 1, wings: 1, dir: 1, ...e }));

  // ----- Selection tricks ----------------------------------------------------------
  // t: { order, shift, shuffle, block, groups, wings, width, part, phaseFrom, phaseTo, speedFrom, speedTo,
  //      fadeFrom, fadeTo, delayFrom, delayTo }  (null / undefined = not used)
  const has = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));

  function shuffled(list, seed) {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(hash(seed, i, 7) * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  // Sorting key for a stage position { x, y, z } (metres; z grows towards the audience).
  // 'direction' sorts along any 3D direction: turn (degrees around vertical, 0 = left -> right,
  // 90 = front -> back) and tilt (degrees up; 90 = floor -> ceiling).
  function sortKey(t) {
    const o = t && t.order;
    if (o === 'direction') {
      const tr = (Number(t.turn) || 0) * Math.PI / 180, el = (Number(t.tilt) || 0) * Math.PI / 180;
      const d = { x: Math.cos(el) * Math.cos(tr), y: Math.sin(el), z: -Math.cos(el) * Math.sin(tr) };
      return (p) => p.x * d.x + (p.y || 0) * d.y + p.z * d.z;
    }
    return {
      'left-right': (p) => p.x, 'right-left': (p) => -p.x,
      'back-front': (p) => p.z, 'front-back': (p) => -p.z,
      'low-high': (p) => p.y || 0, 'high-low': (p) => -(p.y || 0),
      'centre-out': (p) => Math.hypot(p.x, p.z), 'outside-in': (p) => -Math.hypot(p.x, p.z),
    }[o] || null;
  }

  // Put the lights in trick order. posOf(id) -> { x, y, z } stage position.
  function trickOrder(ids, t, posOf) {
    let list = ids.slice();
    const key = posOf ? sortKey(t) : null;
    if (key) list = list.map((id, i) => ({ id, i, k: key(posOf(id) || { x: 0, y: 0, z: 0 }) })).sort((a, b) => a.k - b.k || a.i - b.i).map((x) => x.id);
    if (t && Number(t.shuffle) > 0) list = shuffled(list, Number(t.shuffle));
    const sh = t && has(t.shift) ? Math.round(Number(t.shift)) : 0;
    if (sh && list.length) {
      const n = list.length;
      const k = ((sh % n) + n) % n;
      list = list.slice(k).concat(list.slice(0, k));
    }
    return list;
  }

  // Step number k (of m steps) for each position after block, groups and wings.
  function trickSteps(n, t) {
    const b = t && has(t.block) ? Math.max(1, Math.floor(t.block)) : 1;
    const out = [];
    let m = Math.ceil(n / b);
    const g = t && has(t.groups) ? Math.max(1, Math.floor(t.groups)) : 0;
    const w = t && has(t.wings) ? Math.max(1, Math.floor(t.wings)) : 1;
    if (g) m = Math.min(m, g);
    const L = w > 1 && m > 1 ? m / w : m; // wing length (can be fractional, e.g. 3 steps in 2 wings)
    for (let i = 0; i < n; i++) {
      let k = Math.floor(i / b);
      if (g) k = k % g;
      if (w > 1 && m > 1) {
        const wing = Math.min(w - 1, Math.floor((k * w) / m));
        let local = k - wing * L;
        if (wing % 2 === 1) local = L - 1 - local;
        k = Math.max(0, Math.round(local));
      }
      out.push({ k, m: w > 1 && m > 1 ? Math.ceil(L) : m });
    }
    return out;
  }

  // Which lights are in the active part (width + part). part 0 = all.
  function trickActive(n, t) {
    const width = t && has(t.width) ? Math.max(1, Math.floor(t.width)) : 0;
    const part = t && has(t.part) ? Math.floor(t.part) : 0;
    const parts = width ? Math.ceil(n / width) : 1;
    return { parts, active: (i) => !width || !part || Math.floor(i / width) === (part - 1) % parts };
  }

  // Spread position 0..1 for step k of m; "full" spreads (0..360) use k/m so the ends do not overlap.
  const spreadPos = (k, m, full) => (m <= 1 ? 0 : full ? k / m : k / (m - 1));

  // Value spread From -> To at step k of m. If only one end is given, both ends use it.
  function spread(from, to, k, m, full) {
    if (!has(from) && !has(to)) return null;
    const a = has(from) ? Number(from) : Number(to);
    const b = has(to) ? Number(to) : Number(from);
    return a + (b - a) * spreadPos(k, m, full);
  }

  // "By distance": each light's real position along the sort direction, 0..1 (instead of its rank).
  function trickFractions(ids, t, posOf) {
    const key = posOf ? sortKey(t) : null;
    if (!key || !t.spatial) return null;
    const v = ids.map((id) => key(posOf(id) || { x: 0, y: 0, z: 0 }));
    const lo = Math.min(...v), hi = Math.max(...v);
    return v.map((x) => (hi - lo > 1e-6 ? (x - lo) / (hi - lo) : 0));
  }

  const api = { trickOrder, trickFractions, sortKey, trickSteps, trickActive, spread, spreadPos, hasValue: has, wave, phaseOf, cyclesAt, evaluate, hsvToRgb, hexToRgb, clamp01, WAVES, ATTRS, BUILTIN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FXMath = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
