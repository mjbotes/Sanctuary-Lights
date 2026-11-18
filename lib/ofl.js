'use strict';
// Open Fixture Library (open-fixture-library.org, MIT licence): search the bundled list of
// fixtures by name, then download the chosen one's channels and turn its modes into fixture types.
// Downloads are kept in dataDir/ofl so a fixture you added once also works offline.
const fs = require('fs');
const path = require('path');
const { readOfl } = require('./fixtures');

const BASE = 'https://raw.githubusercontent.com/OpenLightingProject/open-fixture-library/master/fixtures/';
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
// Short names people use for some makers
const ALIASES = { adj: 'american dj' };
const squash = (s) => norm(s).replace(/ /g, '');

class FixtureLibrary {
  constructor(cacheDir, base = BASE) {
    this.cacheDir = cacheDir;
    this.base = base.endsWith('/') ? base : `${base}/`;
    const idx = require('./data/ofl-index.json');
    this.built = idx.built;
    this.list = idx.fixtures.map((f) => ({ ...f, hay: norm(`${f.m} ${f.n} ${f.c.join(' ')}`), flat: squash(`${f.m}${f.n}`), nameFlat: squash(f.n) }));
  }

  // Best matches for what was typed ("chauvet rogue r2 wash", "slimpar", "Intimidator 355")
  search(q, limit = 30) {
    const words = norm(q).split(' ').filter(Boolean).flatMap((w) => (ALIASES[w] || w).split(' '));
    if (!words.length) return [];
    const out = [];
    for (const f of this.list) {
      let score = 0, missed = 0;
      const hayWords = f.hay.split(' ');
      for (const w of words) {
        if (hayWords.includes(w)) score += 3;
        else if (f.hay.includes(w)) score += 2;
        else if (f.flat.includes(w)) score += 1; // "r2" in "roguer2wash", "slimpar" in "slimpar56"
        else missed++;
      }
      // Close matches still show when a word is not found ("Intimidator 355" -> the other Intimidators)
      if (!score || missed > words.length / 2) continue;
      if (f.nameFlat === squash(q)) score += 5;
      out.push([score - missed * 4, f, !missed]);
    }
    return out.sort((a, b) => b[0] - a[0] || a[1].n.length - b[1].n.length).slice(0, limit)
      .map(([, f, exact]) => ({ key: f.k, manufacturer: f.m, name: f.n, categories: f.c, modes: f.modes, exact }));
  }

  info(key) {
    return this.list.find((f) => f.k === key) || null;
  }

  // The fixture's modes as fixture types (same shape as an uploaded OFL file)
  async profiles(key) {
    const f = this.info(key);
    if (!f) throw new Error('That fixture is not in the library');
    const file = path.join(this.cacheDir, `${key.replace('/', '__')}.json`);
    let text = null;
    try { text = fs.readFileSync(file, 'utf8'); } catch {}
    if (!text) {
      let r;
      try {
        r = await fetch(`${this.base}${key}.json`, { signal: AbortSignal.timeout(15000) });
      } catch {
        throw new Error('Could not reach the Open Fixture Library. Is this computer on the internet?');
      }
      if (!r.ok) throw new Error(`The Open Fixture Library answered ${r.status}`);
      text = await r.text();
      try {
        fs.mkdirSync(this.cacheDir, { recursive: true });
        fs.writeFileSync(file, text);
      } catch {}
    }
    return readOfl(JSON.parse(text), f.n, f.m).map((p) => ({ ...p, oflKey: key }));
  }
}

module.exports = { FixtureLibrary, norm };
