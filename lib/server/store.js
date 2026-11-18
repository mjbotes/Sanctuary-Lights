'use strict';
// Saving the show: atomic writes, a backup on every start, and snapshots
// (automatic every few minutes when something changed, or saved by hand).
const fs = require('fs');
const path = require('path');

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeJsonAtomic(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, typeof data === 'string' ? data : JSON.stringify(data, null, 1));
  fs.renameSync(tmp, file);
}

function keepNewest(dir, filter, keep) {
  const files = fs.readdirSync(dir).filter(filter).sort();
  for (const f of files.slice(0, Math.max(0, files.length - keep))) fs.unlinkSync(path.join(dir, f));
}

class ShowStore {
  constructor(cfg, log = console) {
    this.cfg = cfg;
    this.log = log;
    this.timers = {};
    this.dirtySinceSnapshot = false;
    for (const d of [cfg.dataDir, cfg.backupDir, cfg.snapshotDir, cfg.assetsDir, cfg.logDir]) fs.mkdirSync(d, { recursive: true });
  }

  // Copy the saved show into backups/ (keeps the last 30) and return { show, runtime }.
  load() {
    if (fs.existsSync(this.cfg.showFile)) {
      fs.copyFileSync(this.cfg.showFile, path.join(this.cfg.backupDir, `show-${stamp()}.json`));
      keepNewest(this.cfg.backupDir, (f) => f.endsWith('.json'), 30);
    }
    return { show: readJson(this.cfg.showFile), runtime: readJson(this.cfg.runtimeFile) || {} };
  }

  later(key, ms, fn) {
    clearTimeout(this.timers[key]);
    this.timers[key] = setTimeout(() => {
      try {
        fn();
      } catch (e) {
        this.log.error(`Could not save (${key}): ${e.message}`);
      }
    }, ms);
  }

  saveShowSoon(show) {
    this.dirtySinceSnapshot = true;
    this.later('show', 400, () => writeJsonAtomic(this.cfg.showFile, show));
  }

  saveRuntimeSoon(runtime) {
    this.later('runtime', 1000, () => writeJsonAtomic(this.cfg.runtimeFile, runtime));
  }

  saveNow(show, runtime) {
    for (const t of Object.values(this.timers)) clearTimeout(t);
    writeJsonAtomic(this.cfg.showFile, show);
    if (runtime) writeJsonAtomic(this.cfg.runtimeFile, runtime);
  }

  // ----- snapshots ---------------------------------------------------------------
  snapshot(show, label = '', auto = false) {
    const safe = String(label || '').replace(/[^a-zA-Z0-9 _-]/g, '').trim().slice(0, 40);
    const name = `${auto ? 'auto' : 'saved'}-${stamp()}${safe ? `-${safe.replace(/ /g, '_')}` : ''}.json`;
    writeJsonAtomic(path.join(this.cfg.snapshotDir, name), show);
    keepNewest(this.cfg.snapshotDir, (f) => f.startsWith('auto-'), 48);
    this.dirtySinceSnapshot = false;
    return name;
  }

  // Every `minutes`, if the show changed since the last snapshot, save one.
  startAutoSnapshots(getShow, minutes = 5) {
    clearInterval(this.autoTimer);
    this.autoTimer = setInterval(() => {
      if (!this.dirtySinceSnapshot) return;
      try {
        this.snapshot(getShow(), '', true);
      } catch (e) {
        this.log.error(`Snapshot failed: ${e.message}`);
      }
    }, minutes * 60 * 1000);
    this.autoTimer.unref && this.autoTimer.unref();
  }

  listSnapshots() {
    return fs.readdirSync(this.cfg.snapshotDir).filter((f) => f.endsWith('.json')).sort().reverse().map((name) => {
      const st = fs.statSync(path.join(this.cfg.snapshotDir, name));
      const m = /^(auto|saved)-(\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d)-?(.*)\.json$/.exec(name) || [];
      return { name, auto: m[1] === 'auto', label: (m[3] || '').replace(/_/g, ' '), time: st.mtime.toISOString(), size: st.size };
    });
  }

  readSnapshot(name) {
    const file = path.join(this.cfg.snapshotDir, path.basename(String(name)));
    const show = readJson(file);
    if (!show) throw new Error('Snapshot not found');
    return show;
  }

  // Append to logs/sanctuary.log (kept small: rotated at 2 MB)
  logLine(level, msg) {
    try {
      const file = path.join(this.cfg.logDir, 'sanctuary.log');
      if (fs.existsSync(file) && fs.statSync(file).size > 2e6) fs.renameSync(file, `${file}.1`);
      fs.appendFileSync(file, `${new Date().toISOString()} ${level} ${msg}\n`);
    } catch {}
  }

  close() {
    clearInterval(this.autoTimer);
  }
}

module.exports = { ShowStore, readJson, writeJsonAtomic };
