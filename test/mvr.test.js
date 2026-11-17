'use strict';
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('zlib');
const { readMvr, parseAddress, parseXml } = require('../lib/mvr');

// Minimal zip writer (CRC left at 0; our reader does not check it).
function makeZip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, content, deflate] of entries) {
    const data = Buffer.from(content);
    const body = deflate ? zlib.deflateRawSync(data) : data;
    const nameBuf = Buffer.from(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(deflate ? 8 : 0, 8);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(deflate ? 8 : 0, 10);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, nameBuf, body);
    centrals.push(ch, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<GeneralSceneDescription verMajor="1" verMinor="5">
  <Scene>
    <AUXData>
      <Symdef name="Truss piece" uuid="S1"><ChildList><Geometry3D fileName="truss.3ds"/></ChildList></Symdef>
    </AUXData>
    <Layers>
      <Layer name="Lights &amp; stage" uuid="L1">
        <ChildList>
          <Fixture name="Wash 1" uuid="F1">
            <Matrix>{1,0,0}{0,1,0}{0,0,1}{-2000,1000,6000}</Matrix>
            <GDTFSpec>Generic@LED Wash.gdtf</GDTFSpec>
            <GDTFMode>8ch</GDTFMode>
            <Addresses><Address break="0">517</Address></Addresses>
            <FixtureID>101</FixtureID>
          </Fixture>
          <GroupObject name="Group" uuid="G1">
            <Matrix>{1,0,0}{0,1,0}{0,0,1}{1000,0,0}</Matrix>
            <ChildList>
              <Fixture name="Spot 2" uuid="F2">
                <Matrix>{1,0,0}{0,1,0}{0,0,1}{0,0,5000}</Matrix>
                <GDTFSpec>Generic@Spot.gdtf</GDTFSpec>
                <Addresses><Address>2.10</Address></Addresses>
              </Fixture>
            </ChildList>
          </GroupObject>
          <SceneObject name="Stage" uuid="O1">
            <Matrix>{1,0,0}{0,1,0}{0,0,1}{0,0,0}</Matrix>
            <Geometries><Geometry3D fileName="stage.glb"/><Symbol symdef="S1"><Matrix>{1,0,0}{0,1,0}{0,0,1}{0,0,6000}</Matrix></Symbol></Geometries>
          </SceneObject>
        </ChildList>
      </Layer>
    </Layers>
  </Scene>
</GeneralSceneDescription>`;

test('reads fixtures, patch, positions and geometry from an MVR', () => {
  const zip = makeZip([['GeneralSceneDescription.xml', XML, true], ['stage.glb', 'GLB', false], ['truss.3ds', '3DS', true]]);
  const mvr = readMvr(zip);
  assert.strictEqual(mvr.fixtures.length, 2);
  const [a, b] = mvr.fixtures;
  assert.strictEqual(a.name, 'Wash 1');
  assert.strictEqual(a.type, 'Generic@LED Wash · 8ch');
  assert.deepStrictEqual([a.universe, a.address], [2, 5]); // 517 absolute = universe 2, address 5
  assert.deepStrictEqual(a.pos3d, { x: -2, y: 6, z: -1 }); // y (upstage) 1m -> z -1, height 6m
  assert.deepStrictEqual(a.aim, { x: -2, y: 0, z: -1 }); // hanging straight down, aimed at the floor
  assert.deepStrictEqual([b.universe, b.address], [2, 10]);
  assert.deepStrictEqual(b.pos3d, { x: 1, y: 5, z: -0 }); // parent group offset applied
  assert.deepStrictEqual(mvr.types.map((t) => t.count), [1, 1]);
  assert.deepStrictEqual(mvr.models.map((m) => m.file).sort(), ['stage.glb', 'truss.3ds']);
  const truss = mvr.models.find((m) => m.file === 'truss.3ds');
  assert.deepStrictEqual(truss.matrix.slice(12, 15), [0, 6, -0]); // 6 m up
  assert.strictEqual(truss.matrix[0], 0.001); // 3DS in mm
  assert.strictEqual(mvr.files.get('stage.glb').toString(), 'GLB');
});

test('addresses and XML entities', () => {
  assert.deepStrictEqual(parseAddress('1'), { universe: 1, address: 1 });
  assert.deepStrictEqual(parseAddress('512'), { universe: 1, address: 512 });
  assert.deepStrictEqual(parseAddress('513'), { universe: 2, address: 1 });
  assert.deepStrictEqual(parseAddress('3.100'), { universe: 3, address: 100 });
  assert.strictEqual(parseAddress(''), null);
  const x = parseXml('<a b="x &amp; y"><c>1 &lt; 2</c><d/></a>');
  assert.strictEqual(x.children[0].attrs.b, 'x & y');
  assert.strictEqual(x.children[0].children[0].text, '1 < 2');
  assert.strictEqual(x.children[0].children[1].name, 'd');
});

test('rejects files that are not MVR', () => {
  assert.throws(() => readMvr(Buffer.from('hello world, definitely not a zip file')), /zip/);
  assert.throws(() => readMvr(makeZip([['other.txt', 'x', false]])), /GeneralSceneDescription/);
});
