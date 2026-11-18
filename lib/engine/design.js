'use strict';
// Engine methods – "Light this song for me": a lighting design for every section of a song,
// made from the rig that is patched, and the song's palette (P / S / T).
//
// The lights are sorted into roles:
//   front    lights downstage (faces): warm white, never coloured, so people stay visible
//   back     colour lights upstage: the song's palette
//   movers   moving heads: palette colour, and movement in bigger moments
//   house    house / room lights: low during songs
//   special  pulpit / podium specials: off during songs
//   haze     hazers: a steady low level
// Each section kind (intro, verse, chorus, bridge…) has a level of energy, and colours that link
// to the palette, so the same design re-colours itself when the song's colours change.
const FX = require('../../public/fxmath');
const { colorValues, uid, round4, nameKey } = require('./util');

const WARM_WHITE = [1, 0.84, 0.62];

// Default design per kind of section. back/movers colours are palette slots: 1 = P, 2 = S, 3 = T.
// fx: effects by role ({ role, effect, rate, size }).
const KINDS = {
  intro: { front: 0.25, back: 0.45, backPal: 3, movers: 0.35, moverPal: 3, house: 0.15, fade: 3, fx: [{ role: 'back', effect: 'breathe', rate: 0.5, size: 0.5 }] },
  verse: { front: 0.7, back: 0.45, backPal: 1, movers: 0.3, moverPal: 3, house: 0.1, fade: 2 },
  pre: { front: 0.75, back: 0.7, backPal: 2, movers: 0.6, moverPal: 1, house: 0.1, fade: 1.5, fx: [{ role: 'back', effect: 'chase-soft', rate: 1, size: 0.6 }] },
  chorus: { front: 1, back: 1, backPal: 1, movers: 1, moverPal: 2, house: 0, fade: 0.5, fx: [{ role: 'movers', effect: 'wave', rate: 0.5, size: 0.6 }] },
  bridge: { front: 0.5, back: 0.85, backPal: 3, movers: 0.8, moverPal: 3, house: 0, fade: 2, fx: [{ role: 'movers', effect: 'circle-phase', rate: 0.5, size: 0.5 }] },
  tag: { front: 0.9, back: 0.9, backPal: 1, movers: 0.9, moverPal: 2, house: 0, fade: 1, fx: [{ role: 'back', effect: 'pal-alt', rate: 0.5, size: 1 }] },
  instrumental: { front: 0.4, back: 0.9, backPal: 2, movers: 0.9, moverPal: 1, house: 0, fade: 1, fx: [{ role: 'back', effect: 'pal-chase', rate: 1, size: 1 }] },
  outro: { front: 0.35, back: 0.35, backPal: 3, movers: 0.25, moverPal: 3, house: 0.2, fade: 4 },
};

// Which kind a section name is: "Pre-Chorus 2" -> pre, "Verse 3" -> verse
function kindOf(name) {
  const n = String(name).toLowerCase();
  if (/pre[\s-]?chorus|^pre|build|lift|channel/.test(n)) return 'pre';
  if (/chorus|refrain/.test(n)) return 'chorus';
  if (/bridge/.test(n)) return 'bridge';
  if (/tag|vamp|turnaround/.test(n)) return 'tag';
  if (/inst|interlude|solo|break|turn/.test(n)) return 'instrumental';
  if (/outro|end|coda|ending/.test(n)) return 'outro';
  if (/intro|start|open/.test(n)) return 'intro';
  return 'verse';
}

// Story-driven designs for demo songs. sections: arrangement; designs: by section name.
const DEMOS = {
  'graves-into-gardens': {
    name: 'Graves Into Gardens',
    notes: 'Demo design: from the grave (cold, dark) to the garden (gold and green). Set the key and BPM from your chart, and match the sections to your arrangement.',
    // P = gold (resurrection), S = garden green, T = deep violet (the grave)
    palette: ['#ffb347', '#3ccf6e', '#3a2a9a'],
    sections: ['Intro', 'Verse 1', 'Verse 2', 'Chorus 1', 'Verse 3', 'Chorus 2', 'Interlude', 'Bridge 1', 'Bridge 2', 'Bridge 3', 'Chorus 3', 'Tag', 'Outro'],
    designs: {
      // The grave: almost dark, cold violet, haze in a single cool wash
      Intro: { front: 0.12, back: 0.3, backPal: 3, movers: 0.25, moverPal: 3, house: 0, fade: 4, fx: [{ role: 'back', effect: 'breathe', rate: 0.25, size: 0.6 }] },
      'Verse 1': { front: 0.55, back: 0.3, backPal: 3, movers: 0.15, moverPal: 3, house: 0, fade: 3 },
      // A first hint of gold behind the band
      'Verse 2': { front: 0.65, back: 0.45, backPal: 1, movers: 0.25, moverPal: 3, house: 0, fade: 2 },
      // "Mourning to dancing": warm, open, gold everywhere
      'Chorus 1': { front: 0.9, back: 0.9, backPal: 1, movers: 0.8, moverPal: 1, house: 0, fade: 1.5, fx: [{ role: 'movers', effect: 'wave', rate: 0.5, size: 0.4 }] },
      'Verse 3': { front: 0.6, back: 0.4, backPal: 3, movers: 0.2, moverPal: 1, house: 0, fade: 2.5 },
      'Chorus 2': { front: 1, back: 1, backPal: 1, movers: 0.9, moverPal: 2, house: 0, fade: 1, fx: [{ role: 'movers', effect: 'wave', rate: 0.5, size: 0.6 }] },
      // Breath before the bridge: back to violet, slow pulse like a heartbeat
      Interlude: { front: 0.3, back: 0.5, backPal: 3, movers: 0.4, moverPal: 3, house: 0, fade: 2, fx: [{ role: 'back', effect: 'pulse', rate: 0.5, size: 0.5 }] },
      // The bridge builds three times: green grows out of the dark
      'Bridge 1': { front: 0.4, back: 0.45, backPal: 2, movers: 0.4, moverPal: 3, house: 0, fade: 2, fx: [{ role: 'back', effect: 'chase-soft', rate: 0.5, size: 0.5 }] },
      'Bridge 2': { front: 0.6, back: 0.75, backPal: 2, movers: 0.7, moverPal: 2, house: 0, fade: 1, fx: [{ role: 'back', effect: 'chase', rate: 1, size: 0.7 }, { role: 'movers', effect: 'circle-phase', rate: 0.5, size: 0.5 }] },
      // The garden: everything up, gold and green, movement and sparkle
      'Bridge 3': { front: 1, back: 1, backPal: 1, movers: 1, moverPal: 2, house: 0, fade: 0.3, fx: [{ role: 'back', effect: 'pal-chase', rate: 1, size: 1 }, { role: 'movers', effect: 'ballyhoo', rate: 0.5, size: 0.6 }, { role: 'front', effect: 'sparkle', rate: 1, size: 0.2 }] },
      'Chorus 3': { front: 1, back: 1, backPal: 2, movers: 1, moverPal: 1, house: 0, fade: 0.5, fx: [{ role: 'back', effect: 'pal-alt', rate: 0.5, size: 1 }, { role: 'movers', effect: 'wave', rate: 0.5, size: 0.7 }] },
      Tag: { front: 0.85, back: 0.85, backPal: 1, movers: 0.8, moverPal: 2, house: 0, fade: 2, fx: [{ role: 'back', effect: 'pal-fade', rate: 0.5, size: 1 }] },
      // Peace: soft gold and green, house lights coming up a little
      Outro: { front: 0.45, back: 0.4, backPal: 2, movers: 0.3, moverPal: 1, house: 0.25, fade: 5 },
    },
  },
};

module.exports = {
  KINDS,
  DEMOS,
  kindOf,

  methods: {
    // Sort the patched lights into roles (see the top of this file).
    rigRoles() {
      const roles = { front: [], back: [], movers: [], house: [], special: [], haze: [] };
      const ys = this.show.fixtures.map((f) => Number(f.y) || 0.5);
      const mid = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0.5;
      for (const f of this.show.fixtures) {
        const fx = this.fixtureMap.get(f.id);
        if (!fx) continue;
        const attrs = fx.prof.attrs || [];
        const name = String(f.name || '').toLowerCase();
        const hasColor = ['red', 'green', 'blue', 'cyan', 'colorwheel'].some((a) => attrs.includes(a));
        if (attrs.includes('haze') || /haze|fog/.test(name)) roles.haze.push(f.id);
        else if (/house|audience|room|foyer|aisle/.test(name)) roles.house.push(f.id);
        else if (/pulpit|podium|lectern|special|preach|font|baptism/.test(name)) roles.special.push(f.id);
        else if (attrs.includes('pan') || attrs.includes('tilt')) roles.movers.push(f.id);
        else if (/front|foh|face|key/.test(name)) roles.front.push(f.id);
        else if (/back|rear|wash|cyc|led|upstage|top/.test(name) && hasColor) roles.back.push(f.id);
        // Otherwise by position on the stage plan (larger y = closer to the audience)
        else if (!hasColor || (Number(f.y) || 0.5) > mid + 0.05) roles.front.push(f.id);
        else roles.back.push(f.id);
      }
      // A rig of only colour lights at one depth: use them all as "back" colour, and the front-most as front.
      if (!roles.back.length && roles.front.length > 2) {
        const colorFront = roles.front.filter((id) => (this.fixtureMap.get(id).prof.attrs || []).includes('red'));
        if (colorFront.length === roles.front.length) {
          const sorted = [...colorFront].sort((a, b) => (this.fixtureMap.get(b).fixture.y || 0) - (this.fixtureMap.get(a).fixture.y || 0));
          roles.front = sorted.slice(0, Math.ceil(sorted.length / 2));
          roles.back = sorted.slice(Math.ceil(sorted.length / 2));
        }
      }
      return roles;
    },

    // One look from a section design. Returns { values, refs, effects }.
    // palette: the song's three colours (the look's colour links follow later changes anyway).
    designLook(d, roles, palette = this.show.palette) {
      const values = {}, refs = {};
      const set = (fid, vals) => { values[fid] = { ...(values[fid] || {}), ...vals }; };
      const prof = (fid) => this.fixtureMap.get(fid).prof;
      const rgbOf = (fid, rgb) => {
        const out = {};
        for (const [a, v] of Object.entries(colorValues(prof(fid), rgb))) out[a] = round4(v);
        return out;
      };
      const level = (fid, dim) => ('dim' in prof(fid).defaults || prof(fid).attrs.includes('dim') ? { dim: round4(dim) } : {});
      for (const fid of roles.front) set(fid, { ...rgbOf(fid, WARM_WHITE), ...level(fid, d.front) });
      const colored = (list, dim, pal) => {
        for (const fid of list) {
          set(fid, { ...rgbOf(fid, FX.hexToRgb(palette[pal - 1] || '#ffffff')), ...level(fid, dim) });
          // Link the colour attributes to the palette, like a recorded look
          for (const a of Object.keys(colorValues(prof(fid), [1, 1, 1]))) (refs[fid] ||= {})[a] = `pal:${pal}`;
        }
      };
      colored(roles.back, d.back, d.backPal || 1);
      colored(roles.movers, d.movers ?? d.back, d.moverPal || d.backPal || 1);
      for (const fid of roles.movers) set(fid, { pan: 0.5, tilt: 0.55 });
      for (const fid of roles.house) set(fid, level(fid, d.house ?? 0));
      for (const fid of roles.special) set(fid, level(fid, 0));
      for (const fid of roles.haze) set(fid, { haze: 0.3 });
      const effects = [];
      for (const e of d.fx || []) {
        const fixtures = roles[e.role] || [];
        if (fixtures.length) effects.push({ effectId: e.effect, fixtures: [...fixtures], rate: e.rate || 1, size: e.size ?? 1 });
      }
      return { values, refs, effects };
    },

    // Make (or remake) the looks for every section of a song and link them.
    // designs: optional { sectionName: design } overriding the default per kind.
    designSong(song, designs = {}) {
      const roles = this.rigRoles();
      if (!Object.values(roles).some((l) => l.length)) throw new Error('Add some lights first (Patch tab)');
      const made = new Map(); // design key -> look id
      for (const sec of song.sections) {
        const own = designs[sec.name];
        const key = own ? `name:${sec.name}` : `kind:${kindOf(sec.name)}`;
        if (!made.has(key)) {
          const kind = kindOf(sec.name);
          const d = own || KINDS[kind];
          const label = own ? sec.name : kind === 'pre' ? 'Pre-Chorus' : kind[0].toUpperCase() + kind.slice(1);
          const name = `${song.name} · ${label}`.slice(0, 60);
          const { values, refs, effects } = this.designLook(d, roles, song.palette || this.show.palette);
          let look = this.show.looks.find((l) => nameKey(l.name) === nameKey(name));
          if (!look) {
            look = { id: uid(), name };
            this.show.looks.push(look);
          }
          Object.assign(look, { values, refs, effects, timing: {}, color: this.colorFor(values) });
          made.set(key, { id: look.id, fade: d.fade });
        }
        const m = made.get(key);
        sec.lookId = m.id;
        sec.fade = m.fade ?? sec.fade;
      }
      return made.size;
    },
  },
};
