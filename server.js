#!/usr/bin/env node
'use strict';
// Sanctuary Lights: lighting, tracks and vocals for churches.
// Run:  node server.js   then open http://localhost:8080
// The code is organised in lib/server (this app), lib/engine (show logic) and public/ (the screens).
const http = require('http');
const { loadConfig } = require('./lib/server/config');
const { App } = require('./lib/server/app');
const { makeHandler, interfaces } = require('./lib/server/routes');

const cfg = loadConfig();
const app = new App(cfg);
const server = http.createServer(makeHandler(app));

// Keep running whatever happens: log the error, keep the lights on.
process.on('uncaughtException', (e) => app.reportError('Unexpected error', e));
process.on('unhandledRejection', (e) => app.reportError('Unexpected error', e));

// When embedded in the desktop app, it waits on this promise (or a message from this process).
let readyResolve, readyReject;
const ready = new Promise((res, rej) => { readyResolve = res; readyReject = rej; });
ready.catch(() => {});
const tellParent = (msg) => process.parentPort && process.parentPort.postMessage(msg);

server.on('error', (e) => {
  const msg = e.code === 'EADDRINUSE' ? `Port ${cfg.port} is already in use. Is Sanctuary Lights already running? (Set PORT=8081 to use another port.)` : String(e);
  console.error(msg);
  tellParent({ error: msg });
  if (cfg.embedded) return readyReject(new Error(msg));
  process.exit(1);
});

server.listen(cfg.port, cfg.host, () => {
  readyResolve({ port: cfg.port });
  tellParent({ ready: true, port: cfg.port });
  console.log(`\n  Sanctuary Lights ${cfg.version} is running.\n`);
  console.log(`  On this computer:   http://localhost:${cfg.port}`);
  for (const i of interfaces()) console.log(`  On iPad/phone:      http://${i.address}:${cfg.port}   (${i.name})`);
  console.log(`\n  Show file: ${cfg.showFile}`);
  console.log('  Press Ctrl+C to stop.\n');
});

function shutdown() {
  app.close();
  server.close();
}
// Messages from the desktop app (quit, update status)
if (process.parentPort) {
  app.toParent = tellParent;
  process.parentPort.on('message', (e) => {
    const msg = e.data || {};
    if (msg.quit) {
      shutdown();
      process.exit(0);
    }
    if (msg.update) app.setUpdate(msg.update);
  });
}
if (!cfg.embedded) {
  process.on('SIGINT', () => (shutdown(), process.exit(0)));
  process.on('SIGTERM', () => (shutdown(), process.exit(0)));
}

module.exports = { ready, shutdown, app };
