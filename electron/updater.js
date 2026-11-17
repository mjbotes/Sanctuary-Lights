'use strict';
// Automatic updates from GitHub Releases.
// - Downloads in the background, installs when you quit the app (never restarts during a service).
// - "Restart now" in the app installs immediately (admin only).
// - Where self-updating is not possible (unsigned Mac builds, private repository), it still tells
//   you that a new version exists and links to the download page.
const { app, shell } = require('electron');
const https = require('https');

function getJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Sanctuary-Lights-updater', Accept: 'application/vnd.github+json' } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => (res.statusCode === 200 ? resolve(JSON.parse(body)) : reject(new Error(`HTTP ${res.statusCode}`))));
    }).on('error', reject);
  });
}

const newer = (a, b) => {
  const pa = String(a).replace(/^v/, '').split('.').map(Number), pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
};

class Updater {
  constructor({ report, log, repo }) {
    this.report = report; // (state) => void, sent to the screens
    this.log = log;
    this.repo = repo; // { owner, repo }
    this.state = { current: app.getVersion(), status: 'idle' };
  }

  set(patch) {
    this.state = { ...this.state, ...patch };
    this.report(this.state);
  }

  start() {
    if (!app.isPackaged) return; // only in the installed app
    let autoUpdater = null;
    try {
      ({ autoUpdater } = require('electron-updater'));
    } catch (e) {
      this.log.warn(`Updater not available: ${e.message}`);
    }
    this.auto = autoUpdater;
    if (autoUpdater) {
      autoUpdater.logger = { info: (m) => this.log.info(m), warn: (m) => this.log.warn(m), error: (m) => this.log.error(m), debug() {} };
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.on('checking-for-update', () => this.set({ status: 'checking' }));
      autoUpdater.on('update-not-available', () => this.set({ status: 'current', checkedAt: Date.now() }));
      autoUpdater.on('update-available', (i) => this.set({ status: 'downloading', version: i.version, notes: String(i.releaseNotes || '').slice(0, 500) }));
      autoUpdater.on('download-progress', (p) => this.set({ status: 'downloading', percent: Math.round(p.percent) }));
      autoUpdater.on('update-downloaded', (i) => this.set({ status: 'ready', version: i.version }));
      autoUpdater.on('error', (e) => {
        this.log.warn(`Auto-update: ${e.message}`);
        this.fallbackCheck();
      });
    }
    this.check();
    this.timer = setInterval(() => this.check(), 6 * 60 * 60 * 1000); // every 6 hours
  }

  check() {
    if (this.auto) this.auto.checkForUpdates().catch(() => this.fallbackCheck());
    else this.fallbackCheck();
  }

  // Ask GitHub directly for the latest release (works without signing; needs a public repository)
  async fallbackCheck() {
    if (!this.repo) return;
    try {
      const rel = await getJson(`https://api.github.com/repos/${this.repo.owner}/${this.repo.repo}/releases/latest`);
      if (newer(rel.tag_name, app.getVersion())) this.set({ status: 'manual', version: rel.tag_name.replace(/^v/, ''), url: rel.html_url });
      else this.set({ status: 'current', checkedAt: Date.now() });
    } catch (e) {
      this.set({ status: 'error', error: 'Could not check for updates (offline, or the repository is private)' });
    }
  }

  install() {
    if (this.state.status === 'ready' && this.auto) {
      this.log.info('Installing update now');
      setImmediate(() => this.auto.quitAndInstall(false, true));
    } else if (this.state.url) shell.openExternal(this.state.url);
  }
}

module.exports = { Updater, newer };
