#!/usr/bin/env node
'use strict';
// Builds lib/data/ofl-index.json: the list of fixtures in the Open Fixture Library (MIT licence),
// so the library can be searched without internet. Only the list is bundled; a fixture's channels
// are downloaded when you add it.
//   git clone --depth 1 --filter=blob:none --sparse https://github.com/OpenLightingProject/open-fixture-library ofl
//   (cd ofl && git sparse-checkout set fixtures)
//   node scripts/build-ofl-index.js ofl/fixtures
const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
if (!dir) throw new Error('Usage: build-ofl-index.js <path to open-fixture-library/fixtures>');
const makers = JSON.parse(fs.readFileSync(path.join(dir, 'manufacturers.json'), 'utf8'));
const list = [];
for (const m of fs.readdirSync(dir).sort()) {
  const md = path.join(dir, m);
  if (!fs.statSync(md).isDirectory()) continue;
  for (const f of fs.readdirSync(md).filter((x) => x.endsWith('.json')).sort()) {
    const fx = JSON.parse(fs.readFileSync(path.join(md, f), 'utf8'));
    if (fx.redirectTo) continue;
    list.push({
      k: `${m}/${f.slice(0, -5)}`,
      m: (makers[m] && makers[m].name) || m,
      n: fx.name,
      c: fx.categories || [],
      modes: (fx.modes || []).map((x) => x.shortName || x.name),
    });
  }
}
const out = path.join(__dirname, '..', 'lib', 'data', 'ofl-index.json');
fs.writeFileSync(out, JSON.stringify({ built: new Date().toISOString().slice(0, 10), fixtures: list }));
console.log(`${list.length} fixtures -> ${out}`);
