'use strict';
// Desktop app: starts the engine (supervised: restarted if it ever stops), shows the controller,
// keeps the Mac from napping during a service, and handles updates.
// iPads and phones can still connect to the address shown in Setup.
const { app, BrowserWindow, dialog, session, shell, Menu, powerSaveBlocker } = require('electron');
const fs = require('fs');
const path = require('path');
const { ServerSupervisor } = require('./supervisor');
const { Updater } = require('./updater');

const PORT = Number(process.env.PORT) || 8080;

// Keep audio and timers running at full speed when the window is in the background.
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (!app.requestSingleInstanceLock()) app.quit();

// ----- log file (Help > Show log files) ---------------------------------------------
let logFile = null;
const write = (level, msg) => {
  try {
    if (!logFile) {
      fs.mkdirSync(app.getPath('logs'), { recursive: true });
      logFile = path.join(app.getPath('logs'), 'app.log');
      if (fs.existsSync(logFile) && fs.statSync(logFile).size > 2e6) fs.renameSync(logFile, `${logFile}.1`);
    }
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${level} ${msg}\n`);
  } catch {}
};
const log = { info: (m) => write('INFO', m), warn: (m) => write('WARN', m), error: (m) => write('ERROR', m) };
process.on('uncaughtException', (e) => log.error(`Main process: ${e.stack || e}`));

let win = null;
let supervisor = null;
let updater = null;
let quitting = false;

function createWindow(port) {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0d0f14',
    title: 'Sanctuary Lights',
    webPreferences: { backgroundThrottling: false, contextIsolation: true, sandbox: true },
  });
  const url = `http://localhost:${port}/?app=1`;
  win.loadURL(url);
  // Links to other sites open in the normal browser.
  win.webContents.setWindowOpenHandler(({ url: u }) => {
    if (!u.startsWith(`http://localhost:${port}`)) shell.openExternal(u);
    return { action: u.startsWith(`http://localhost:${port}`) ? 'allow' : 'deny' };
  });
  // Crash recovery for the screen itself
  win.webContents.on('render-process-gone', (_e, details) => {
    log.error(`Window stopped (${details.reason}); reloading`);
    setTimeout(() => win && !win.isDestroyed() && win.loadURL(url), 500);
  });
  win.on('unresponsive', () => {
    log.warn('Window not responding; reloading in 5 s');
    setTimeout(() => win && !win.isDestroyed() && win.reload(), 5000);
  });
  win.webContents.on('did-fail-load', () => setTimeout(() => win && !win.isDestroyed() && win.loadURL(url), 1000));
  win.on('closed', () => (win = null));
}

function buildMenu() {
  const openAtLogin = app.getLoginItemSettings().openAtLogin;
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { type: 'separator' }, { role: 'toggleDevTools' }] },
    {
      label: 'Options',
      submenu: [
        { label: 'Open at login', type: 'checkbox', checked: openAtLogin, click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }) },
        { label: 'Check for updates', click: () => updater && updater.check() },
      ],
    },
    { role: 'windowMenu' },
    { label: 'Help', submenu: [{ label: 'Show log files', click: () => shell.openPath(app.getPath('logs')) }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  // Microphone/line inputs (vocals, auto-tune), MIDI and audio output selection are allowed for our own page only.
  const ours = (u) => /^http:\/\/localhost:\d+\//.test(u || '');
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
    cb(ours(wc.getURL()) && ['media', 'midi', 'midiSysex', 'speaker-selection', 'fullscreen'].includes(permission));
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission) => ours(wc && wc.getURL()) && ['media', 'midi', 'midiSysex', 'speaker-selection'].includes(permission));

  // Stop macOS App Nap / Windows sleep from slowing the lighting loop
  powerSaveBlocker.start('prevent-app-suspension');
  buildMenu();

  supervisor = new ServerSupervisor({ port: PORT, log });
  try {
    const port = await supervisor.start();
    createWindow(port);
  } catch (e) {
    dialog.showErrorBox('Sanctuary Lights could not start', String(e.message || e));
    app.quit();
    return;
  }
  supervisor.on('crashed', () => log.warn('Engine restarting after a crash'));
  supervisor.on('restarted', () => updater && supervisor.send({ update: updater.state }));
  // Messages from the engine: buttons on the Setup page
  supervisor.on('message', (msg) => {
    if (msg && msg.installUpdate && updater) updater.install();
    if (msg && msg.checkUpdates && updater) updater.check();
  });

  const pkg = require('../package.json');
  const pub = (pkg.build && pkg.build.publish && pkg.build.publish[0]) || null;
  updater = new Updater({ log, repo: pub && { owner: pub.owner, repo: pub.repo }, report: (state) => supervisor.send({ update: state }) });
  updater.start();
});

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});
app.on('activate', () => {
  if (!win && supervisor) createWindow(PORT);
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', (e) => {
  if (quitting || !supervisor) return;
  e.preventDefault();
  quitting = true;
  supervisor.stop().finally(() => app.quit());
});
