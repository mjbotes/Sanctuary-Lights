'use strict';
// Fixture library: GDTF and Open Fixture Library import, colour wheels, CMY, shutter, curves.
const test = require('node:test');
const assert = require('node:assert');
const { makeZip } = require('./helpers/zip');
const { readGdtf, readOfl, readFixtureFiles, xyToHex } = require('../lib/fixtures');
const { readMvr } = require('../lib/mvr');
const { compileProfile } = require('../lib/profiles');
const { Engine, emptyShow } = require('../lib/engine');

// A small made-up moving head: 16-bit pan/tilt, shutter, dimmer, colour wheel, gobo.
const GDTF_XML = `<?xml version="1.0"?>
<GDTF DataVersion="1.1">
  <FixtureType Name="Spot 300" LongName="Spot 300" Manufacturer="Example Lighting">
    <Wheels>
      <Wheel Name="Color1">
        <Slot Name="Open" Color="0.3127,0.3290,100"/>
        <Slot Name="Red" Color="0.6400,0.3300,20"/>
        <Slot Name="Blue" Color="0.1500,0.0600,10"/>
      </Wheel>
    </Wheels>
    <DMXModes>
      <DMXMode Name="Standard">
        <DMXChannels>
          <DMXChannel DMXBreak="1" Offset="1,2"><LogicalChannel Attribute="Pan"><ChannelFunction Attribute="Pan" DMXFrom="0/2" Default="32768/2"/></LogicalChannel></DMXChannel>
          <DMXChannel DMXBreak="1" Offset="3,4"><LogicalChannel Attribute="Tilt"><ChannelFunction Attribute="Tilt" DMXFrom="0/2" Default="32768/2"/></LogicalChannel></DMXChannel>
          <DMXChannel DMXBreak="1" Offset="5"><LogicalChannel Attribute="Shutter1">
            <ChannelFunction Name="Closed" Attribute="Shutter1" DMXFrom="0/1"/>
            <ChannelFunction Name="Open" Attribute="Shutter1" DMXFrom="32/1"/>
            <ChannelFunction Name="Strobe" Attribute="Shutter1Strobe" DMXFrom="64/1"/>
          </LogicalChannel></DMXChannel>
          <DMXChannel DMXBreak="1" Offset="6"><LogicalChannel Attribute="Dimmer"><ChannelFunction Attribute="Dimmer" DMXFrom="0/1" Default="0/1"/></LogicalChannel></DMXChannel>
          <DMXChannel DMXBreak="1" Offset="7"><LogicalChannel Attribute="Color1"><ChannelFunction Attribute="Color1" Wheel="Color1" DMXFrom="0/1">
            <ChannelSet Name="Open" DMXFrom="0/1" WheelSlotIndex="1"/>
            <ChannelSet Name="Red" DMXFrom="10/1" WheelSlotIndex="2"/>
            <ChannelSet Name="Blue" DMXFrom="20/1" WheelSlotIndex="3"/>
          </ChannelFunction></LogicalChannel></DMXChannel>
          <DMXChannel DMXBreak="1" Offset="8"><LogicalChannel Attribute="Gobo1"><ChannelFunction Attribute="Gobo1" DMXFrom="0/1"/></LogicalChannel></DMXChannel>
          <DMXChannel DMXBreak="1" Offset=""><LogicalChannel Attribute="Virtual"/></DMXChannel>
        </DMXChannels>
      </DMXMode>
      <DMXMode Name="Basic">
        <DMXChannels>
          <DMXChannel DMXBreak="1" Offset="1"><LogicalChannel Attribute="Dimmer"/></DMXChannel>
        </DMXChannels>
      </DMXMode>
    </DMXModes>
  </FixtureType>
</GDTF>`;
const gdtf = () => makeZip([['description.xml', GDTF_XML, true]]);

const OFL = {
  name: 'Par 7',
  meta: { manufacturer: 'Example' },
  availableChannels: {
    Dimmer: { fineChannelAliases: ['Dimmer fine'], capability: { type: 'Intensity' } },
    Red: { capability: { type: 'ColorIntensity', color: 'Red' } },
    Green: { capability: { type: 'ColorIntensity', color: 'Green' } },
    Blue: { capability: { type: 'ColorIntensity', color: 'Blue' } },
    'Warm White': { capability: { type: 'ColorIntensity', color: 'Warm White' } },
    Strobe: { capabilities: [{ dmxRange: [0, 9], type: 'ShutterStrobe', shutterEffect: 'Open' }, { dmxRange: [10, 255], type: 'ShutterStrobe', shutterEffect: 'Strobe' }] },
    Program: { defaultValue: 0, capability: { type: 'Maintenance' } },
  },
  modes: [
    { name: '4-channel', channels: ['Red', 'Green', 'Blue', 'Warm White'] },
    { name: '8-channel', channels: ['Dimmer', 'Dimmer fine', 'Red', 'Green', 'Blue', 'Warm White', 'Strobe', 'Program'] },
  ],
};

test('xyY to sRGB', () => {
  assert.strictEqual(xyToHex(0.3127, 0.329), '#ffffff');
  const red = xyToHex(0.64, 0.33);
  assert.ok(parseInt(red.slice(1, 3), 16) > 240 && parseInt(red.slice(3, 5), 16) < 30, red);
});

test('GDTF: modes, 16-bit, shutter open value, wheel slots with colours', () => {
  const [std, basic] = readGdtf(gdtf());
  assert.strictEqual(std.name, 'Example Lighting Spot 300 · Standard (8ch)');
  assert.strictEqual(basic.footprint, 1);
  const ch = std.channelList;
  assert.deepStrictEqual(ch.map((c) => (c.fine ? `${c.attr}.fine` : c.attr)), ['pan', 'pan.fine', 'tilt', 'tilt.fine', 'shutter', 'dim', 'colorwheel', 'gobo']);
  assert.ok(Math.abs(ch[0].def - 0.5) < 0.001);
  assert.strictEqual(Math.round(ch[4].def * 255), 32); // shutter open
  assert.deepStrictEqual(ch[6].slots.map((s) => [s.dmx, s.name]), [[0, 'Open'], [10, 'Red'], [20, 'Blue']]);
  assert.strictEqual(ch[6].slots[0].color, '#ffffff');
  assert.throws(() => readFixtureFiles('x.gdtf', makeZip([['other.xml', '<a/>', false]])), /not a GDTF/);
});

test('Open Fixture Library: fine channels, colours, shutter, maintenance', () => {
  const [four, eight] = readOfl(OFL);
  assert.strictEqual(four.name, 'Example Par 7 · 4-channel (4ch)');
  assert.deepStrictEqual(eight.channelList.map((c) => (c.fixed !== undefined ? c.fixed : c.fine ? `${c.attr}.fine` : c.attr)), ['dim', 'dim.fine', 'red', 'green', 'blue', 'white', 'shutter', 0]);
  assert.strictEqual(eight.channelList[6].def, 0);
  assert.throws(() => readFixtureFiles('x.json', Buffer.from('{"a":1}')), /Open Fixture Library/);
});

test('imported types drive DMX: colour wheel, CMY, shutter default, curves', () => {
  const show = emptyShow();
  const e = new Engine(show);
  const [std] = readGdtf(gdtf());
  e.dispatch({ type: 'profile.import', profiles: [std] });
  const id = e.lastImportedProfiles[0].id;
  e.dispatch({ type: 'fixture.add', profile: id, universe: 1, address: 1 });
  e.dispatch({ type: 'fixture.add', profile: 'spot', universe: 1, address: 20 });
  e.dispatch({ type: 'fixture.add', profile: 'dimmer', universe: 1, address: 40 });
  const [wheelFx, cmyFx, dimFx] = e.show.fixtures.map((f) => f.id);
  e.dispatch({ type: 'prog.set', fixtures: [wheelFx, cmyFx], values: { dim: 1 } });
  e.dispatch({ type: 'prog.color', fixtures: [wheelFx, cmyFx], rgb: [1, 0.1, 0] });
  let d = e.render(e.computeLook()).get(1);
  assert.strictEqual(d[4], 32, 'shutter open by default');
  assert.strictEqual(d[6], 10, 'wheel goes to the red slot');
  // generic CMY spot: pan pan.fine tilt tilt.fine shutter dim dim.fine C M Y ...
  assert.deepStrictEqual([d[19 + 7], d[19 + 8], d[19 + 9]], [0, 230, 255], 'CMY for red: no cyan, full magenta + yellow');
  // Dimmer curve on a fixture type
  e.dispatch({ type: 'prog.set', fixtures: [dimFx], values: { dim: 0.5 } });
  assert.strictEqual(e.render(e.computeLook()).get(1)[39], 128);
  const custom = e.dispatch({ type: 'profile.save', name: 'Tungsten', channels: 'dim', curve: 'square' }) && Object.keys(e.show.profiles).find((k) => e.show.profiles[k].name === 'Tungsten');
  e.dispatch({ type: 'fixture.edit', id: dimFx, profile: custom });
  e.dispatch({ type: 'prog.set', fixtures: [dimFx], values: { dim: 0.5 } });
  d = e.render(e.computeLook()).get(1);
  assert.strictEqual(d[39], 64, 'square curve: 50% -> 25%');
  // profile list shows a summary for imported types
  const listed = e.profileList().find((p) => p.id === id);
  assert.match(listed.channels, /^pan pan\.fine tilt tilt\.fine shutter dim colorwheel\[3\] gobo$/);
  assert.strictEqual(listed.imported, true);
});

test('MVR with embedded GDTF gives fixture types for its lights', () => {
  const xml = `<?xml version="1.0"?><GeneralSceneDescription verMajor="1" verMinor="5"><Scene><Layers><Layer name="L" uuid="L"><ChildList>
    <Fixture name="Spot 1" uuid="A"><Matrix>{1,0,0}{0,1,0}{0,0,1}{0,0,6000}</Matrix><GDTFSpec>Example@Spot300.gdtf</GDTFSpec><GDTFMode>Standard</GDTFMode><Addresses><Address>1</Address></Addresses></Fixture>
  </ChildList></Layer></Layers></Scene></GeneralSceneDescription>`;
  const mvr = readMvr(makeZip([['GeneralSceneDescription.xml', xml, true], ['Example@Spot300.gdtf', gdtf(), false]]));
  assert.strictEqual(mvr.profiles.length, 1);
  assert.strictEqual(mvr.profiles[0].key, mvr.fixtures[0].type);
  assert.strictEqual(mvr.profiles[0].footprint, 8);
});

test('compiled profile flags', () => {
  const p = compileProfile({ name: 'x', channels: 'dim cyan magenta yellow' });
  assert.strictEqual(p.cmy, true);
  assert.deepStrictEqual(p.additive, []);
  assert.strictEqual(compileProfile({ name: 'y', channels: 'red green blue' }).attrs[0], 'dim'); // virtual dimmer
});
