#!/usr/bin/env node
'use strict';
// Stdio bridge for MCP clients that start a local command (Claude Desktop): forwards each JSON-RPC
// message from stdin to Sanctuary Lights' /mcp endpoint and writes the answer to stdout.
//
//   SANCTUARY_LIGHTS_URL    default http://localhost:8080/mcp
//   SANCTUARY_LIGHTS_TOKEN  the token from Setup → AI assistant
// (or --url … --token …)
const readline = require('readline');

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const url = arg('url') || process.env.SANCTUARY_LIGHTS_URL || 'http://localhost:8080/mcp';
const token = arg('token') || process.env.SANCTUARY_LIGHTS_TOKEN || '';

const write = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
const log = (...a) => process.stderr.write(`[sanctuary-lights-mcp] ${a.join(' ')}\n`);

let queue = Promise.resolve();
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  queue = queue.then(() => forward(line));
});

async function forward(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
  }
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}` },
      body: line,
    });
    const text = await r.text();
    if (!text.trim()) return; // a notification: nothing to answer
    write(JSON.parse(text));
  } catch (e) {
    log(e.message);
    // Answer requests (not notifications) so the client does not wait forever
    if (msg && msg.id !== undefined && msg.id !== null) write({ jsonrpc: '2.0', id: msg.id, error: { code: -32002, message: `Sanctuary Lights is not reachable at ${url} (${e.message}). Is the app running?` } });
  }
}
