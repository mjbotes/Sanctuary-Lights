'use strict';
// Actions – Patch: fixtures, fixture types, groups, 3D stage, MVR import. Each action runs with `this` = the engine; return { show: true } when the saved show changed.
const { parseChannels } = require('../../profiles');
const { uid, clamp01, round4, num, ids } = require('../util');

module.exports = {

  // Patch
  'fixture.add'(a) {
    const prof = this.profiles[a.profile];
    if (!prof) throw new Error('Choose a fixture type');
    const count = Math.max(1, Math.min(128, Math.floor(num(a.count ?? 1, 'Count'))));
    const universe = Math.floor(num(a.universe ?? 1, 'Universe'));
    let address = a.address ? Math.floor(num(a.address, 'Address')) : this.nextFreeAddress(universe, prof.footprint);
    if (!address) throw new Error(`No room left in universe ${universe}`);
    const baseName = String(a.name || '').trim() || prof.name.replace(/\s*\(.*\)$/, '');
    const rowY = Math.min(0.9, 0.15 + (new Set(this.show.fixtures.map((f) => f.y)).size % 6) * 0.15);
    const added = [];
    for (let i = 0; i < count; i++) {
      const f = {
        id: uid(),
        name: count > 1 ? `${baseName} ${i + 1}` : baseName,
        profile: a.profile,
        universe,
        address: address + i * prof.footprint,
        x: round4((i + 1) / (count + 1)),
        y: rowY,
      };
      this.validatePatch(f, prof);
      added.push(f);
    }
    this.show.fixtures.push(...added);
    return { show: true };
  },

  'fixture.edit'(a) {
    const f = this.show.fixtures[this.findIndex(this.show.fixtures, a.id)];
    const next = { ...f };
    if (a.name !== undefined) next.name = String(a.name).slice(0, 60) || f.name;
    if (a.profile !== undefined) next.profile = a.profile;
    if (a.universe !== undefined) next.universe = Math.floor(num(a.universe, 'Universe'));
    if (a.address !== undefined) next.address = Math.floor(num(a.address, 'Address'));
    if (a.x !== undefined) next.x = round4(clamp01(num(a.x, 'x')));
    if (a.y !== undefined) next.y = round4(clamp01(num(a.y, 'y')));
    const vec = (v, name) => {
      if (v === null) return undefined;
      const o = { x: num(v.x, name), y: num(v.y, name), z: num(v.z, name) };
      for (const k of 'xyz') if (Math.abs(o[k]) > 1000) throw new Error(`${name} is too far away`);
      return { x: round4(o.x), y: round4(o.y), z: round4(o.z) };
    };
    if (a.pos3d !== undefined) next.pos3d = vec(a.pos3d, 'Position');
    if (a.aim !== undefined) next.aim = vec(a.aim, 'Aim');
    if (a.beam !== undefined) next.beam = Math.max(2, Math.min(90, num(a.beam, 'Beam angle')));
    const prof = this.profiles[next.profile];
    if (!prof) throw new Error('Unknown fixture type');
    this.validatePatch(next, prof);
    Object.assign(f, next);
    if (a.profile !== undefined) delete this.programmer[f.id];
    return { show: true };
  },

  'fixture.delete'(a) {
    const del = new Set(ids(a));
    this.show.fixtures = this.show.fixtures.filter((f) => !del.has(f.id));
    for (const g of this.show.groups) g.fixtures = g.fixtures.filter((id) => !del.has(id));
    for (const list of [this.show.cues, this.show.scenes, this.show.looks]) for (const c of list) for (const id of del) delete c.values[id];
    for (const id of del) delete this.programmer[id];
    return { show: true };
  },

  'stage3d.set'(a) {
    const st = this.show.stage3d;
    if (a.stage) {
      const w = num(a.stage.w ?? st.stage.w, 'Width'), d = num(a.stage.d ?? st.stage.d, 'Depth'), h = num(a.stage.h ?? st.stage.h, 'Height');
      st.stage = { w: Math.max(1, Math.min(200, w)), d: Math.max(1, Math.min(200, d)), h: Math.max(0, Math.min(10, h)) };
    }
    if (a.screens) {
      if (!Array.isArray(a.screens)) throw new Error('screens must be a list');
      const n = (v, d, lo, hi) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Number(v))) : d);
      st.screens = a.screens.slice(0, 20).map((x) => ({
        id: x.id || uid(), name: String(x.name || 'Screen').slice(0, 40), kind: x.kind === 'led' ? 'led' : 'projector',
        x: n(x.x, 0, -200, 200), y: n(x.y, 3, -10, 60), z: n(x.z, -5.9, -200, 200),
        w: n(x.w, 4, 0.2, 60), h: n(x.h, 2.25, 0.2, 40), rotY: n(x.rotY, 0, -360, 360), rotX: n(x.rotX, 0, -90, 90),
        protect: x.protect !== false, slides: x.slides !== false,
      }));
    }
    if (a.models) {
      if (!Array.isArray(a.models)) throw new Error('models must be a list');
      st.models = a.models.slice(0, 200).map((m) => ({
        file: String(m.file).replace(/[^a-zA-Z0-9._\/-]/g, '').replace(/\.\.+/g, '.'),
        name: String(m.name || m.file).slice(0, 80),
        x: Number(m.x) || 0, y: Number(m.y) || 0, z: Number(m.z) || 0,
        rotX: Number(m.rotX) || 0, rotY: Number(m.rotY) || 0,
        scale: Number(m.scale) > 0 ? Number(m.scale) : 1,
        matrix: Array.isArray(m.matrix) && m.matrix.length === 16 ? m.matrix.map(Number) : null,
      }));
    }
    return { show: true };
  },

  // Apply an imported MVR (fixtures with positions and patch, plus stage geometry).
  'mvr.apply'(a) {
    if (!Array.isArray(a.fixtures)) throw new Error('Nothing to import');
    if (a.replace) {
      this.actions['fixture.delete'].call(this, { fixtures: this.show.fixtures.map((f) => f.id) });
      for (const g of this.show.groups.filter((x) => !x.fixtures.length)) delete this.rt.busk[g.id];
      this.show.groups = this.show.groups.filter((x) => x.fixtures.length);
      this.compile();
    }
    const xs = a.fixtures.map((f) => f.pos3d.x), zs = a.fixtures.map((f) => f.pos3d.z);
    const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    const skipped = [];
    for (const f of a.fixtures) {
      const prof = this.profiles[f.profile];
      if (!prof) { skipped.push(f.name); continue; }
      const fx = {
        id: uid(), name: String(f.name).slice(0, 60), profile: f.profile,
        universe: Math.floor(num(f.universe || 1, 'Universe')), address: Math.floor(num(f.address || 1, 'Address')),
        x: round4(maxX > minX ? 0.05 + 0.9 * (f.pos3d.x - minX) / (maxX - minX) : 0.5),
        y: round4(maxZ > minZ ? 0.1 + 0.8 * (f.pos3d.z - minZ) / (maxZ - minZ) : 0.5),
        pos3d: f.pos3d, aim: f.aim || null, beam: f.beam || 25,
      };
      try {
        this.validatePatch(fx, prof);
      } catch {
        skipped.push(f.name);
        continue;
      }
      this.show.fixtures.push(fx);
    }
    if (Array.isArray(a.models)) this.actions['stage3d.set'].call(this, { models: [...(a.keepModels ? this.show.stage3d.models : []), ...a.models] });
    this.lastImportSkipped = skipped;
    return { show: true };
  },

  'profile.save'(a) {
    const name = String(a.name || '').trim();
    if (!name) throw new Error('Give the fixture type a name');
    parseChannels(a.channels); // throws if invalid
    const id = a.id && this.show.profiles[a.id] ? a.id : `custom-${uid()}`;
    const old = this.show.profiles[id];
    if (old) {
      const footprint = parseChannels(a.channels).length;
      for (const f of this.show.fixtures) if (f.profile === id && f.address + footprint - 1 > 512) throw new Error(`${f.name} would run past channel 512`);
    }
    this.show.profiles[id] = { name, channels: String(a.channels).trim() };
    return { show: true };
  },

  'profile.delete'(a) {
    if (!this.show.profiles[a.id]) throw new Error('Only custom types can be deleted');
    if (this.show.fixtures.some((f) => f.profile === a.id)) throw new Error('Fixtures still use this type');
    delete this.show.profiles[a.id];
    return { show: true };
  },

  'group.save'(a) {
    const name = String(a.name || '').trim();
    if (!name) throw new Error('Give the group a name');
    const fixtures = ids(a).filter((id) => this.fixtureMap.has(id));
    if (!fixtures.length) throw new Error('Select some fixtures first');
    const existing = a.id && this.show.groups.find((g) => g.id === a.id);
    if (existing) Object.assign(existing, { name, fixtures });
    else this.show.groups.push({ id: uid(), name, fixtures });
    return { show: true };
  },

  'group.delete'(a) {
    this.show.groups.splice(this.findIndex(this.show.groups, a.id), 1);
    delete this.rt.busk[a.id];
    return { show: true };
  },
};
