'use strict';
// Actions – Sharing a song's lighting design as a file (between campuses or churches).
//
// The file has two descriptions of each look:
//   exact:  the values per light, by light NAME (for a church with the same rig / names)
//   design: per role (front, back, movers, house…): level, palette slot or colour, effects,
//           so a church with a different rig gets the same design on its own lights.
// Importing uses the exact looks when every light they name exists here, otherwise the design.
const { uid, nameKey } = require('../util');
const { normalizeSong } = require('../defaults');

const FORMAT = 'sanctuary-lights-song';

module.exports = {
  'song.export'(a) {
    const song = this.show.songs[this.findIndex(this.show.songs, a.id)];
    const fname = (id) => (this.show.fixtures.find((f) => f.id === id) || {}).name;
    const gname = (id) => (this.show.groups.find((g) => g.id === id) || {}).name;
    const roles = this.rigRoles();
    const looks = {};
    const effectIds = new Set();
    for (const sec of song.sections) {
      const look = sec.lookId && this.show.looks.find((l) => l.id === sec.lookId);
      if (!look || looks[look.id]) continue;
      const byName = (obj) => Object.fromEntries(Object.entries(obj || {}).filter(([fid]) => fname(fid)).map(([fid, v]) => [fname(fid), v]));
      const effects = (look.effects || []).map((e) => {
        effectIds.add(e.effectId || e.type);
        return { effectId: e.effectId || e.type, rate: e.rate || 1, size: e.size ?? 1, ...(e.groupId ? { group: gname(e.groupId) } : {}), ...(e.fixtures ? { fixtures: e.fixtures.map(fname).filter(Boolean) } : {}) };
      });
      looks[look.id] = { name: look.name, values: byName(look.values), refs: byName(look.refs), effects, design: this.lookToDesign(look, roles) };
    }
    const custom = (this.show.effects || []).filter((e) => effectIds.has(e.id));
    this.lastResult = {
      file: {
        format: FORMAT, version: 1, exportedAt: new Date().toISOString(),
        song: {
          name: song.name, notes: song.notes || '', bpm: song.bpm || null, key: song.key, minor: !!song.minor,
          beatsPerBar: song.beatsPerBar, palette: song.palette || this.show.palette,
          sections: song.sections.map((s) => ({ name: s.name, fade: s.fade, look: s.lookId && looks[s.lookId] ? s.lookId : null })),
        },
        looks, effects: custom,
      },
    };
    return { runtime: false };
  },

  'song.importFile'(a) {
    const f = a.file;
    if (!f || f.format !== FORMAT || !f.song || !Array.isArray(f.song.sections)) throw new Error('That is not a Sanctuary Lights song file');
    const src = f.song;
    const name = String(src.name || 'Imported song').slice(0, 80);
    // Custom effects the looks use (same id with a different definition gets a new id)
    const effectMap = {};
    for (const e of Array.isArray(f.effects) ? f.effects.slice(0, 50) : []) {
      const have = this.show.effects.find((x) => x.id === e.id);
      if (have && JSON.stringify(have.layers) === JSON.stringify(e.layers)) continue;
      const id = have ? uid() : String(e.id || uid());
      this.show.effects.push({ ...e, id });
      effectMap[e.id] = id;
    }
    const eff = (id) => effectMap[id] || id;
    // The song (an existing song with the same name is updated)
    let song = this.findSong(name);
    if (song) this.restoreSong(song);
    if (!song) {
      song = normalizeSong({ id: uid(), name, notes: '', trigger: null, sections: [] });
      this.show.songs.push(song);
    }
    song.notes = String(src.notes || song.notes || '').slice(0, 300);
    if (src.bpm >= 30 && src.bpm <= 300) song.bpm = src.bpm;
    if (Number.isInteger(src.key) && src.key >= 0 && src.key < 12) song.key = src.key;
    song.minor = !!src.minor;
    if (Number.isInteger(src.beatsPerBar)) song.beatsPerBar = src.beatsPerBar;
    if (Array.isArray(src.palette) && src.palette.length === 3 && src.palette.every((c) => /^#[0-9a-f]{6}$/i.test(c))) song.palette = src.palette.map((c) => c.toLowerCase());
    song.sections = src.sections.slice(0, 60).map((s) => ({ id: uid(), name: String(s.name || 'Section').slice(0, 40), lookId: null, fade: Number(s.fade) >= 0 ? Number(s.fade) : 1, trigger: null, _look: s.look }));
    const looks = f.looks || {};
    // Exact mode when every light the looks name is in this show
    const ids = Object.fromEntries(this.show.fixtures.map((x) => [x.name, x.id]));
    const named = new Set();
    for (const l of Object.values(looks)) {
      for (const n of [...Object.keys(l.values || {}), ...Object.keys(l.refs || {})]) named.add(n);
      for (const e of l.effects || []) for (const n of e.fixtures || []) named.add(n);
    }
    const exact = named.size > 0 && [...named].every((n) => ids[n]);
    if (exact) {
      const byId = (obj) => Object.fromEntries(Object.entries(obj || {}).map(([n, v]) => [ids[n], v]));
      const made = {};
      for (const [key, l] of Object.entries(looks)) {
        const lname = (String(l.name || key).startsWith(`${name} · `) ? String(l.name) : `${name} · ${l.name || 'Look'}`).slice(0, 60);
        let look = this.show.looks.find((x) => nameKey(x.name) === nameKey(lname));
        if (!look) { look = { id: uid(), name: lname }; this.show.looks.push(look); }
        const effects = (l.effects || []).map((e) => {
          const g = e.group && this.show.groups.find((x) => x.name === e.group);
          return { effectId: eff(e.effectId), rate: e.rate || 1, size: e.size ?? 1, ...(g ? { groupId: g.id } : {}), ...(e.fixtures ? { fixtures: e.fixtures.map((n) => ids[n]).filter(Boolean) } : {}) };
        });
        Object.assign(look, { values: byId(l.values), refs: byId(l.refs), effects, timing: {} });
        look.color = this.colorFor(look.values);
        made[key] = look.id;
      }
      for (const s of song.sections) s.lookId = made[s._look] || null;
    } else {
      // Different rig: rebuild each look from its design, on these lights
      const designs = {};
      for (const s of song.sections) {
        const d = looks[s._look] && looks[s._look].design;
        if (d) designs[s.name] = { ...d, fx: (d.fx || []).map((x) => ({ ...x, effect: eff(x.effect) })), fade: s.fade };
      }
      if (this.show.fixtures.length) this.designSong(song, designs);
      for (const s of song.sections) if (!designs[s.name]) s.lookId = null;
    }
    for (const s of song.sections) delete s._look;
    this.actions['song.select'].call(this, { id: song.id });
    this.lastResult = { song: song.name, mode: exact ? 'exact' : 'design' };
    return { show: true };
  },
};
