'use strict';
// Engine methods – Patch helpers: lookups and DMX address checks.


module.exports = {

  findIndex(list, id) {
    const i = list.findIndex((x) => x.id === id);
    if (i < 0) throw new Error('Not found');
    return i;
  },


  validatePatch(f, prof) {
    if (!Number.isInteger(f.universe) || f.universe < 1 || f.universe > 63999) throw new Error('Universe must be 1 to 63999');
    if (!Number.isInteger(f.address) || f.address < 1) throw new Error('Address must be 1 to 512');
    if (f.address + prof.footprint - 1 > 512) throw new Error(`${f.name}: address ${f.address} + ${prof.footprint} channels runs past 512`);
  },


  nextFreeAddress(universe, footprint) {
    const used = new Uint8Array(513);
    for (const { fixture, prof } of this.fixtureMap.values()) {
      if (fixture.universe !== universe) continue;
      for (let i = 0; i < prof.footprint; i++) used[fixture.address + i] = 1;
    }
    for (let a = 1; a + footprint - 1 <= 512; a++) {
      let ok = true;
      for (let i = 0; i < footprint; i++) if (used[a + i]) { ok = false; break; }
      if (ok) return a;
    }
    return null;
  },
};
