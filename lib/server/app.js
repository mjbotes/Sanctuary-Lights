'use strict';
// The running app: engine + saving + undo + access control + devices + live updates.
// server.js creates one App and starts it; the desktop app runs server.js in a supervised process.
const { Engine, demoShow } = require('../engine');
const { ShowStore } = require('./store');
const { History } = require('./history');
const { Auth, makeAccess } = require('./auth');
const { LiveHub } = require('./hub');
const { Devices } = require('./devices');
const { PlanningCenter } = require('../pco');
const { Mcp } = require('./mcp');
const { Takes } = require('./takes');
const { ServiceLog } = require('./servicelog');
const { FixtureLibrary } = require('../ofl');
const { Health } = require('./health');
const path = require('path');

// Actions that only change what is playing (never the saved show): no undo step, no show JSON.
const LIVE_ONLY = /^(cue\.(go|back|goto|release)|section\.go|song\.select|scene\.(toggle|level|releaseAll)|look\.apply|prog\.|tricks\.|busk\.|strobe\.|flash\.|gm\.|blackout\.|tempo\.|fx\.(run|adjust|stop)|pad\.press|transport|audio\.host|vocal\.set|hold\.set|mode\.set|midi\.(learn|message)|osc\.|pp\.(slide|color|status)|palette\.release|sound\.(beat|level|stop)|panic)/;

class App {
  constructor(cfg, log = console) {
    this.cfg = cfg;
    this.log = log;
    this.store = new ShowStore(cfg, log);
    const { show, runtime } = this.store.load();
    // Planning Center sign-in is kept in its own file, not in the show
    this.pco = new PlanningCenter(path.join(cfg.dataDir, 'planning-center.json'), cfg.pcoBase);
    // AI assistant connection (MCP): settings and its secret token in their own file
    this.mcp = new Mcp(this, path.join(cfg.dataDir, 'mcp.json'));
    this.ofl = new FixtureLibrary(path.join(cfg.dataDir, 'ofl'), cfg.oflBase); // Open Fixture Library search
    this.takes = new Takes(this); // live takes: recording and playback
    this.snapshots = new Map(); // id -> resolve, for pictures of the 3D view from an app window
    this.engine = new Engine(show || demoShow(), runtime);
    // First start: the demo show also gets the "Graves Into Gardens" demo song
    if (!show) this.engine.dispatch({ type: 'demo.addSong', id: 'graves-into-gardens', select: false });
    this.engine.on('log', (m) => log.warn(m));
    // Auto-follow cues and similar changes made by the engine itself
    // Service report: what happened, and what caused it
    this.servicelog = new ServiceLog(this, path.join(cfg.dataDir, 'reports'));
    this.lastSnap = this.servicelog.snapshot();
    this.health = new Health(this, path.join(cfg.dataDir, 'health.json')); // hours on, problems, maintenance
    this.engine.on('changed', () => {
      // Changes the engine makes by itself: auto-follow cues, the schedule
      const ls = this.engine.rt.lastSchedule;
      this.servicelog.diff(this.lastSnap, null, ls && Date.now() - ls.at < 1500 ? 'the schedule' : 'automatic (follow)');
      this.lastSnap = this.servicelog.snapshot();
      this.store.saveRuntimeSoon(this.engine.persistentRuntime());
      setImmediate(() => this.hub.broadcast('runtime', this.engine.runtimeState()));
    });
    this.history = new History();
    this.auth = new Auth();
    this.auth.setConfig(this.engine.show.settings.access);
    this.hub = new LiveHub();
    this.devices = new Devices(this, log);
    this.latestLook = this.engine.computeLook();
    this.showJson = JSON.stringify(this.engine.show);
    this.errors = [];
    this.devices.configure(this.engine.show.settings);
    this.store.saveShowSoon(this.engine.show);
    this.store.startAutoSnapshots(() => this.engine.show);
    this.liveTimer = setInterval(() => this.hub.sendLive(JSON.stringify(this.engine.liveState(this.latestLook))), 80);
  }

  // ----- state sent to screens --------------------------------------------------------
  // The show without secrets (PIN hashes) for screens.
  publicShow() {
    const s = this.engine.show;
    const access = s.settings.access || {};
    return { ...s, settings: { ...s.settings, access: { enabled: !!(access.pins && access.pins.admin), localAdmin: access.localAdmin !== false, levels: Object.keys(access.pins || {}) } } };
  }

  fullState(role = 'admin') {
    return {
      show: this.publicShow(),
      profiles: this.engine.profileList(),
      runtime: this.engine.runtimeState(),
      history: this.history.status(),
      role,
      version: this.cfg.version,
      update: this.update || null,
      health: this.health ? this.health.list() : null,
      ...this.devices.status(),
    };
  }

  pushState() {
    this.hub.broadcast('state', (role) => this.fullState(role));
  }

  // ----- actions ------------------------------------------------------------------
  // Actions from inputs (MIDI, OSC, ProPresenter): trusted, as operator.
  // From devices and automation (MIDI, OSC, ProPresenter, the controller…); source is for the service report
  input(action, source) {
    return this.run(action, 'operator', source);
  }

  // Run an action for a user with `role`. Returns extra data for the reply (or nothing).
  run(action, role = 'admin', source = null) {
    const type = action && action.type;
    if (!type) throw new Error('No action');
    if (!this.auth.allowed(role, type)) throw new Error(role ? `Your PIN (${role}) cannot do that` : 'Please enter your PIN');
    const special = this.special(action);
    if (special) return special;
    const songBefore = this.engine.rt.songId;
    const before = this.showJson;
    const reportBefore = this.servicelog ? this.servicelog.snapshot() : null;
    const changed = this.engine.dispatch(action); // throws on bad input
    if (this.takes) this.takes.observe(action);
    if (this.servicelog) {
      this.servicelog.diff(reportBefore, action, source);
      this.lastSnap = this.servicelog.snapshot();
    }
    if (this.engine.rt.songId !== songBefore && !this.engine.rt.practice) this.devices.sendSongMidi(this.engine.song(this.engine.rt.songId), this.engine.show.settings.midiOutput);
    if (changed.show) this.showChanged(type, this.undoKey(action), before);
    if (!changed.show && !changed.runtime) return this.engine.lastResult || null;
    this.store.saveRuntimeSoon(this.engine.persistentRuntime());
    this.latestLook = this.engine.computeLook();
    if (changed.show) this.pushState();
    else this.hub.broadcast('runtime', this.engine.runtimeState());
    if (type === 'mvr.apply') return { skipped: this.engine.lastImportSkipped || [] };
    if (type === 'effect.save') return { id: this.engine.lastSavedEffect };
    if (type === 'profile.import') return { added: this.engine.lastImportedProfiles || [] };
    return this.engine.lastResult || null;
  }

  // Undo key: repeated edits of the same thing within 2 s merge into one step (dragging a fader,
  // typing). Creating, recording and deleting always get their own step.
  undoKey(a) {
    if (LIVE_ONLY.test(a.type)) return null;
    if (/\.(edit|set|audio)$/.test(a.type)) return `${a.type}|${a.id || ''}|${a.songId || ''}|${a.sectionId || ''}|${a.index ?? ''}`;
    this.keySeq = (this.keySeq || 0) + 1;
    return `${a.type}#${this.keySeq}`;
  }

  showChanged(type, key, before) {
    this.showJson = JSON.stringify(this.engine.show);
    if (key && before !== this.showJson) this.history.record(type, key, before);
    this.store.saveShowSoon(this.engine.show);
    this.devices.configure(this.engine.show.settings);
    this.auth.setConfig(this.engine.show.settings.access);
  }

  // Server-level actions: undo/redo, snapshots, PINs
  special(a) {
    if (a.type.startsWith('health.')) return this.health.action(a);
    switch (a.type) {
      case 'history.undo':
      case 'history.redo': {
        const step = a.type === 'history.undo' ? this.history.undo(this.showJson) : this.history.redo(this.showJson);
        if (!step) throw new Error(a.type === 'history.undo' ? 'Nothing to undo' : 'Nothing to redo');
        this.replaceShow(JSON.parse(step.json));
        return { label: step.label };
      }
      case 'snapshot.save': {
        const name = this.store.snapshot(this.engine.show, a.label || 'manual');
        this.pushState();
        return { name };
      }
      case 'snapshot.list':
        return { snapshots: this.store.listSnapshots() };
      case 'snapshot.restore': {
        const show = this.store.readSnapshot(a.name);
        this.history.record('snapshot.restore', null, this.showJson);
        this.replaceShow(show);
        return { restored: a.name };
      }
      // Updates are handled by the desktop app (electron/updater.js); these just pass the buttons on.
      case 'update.check':
      case 'update.install': {
        if (!this.toParent) throw new Error('Updates work in the installed desktop app');
        this.toParent(a.type === 'update.install' ? { installUpdate: true } : { checkUpdates: true });
        return { sent: true };
      }
      case 'access.set': {
        const access = makeAccess(this.engine.show.settings.access, a);
        this.engine.show.settings.access = access;
        this.showJson = JSON.stringify(this.engine.show);
        this.store.saveShowSoon(this.engine.show);
        this.auth.setConfig(access);
        this.auth.sessions.clear();
        this.pushState();
        this.hub.kickAll();
        return { enabled: !!access.pins.admin };
      }
      default:
        return null;
    }
  }

  // A picture of the 3D view from an app window (data URL), or null when none answers in time
  requestSnapshot(view = 'front', timeout = 3000) {
    const id = require('crypto').randomUUID();
    return new Promise((resolve) => {
      const done = (url) => { clearTimeout(timer); this.snapshots.delete(id); resolve(url); };
      const timer = setTimeout(() => done(null), timeout);
      this.snapshots.set(id, done);
      this.hub.broadcast('snapshot', { id, view });
    });
  }

  // Update status from the desktop app
  setUpdate(state) {
    this.update = state;
    this.pushState();
  }

  // Swap in another version of the show (undo, snapshots) and keep what is playing.
  replaceShow(show) {
    const keep = this.engine.show.settings;
    show.settings = { ...show.settings, access: keep.access, cid: keep.cid };
    this.engine.replaceShow(show);
    this.showJson = JSON.stringify(this.engine.show);
    this.store.saveShowSoon(this.engine.show);
    this.devices.configure(this.engine.show.settings);
    this.latestLook = this.engine.computeLook();
    this.pushState();
  }

  // Errors are logged to logs/sanctuary.log and shown in Setup, but never stop the lights.
  reportError(where, e) {
    const msg = `${where}: ${e && e.stack ? e.stack : e}`;
    if (this.errors[0] && this.errors[0].msg === msg) return;
    this.errors.unshift({ at: Date.now(), msg });
    this.errors.length = Math.min(this.errors.length, 20);
    this.log.error(msg);
    this.store.logLine('ERROR', msg);
    if (this.servicelog) this.servicelog.problem(`${where}: ${String((e && e.message) || e).split('\n')[0]}`);
  }

  close() {
    clearInterval(this.liveTimer);
    this.takes.close();
    this.servicelog.close();
    this.health.close();
    try {
      this.store.saveNow(this.engine.show, this.engine.persistentRuntime());
    } catch {}
    this.store.close();
    this.devices.close();
    this.hub.close();
  }
}

module.exports = { App };
