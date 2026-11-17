'use strict';
// Runs the lighting/tracks server in its own process and restarts it if it ever stops.
// The screens reconnect by themselves, and the engine restores the cue/song position from runtime.json,
// so a crash costs about a second of frozen lights instead of a dark stage.
const { utilityProcess } = require('electron');
const path = require('path');
const { EventEmitter } = require('events');

class ServerSupervisor extends EventEmitter {
  constructor({ port, log }) {
    super();
    this.port = port;
    this.log = log;
    this.child = null;
    this.quitting = false;
    this.restarts = [];
  }

  // Resolves with the port once the server is listening.
  start() {
    return new Promise((resolve, reject) => {
      const child = utilityProcess.fork(path.join(__dirname, '..', 'server.js'), [], {
        env: { ...process.env, SL_EMBEDDED: '1', PORT: String(this.port) },
        stdio: 'pipe',
        serviceName: 'Sanctuary Lights engine',
      });
      this.child = child;
      let settled = false;
      child.stdout && child.stdout.on('data', (d) => this.log.info(String(d).trimEnd()));
      child.stderr && child.stderr.on('data', (d) => this.log.warn(String(d).trimEnd()));
      child.on('message', (msg) => {
        if (msg && msg.ready && !settled) {
          settled = true;
          resolve(msg.port);
        } else if (msg && msg.error && !settled) {
          settled = true;
          reject(new Error(msg.error));
        } else this.emit('message', msg);
      });
      child.on('exit', (code) => {
        this.child = null;
        if (!settled) {
          settled = true;
          reject(new Error(`The engine stopped while starting (code ${code})`));
        }
        if (this.quitting) return;
        this.log.error(`Engine stopped (code ${code}); restarting`);
        this.emit('crashed', code);
        this.restartSoon();
      });
    });
  }

  restartSoon() {
    const now = Date.now();
    this.restarts = this.restarts.filter((t) => now - t < 60000);
    this.restarts.push(now);
    // Back off if it keeps crashing: 0.5 s, 1 s, 2 s ... up to 10 s
    const delay = Math.min(10000, 500 * 2 ** (this.restarts.length - 1));
    setTimeout(() => {
      if (this.quitting) return;
      this.start().then(() => this.emit('restarted')).catch((e) => {
        this.log.error(`Restart failed: ${e.message}`);
        this.restartSoon();
      });
    }, delay);
  }

  send(msg) {
    if (this.child) this.child.postMessage(msg);
  }

  stop() {
    this.quitting = true;
    if (!this.child) return Promise.resolve();
    return new Promise((resolve) => {
      const child = this.child;
      const t = setTimeout(() => {
        try { child.kill(); } catch {}
        resolve();
      }, 3000);
      child.once('exit', () => {
        clearTimeout(t);
        resolve();
      });
      child.postMessage({ quit: true }); // lets the server save the show first
    });
  }
}

module.exports = { ServerSupervisor };
