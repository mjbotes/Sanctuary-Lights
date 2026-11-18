'use strict';
// Live takes on the server: records live actions while a take is recording (App.run calls observe),
// and plays a song's take back as the song plays (a 20 ms timer).
// On a jump in the song (repeat, skip, seek, loop) the take catches up: live changes are released
// and every lasting change up to the new position is applied again (momentary ones like flashes
// are left out).
const { MOMENTARY } = require('../engine/actions/takes');

class Takes {
  constructor(app) {
    this.app = app;
    this.lastPos = null;
    this.songId = null;
    this.timer = setInterval(() => this.tick(), 20);
  }

  observe(action) {
    const e = this.app.engine;
    if (e.rt.recording && e.recordTake(action)) this.app.hub.broadcast('runtime', e.runtimeState());
  }

  run(a) {
    try {
      this.app.run({ ...a, _take: true }, 'operator', 'the live take');
    } catch (err) {
      this.app.log.warn(`Live take: ${err.message}`);
    }
  }

  tick(now = Date.now()) {
    const e = this.app.engine;
    const song = e.song(e.rt.songId);
    const take = song && song.take;
    // Not playing a take (or recording one): forget where we were; release what the take did
    if (!take || !take.on || !take.events.length || e.rt.recording) return this.reset();
    const pos = e.songPosition(song.id, now);
    if (pos === null) return this.reset();
    if (this.songId !== song.id || this.lastPos === null || pos < this.lastPos - 0.05 || pos > this.lastPos + 1.5) {
      // Start, or a jump: rebuild the live state at this position
      this.run({ type: 'busk.release' });
      for (const ev of take.events) if (ev.t <= pos && !MOMENTARY(ev.a)) this.run(ev.a);
      this.songId = song.id;
      this.active = true;
    } else {
      for (const ev of take.events) if (ev.t > this.lastPos && ev.t <= pos) this.run(ev.a);
    }
    this.lastPos = pos;
  }

  reset() {
    if (this.active) {
      this.active = false;
      // The take's live changes end with the song (flashes and strobes too)
      this.run({ type: 'busk.release' });
      this.run({ type: 'flash.all', on: false });
      this.run({ type: 'strobe.hold', on: false });
    }
    this.lastPos = null;
    this.songId = null;
  }

  close() {
    clearInterval(this.timer);
  }
}

module.exports = { Takes };
