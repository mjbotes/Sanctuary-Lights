'use strict';
// The MCP server (AI assistant connection): protocol, safety (off by default, token, role), tools,
// over HTTP and through the stdio bridge.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { loadConfig } = require('../lib/server/config');
const { App } = require('../lib/server/app');
const { makeHandler } = require('../lib/server/routes');

const quiet = { log() {}, warn() {}, error() {} };
async function start() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-mcp-'));
  const app = new App(loadConfig({ LIGHTS_DATA: dir, PORT: '0' }), quiet);
  const server = http.createServer(makeHandler(app));
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  let id = 0;
  const rpc = async (method, params, token = app.mcp.cfg.token) => {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
    return { status: r.status, body: r.status === 202 ? null : await r.json() };
  };
  const call = async (name, args = {}) => {
    const r = await rpc('tools/call', { name, arguments: args });
    const res = r.body.result;
    return { text: res.content[0].text, error: !!res.isError };
  };
  return { app, url, rpc, call, done: () => { server.close(); app.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('off until switched on, and needs the token', async () => {
  const t = await start();
  try {
    let r = await t.rpc('initialize', { protocolVersion: '2025-06-18' });
    assert.strictEqual(r.status, 403, 'off by default');
    t.app.mcp.configure({ enabled: true });
    r = await t.rpc('initialize', {}, 'wrong');
    assert.strictEqual(r.status, 401);
    r = await t.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test' } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.result.protocolVersion, '2025-06-18');
    assert.strictEqual(r.body.result.serverInfo.name, 'sanctuary-lights');
    assert.ok(r.body.result.capabilities.tools);
    // Notifications get 202 and no body
    const n = await fetch(t.url, { method: 'POST', headers: { Authorization: `Bearer ${t.app.mcp.cfg.token}` }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
    assert.strictEqual(n.status, 202);
    // The token is kept privately and survives a restart
    const file = path.join(t.app.cfg.dataDir, 'mcp.json');
    assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
    assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).token, t.app.mcp.cfg.token);
    r = await t.rpc('nope/method');
    assert.strictEqual(r.body.error.code, -32601);
  } finally {
    t.done();
  }
});

test('tools: overview, light a song, compose a look, parts, and undo', async () => {
  const t = await start();
  t.app.mcp.configure({ enabled: true });
  try {
    const list = (await t.rpc('tools/list')).body.result.tools;
    assert.ok(list.length >= 15 && list.every((x) => x.name && x.description && x.inputSchema && x.inputSchema.type === 'object'));
    const ov = JSON.parse((await t.call('get_overview')).text);
    assert.ok(ov.setList.some((s) => s.name === 'Graves Into Gardens'), 'demo song on a new install');
    assert.deepStrictEqual(Object.keys(ov.lights).sort(), ['back', 'front', 'house', 'special']);

    // Add a song (by a loose name of a known song: it comes back), light a new one
    let r = await t.call('add_song', { name: 'Way Maker', sections: ['Intro', 'Verse 1', 'Chorus', 'Bridge', 'Outro'], bpm: 68 });
    assert.match(r.text, /Added "Way Maker"/);
    r = await t.call('light_song', { song: 'way maker' });
    assert.match(r.text, /Chorus → Way Maker · Chorus/);
    r = await t.call('set_song_colors', { song: 'Way Maker', primary: 'deep blue', secondary: '#ff00aa' });
    assert.match(r.text, /#1020a0, #ff00aa/);

    // Compose a look in plain terms and use it
    r = await t.call('compose_look', { name: 'Big Bridge', parts: [{ lights: 'back', intensity: 100, color: 'secondary', effect: 'palette chase' }, { lights: 'front', intensity: 80, color: 'warm white' }], show: true });
    assert.match(r.text, /Look "Big Bridge" saved \(10 lights, 1 effects\) and on stage now/);
    r = await t.call('set_section', { song: 'Way Maker', section: 'bridge', look: 'Big Bridge', fade: 2 });
    assert.match(r.text, /Way Maker · Bridge: look Big Bridge, fade 2s/);
    r = await t.call('compose_look', { name: 'x', parts: [{ lights: 'the choir', intensity: 50 }] });
    assert.ok(r.error && /Unknown lights: the choir/.test(r.text), 'clear errors come back as tool errors');

    // Service parts and live control
    r = await t.call('save_part', { name: 'Baptism', look: 'Big Bridge', brightness: 90, words: 'baptism' });
    assert.match(r.text, /Added service part "Baptism"/);
    r = await t.call('set_part', { part: 'baptism' });
    assert.strictEqual(t.app.engine.part(t.app.engine.rt.partId).name, 'Baptism');
    r = await t.call('go', { song: 'Graves Into Gardens', section: 'Bridge 3' });
    assert.match(r.text, /Graves Into Gardens · Bridge 3/);
    assert.strictEqual(t.app.engine.part(t.app.engine.rt.partId).name, 'Worship', 'a section tap brings worship back');
    r = await t.call('set_master', { level: 60, blackout: false });
    assert.match(r.text, /Master 60%/);

    // Every change is an undo step, like a button press
    const before = t.app.engine.show.parts.length;
    r = await t.call('undo');
    assert.match(r.text, /Undone/);
    assert.strictEqual(t.app.engine.show.parts.length, before - 1, 'the Baptism part is undone');

    // run_action for the rest
    r = await t.call('run_action', { type: 'tempo.set', params: { bpm: 72 } });
    assert.strictEqual(t.app.engine.rt.bpm, 72);
    r = await t.call('run_action', { type: 'no.such' });
    assert.ok(r.error);
  } finally {
    t.done();
  }
});

test('the role limits what the assistant may do', async () => {
  const t = await start();
  t.app.mcp.configure({ enabled: true, role: 'operator' });
  try {
    t.app.run({ type: 'access.set', admin: '1111', operator: '2222' }); // PINs on
    let r = await t.call('add_schedule', { days: [0], time: '09:30', action: 'blackout' });
    assert.ok(r.error && /operator/.test(r.text), 'schedules need admin');
    t.app.mcp.configure({ role: 'admin' });
    r = await t.call('add_schedule', { days: [0], time: '09:30', action: 'blackout' });
    assert.ok(!r.error, r.text);
    assert.strictEqual(t.app.engine.show.schedule.length, 1);
  } finally {
    t.done();
  }
});

test('stdio bridge (Claude Desktop) forwards messages', async () => {
  const t = await start();
  t.app.mcp.configure({ enabled: true });
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'bin', 'sanctuary-lights-mcp.js')], { env: { ...process.env, SANCTUARY_LIGHTS_URL: t.url, SANCTUARY_LIGHTS_TOKEN: t.app.mcp.cfg.token } });
  try {
    const lines = [];
    child.stdout.on('data', (d) => lines.push(...d.toString().split('\n').filter(Boolean)));
    const send = (m) => child.stdin.write(`${JSON.stringify(m)}\n`);
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    for (let i = 0; i < 100 && lines.length < 2; i++) await new Promise((ok) => setTimeout(ok, 30));
    assert.strictEqual(lines.length, 2, 'two answers (the notification has none)');
    assert.strictEqual(JSON.parse(lines[0]).result.serverInfo.name, 'sanctuary-lights');
    assert.ok(JSON.parse(lines[1]).result.tools.length > 10);
  } finally {
    child.kill();
    t.done();
  }
});
