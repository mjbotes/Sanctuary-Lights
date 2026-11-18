'use strict';
// Reads MVR files (My Virtual Rig, the stage-plot exchange format used by
// lighting consoles, CAD and visualiser software). An MVR is a zip holding
// GeneralSceneDescription.xml plus 3D models (.glb/.gltf/.3ds) and GDTF fixture files.
// We take fixture names, positions, aim and DMX patch, and the stage geometry.
const zlib = require('zlib');
const path = require('path');

// ----- zip -------------------------------------------------------------------
function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a zip/MVR file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Damaged zip directory');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    const lNameLen = buf.readUInt16LE(local + 26), lExtraLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + csize);
    files.set(name, () => {
      if (method === 0) return Buffer.from(raw);
      if (method === 8) return zlib.inflateRawSync(raw);
      throw new Error(`Unsupported compression in ${name}`);
    });
  }
  return files;
}

// ----- tiny XML parser -------------------------------------------------------------
function decode(s) {
  return s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e) => {
    const map = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
    if (map[e.toLowerCase()]) return map[e.toLowerCase()];
    return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  });
}
function parseXml(xml) {
  const root = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2]) {
      if (stack.length > 1) stack.pop();
    } else if (m[3]) {
      const el = { name: m[3], attrs: {}, children: [], text: '' };
      for (const a of m[4].matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) el.attrs[a[1]] = decode(a[2] ?? a[3]);
      top.children.push(el);
      if (!m[5]) stack.push(el);
    } else if (m[6]) top.text += decode(m[6]);
  }
  return root;
}
const kids = (el, name) => (el ? el.children.filter((c) => c.name === name) : []);
const kid = (el, name) => kids(el, name)[0];

// ----- matrices (MVR: millimetres, Z up) ----------------------------------------
// A transform is { r: 3x3 row-major basis [u, v, w] as columns, o: [x,y,z] in mm }.
const IDENT = { r: [1, 0, 0, 0, 1, 0, 0, 0, 1], o: [0, 0, 0] };
function parseMatrix(el) {
  if (!el || !el.text.trim()) return IDENT;
  const nums = [...el.text.matchAll(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi)].map((x) => Number(x[0]));
  if (nums.length < 12) return IDENT;
  const [ux, uy, uz, vx, vy, vz, wx, wy, wz, ox, oy, oz] = nums;
  // Columns are the local axes expressed in parent coordinates.
  return { r: [ux, vx, wx, uy, vy, wy, uz, vz, wz], o: [ox, oy, oz] };
}
function mulT(a, b) {
  const r = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a.r[i * 3 + k] * b.r[k * 3 + j];
  const o = [0, 1, 2].map((i) => a.o[i] + a.r[i * 3] * b.o[0] + a.r[i * 3 + 1] * b.o[1] + a.r[i * 3 + 2] * b.o[2]);
  return { r, o };
}
// MVR (x right, y upstage, z up, mm) -> viewer (x right, y up, z towards audience, metres)
const toView = ([x, y, z]) => ({ x: round(x / 1000), y: round(z / 1000), z: round(-y / 1000) });
const round = (v) => Math.round(v * 1000) / 1000;

// three.js Matrix4 (column-major) for a geometry file placed with transform t.
function threeMatrix(t, file) {
  const ext = path.extname(file).toLowerCase();
  const unit = ext === '.3ds' ? 0.001 : 1; // 3DS geometry is in mm, glTF in metres
  const gltf = ext === '.glb' || ext === '.gltf';
  // C converts MVR coordinates to viewer coordinates; G converts glTF (Y up) into MVR local (Z up).
  const C = [1, 0, 0, 0, 0, 1, 0, -1, 0];
  const G = gltf ? [1, 0, 0, 0, 0, -1, 0, 1, 0] : [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const m3 = (a, b) => [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]));
  const R = m3(m3(C, t.r), G).map((v) => v * unit);
  const o = toView(t.o);
  // column-major 4x4
  return [R[0], R[3], R[6], 0, R[1], R[4], R[7], 0, R[2], R[5], R[8], 0, o.x, o.y, o.z, 1].map((v) => Math.round(v * 1e6) / 1e6);
}

function parseAddress(text) {
  const t = String(text || '').trim();
  const dot = /^(\d+)\.(\d+)$/.exec(t);
  if (dot) return { universe: Number(dot[1]), address: Number(dot[2]) };
  const n = Number(t);
  if (!Number.isFinite(n) || n < 1) return null;
  return { universe: Math.floor((n - 1) / 512) + 1, address: ((n - 1) % 512) + 1 };
}

// Returns { fixtures, types, models, files } where files maps model file names to buffers.
function readMvr(buf) {
  const zip = readZip(buf);
  const descName = [...zip.keys()].find((n) => /(^|\/)GeneralSceneDescription\.xml$/i.test(n));
  if (!descName) throw new Error('This MVR has no GeneralSceneDescription.xml');
  const doc = parseXml(zip.get(descName)().toString('utf8'));
  const gsd = kid(doc, 'GeneralSceneDescription');
  const scene = kid(gsd, 'Scene');
  if (!scene) throw new Error('This MVR has no scene');

  // Symbol definitions (reusable geometry)
  const symdefs = new Map();
  for (const sd of kids(kid(scene, 'AUXData'), 'Symdef')) symdefs.set(sd.attrs.uuid, sd);

  const fixtures = [];
  const models = [];
  const usedFiles = new Set();

  function addGeometries(container, t, depth = 0) {
    if (!container || depth > 8) return;
    for (const g of container.children) {
      if (g.name === 'Geometry3D' && g.attrs.fileName) {
        const gt = mulT(t, parseMatrix(kid(g, 'Matrix')));
        const file = resolveFile(g.attrs.fileName);
        if (file) {
          usedFiles.add(file);
          models.push({ file, name: g.attrs.fileName, matrix: threeMatrix(gt, file) });
        }
      } else if (g.name === 'Symbol' && symdefs.has(g.attrs.symdef)) {
        const st = mulT(t, parseMatrix(kid(g, 'Matrix')));
        addGeometries(kid(symdefs.get(g.attrs.symdef), 'ChildList'), st, depth + 1);
      }
    }
  }
  function resolveFile(name) {
    if (zip.has(name)) return name;
    const base = path.basename(name).toLowerCase();
    for (const k of zip.keys()) if (path.basename(k).toLowerCase() === base) return k;
    // Some exporters omit the extension
    for (const k of zip.keys()) if (path.basename(k, path.extname(k)).toLowerCase() === base && /\.(glb|gltf|3ds)$/i.test(k)) return k;
    return null;
  }

  function walk(list, parentT) {
    for (const el of list ? list.children : []) {
      const t = mulT(parentT, parseMatrix(kid(el, 'Matrix')));
      if (el.name === 'Fixture') {
        const addrs = kid(el, 'Addresses');
        const patch = parseAddress(addrs && kid(addrs, 'Address') && kid(addrs, 'Address').text);
        const spec = (kid(el, 'GDTFSpec') || {}).text || 'Unknown fixture';
        const mode = (kid(el, 'GDTFMode') || {}).text || '';
        const pos = toView(t.o);
        // GDTF beams point along the fixture's local -Z axis.
        const dir = [-t.r[2], -t.r[5], -t.r[8]];
        const d = toView(dir.map((v) => v * 1000));
        let len = d.y < -0.05 ? Math.min(30, pos.y / -d.y) : 8;
        if (!Number.isFinite(len) || len <= 0) len = 8;
        fixtures.push({
          name: el.attrs.name || (kid(el, 'FixtureID') || {}).text || 'Fixture',
          fixtureId: (kid(el, 'FixtureID') || {}).text || '',
          type: `${spec.trim().replace(/\.gdtf$/i, '')}${mode.trim() ? ` · ${mode.trim()}` : ''}`,
          spec: spec.trim(),
          modeName: mode.trim(),
          universe: patch ? patch.universe : 1,
          address: patch ? patch.address : 1,
          patched: !!patch,
          pos3d: pos,
          aim: { x: round(pos.x + d.x * len), y: round(pos.y + d.y * len), z: round(pos.z + d.z * len) },
        });
        continue;
      }
      if (['SceneObject', 'Truss', 'Support', 'VideoScreen', 'Projector'].includes(el.name)) addGeometries(kid(el, 'Geometries'), t);
      if (['GroupObject', 'Layer', 'SceneObject', 'Truss', 'Support'].includes(el.name)) walk(kid(el, 'ChildList'), t);
    }
  }
  for (const layer of kids(kid(scene, 'Layers'), 'Layer')) {
    walk(kid(layer, 'ChildList'), parseMatrix(kid(layer, 'Matrix')));
  }

  const types = [...new Set(fixtures.map((f) => f.type))].map((type) => ({ type, count: fixtures.filter((f) => f.type === type).length }));
  // Fixture types from the GDTF files inside the MVR (matched by file and mode name)
  const { readGdtf } = require('./fixtures'); // here, to avoid a circular require at load
  const profiles = [];
  const bySpec = new Map();
  for (const f of fixtures) if (f.spec) bySpec.set(f.spec, (bySpec.get(f.spec) || new Set()).add(f.modeName || ''));
  for (const [spec, modes] of bySpec) {
    const file = resolveFile(spec) || resolveFile(`${spec}.gdtf`);
    if (!file) continue;
    let list;
    try {
      list = readGdtf(zip.get(file)(), 'GDTF (from MVR)');
    } catch {
      continue;
    }
    for (const mode of modes) {
      const prof = list.find((p) => p.mode.toLowerCase() === mode.toLowerCase()) || (list.length === 1 ? list[0] : null);
      if (prof) profiles.push({ ...prof, key: `${spec.replace(/\.gdtf$/i, '')}${mode ? ` · ${mode}` : ''}` });
    }
  }
  const files = new Map();
  for (const f of usedFiles) files.set(f, zip.get(f)());
  // glTF files can reference buffers and textures next to them.
  for (const [name, read] of zip) if (/\.(bin|png|jpe?g)$/i.test(name) && [...usedFiles].some((u) => u.toLowerCase().endsWith('.gltf'))) files.set(name, read());
  return { fixtures, types, models, files, profiles };
}

module.exports = { readMvr, readZip, parseXml, parseAddress, threeMatrix };
