'use strict';
// Desktop app: runs the lighting/tracks server inside the app and shows the controller in a window.
// iPads and phones can still connect to the address shown in Setup.
const { app, BrowserWindow, dialog, session, shell, Menu } = require('electron');
const path = require('path');

process.env.SL_EMBEDDED = '1';
if (!process.env.PORT) process.env.PORT = '8080';

// Keep audio and timers running at full speed when the window is in the background.
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
let server = null;

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
  win.loadURL(`http://localhost:${port}/?app=1`);
  // Links to other sites open in the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(`http://localhost:${port}`)) shell.openExternal(url);
    return { action: url.startsWith(`http://localhost:${port}`) ? 'allow' : 'deny' };
  });
}

app.whenReady().then(async () => {
  // Microphone/line inputs (vocals, auto-tune), MIDI and audio output selection are allowed for our own page only.
  const ours = (url) => /^http:\/\/localhost:\d+\//.test(url || '');
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
    cb(ours(wc.getURL()) && ['media', 'midi', 'midiSysex', 'speaker-selection', 'fullscreen'].includes(permission));
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission) => ours(wc && wc.getURL()) && ['media', 'midi', 'midiSysex', 'speaker-selection'].includes(permission));

  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { type: 'separator' }, { role: 'toggleDevTools' }] },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  try {
    server = require(path.join(__dirname, '..', 'server.js'));
    const { port } = await server.ready;
    createWindow(port);
  } catch (e) {
    dialog.showErrorBox('Sanctuary Lights could not start', String(e.message || e));
    app.quit();
  }
});

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});
app.on('activate', () => {
  if (!win && server) createWindow(process.env.PORT);
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  if (server && server.shutdown) server.shutdown();
});
