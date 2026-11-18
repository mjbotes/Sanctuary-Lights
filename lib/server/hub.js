'use strict';
// Live updates to every open screen (Server-Sent Events):
//   state   - whole show + runtime (after the show changed)
//   runtime - what is playing / live changes
//   live    - light colours for the stage views, ~12 times a second
class LiveHub {
  constructor() {
    this.clients = new Set(); // { res, role }
    this.lastLive = '';
    this.ping = setInterval(() => this.each((c) => c.res.write(': ping\n\n')), 15000);
    this.ping.unref && this.ping.unref();
  }

  each(fn) {
    for (const c of this.clients) {
      try {
        fn(c);
      } catch {
        this.clients.delete(c);
      }
    }
  }

  static write(res, event, data) {
    res.write(`event: ${event}\ndata: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`);
  }

  open(req, res, role, first) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write('retry: 1500\n\n');
    const client = { res, role };
    for (const [event, data] of first) LiveHub.write(res, event, data);
    this.clients.add(client);
    req.on('close', () => this.clients.delete(client));
  }

  // data may be a function of the client's role (to hide things from lower roles)
  broadcast(event, data) {
    const cache = new Map();
    this.each((c) => {
      let d = data;
      if (typeof data === 'function') {
        if (!cache.has(c.role)) cache.set(c.role, JSON.stringify(data(c.role)));
        d = cache.get(c.role);
      }
      LiveHub.write(c.res, event, d);
    });
  }

  sendLive(json) {
    if (!this.clients.size || json === this.lastLive) return;
    this.lastLive = json;
    this.each((c) => c.res.write(`event: live\ndata: ${json}\n\n`));
  }

  // Ask every screen to log in again (e.g. after PINs changed)
  kickAll() {
    this.each((c) => LiveHub.write(c.res, 'auth', { reauth: true }));
  }

  close() {
    clearInterval(this.ping);
    this.each((c) => c.res.end());
  }
}

module.exports = { LiveHub };
