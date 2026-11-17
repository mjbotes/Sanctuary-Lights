// Update banner and the Updates section in Setup (desktop app only).
import { $, S, act, h, on, toast } from './core.js';

const TEXT = {
  checking: 'Checking for updates…',
  current: 'Up to date.',
  downloading: (u) => `Downloading version ${u.version}${u.percent ? ` (${u.percent}%)` : ''}…`,
  ready: (u) => `Version ${u.version} is ready. It installs when you quit the app, or restart now.`,
  manual: (u) => `Version ${u.version} is available.`,
  error: (u) => u.error || 'Could not check for updates.',
};
const say = (u) => {
  const t = TEXT[u.status];
  return typeof t === 'function' ? t(u) : t || '';
};

function render() {
  const u = S.update;
  const banner = $('#updateBanner');
  const box = $('#updateBox');
  const admin = S.role === 'admin';
  const showBanner = u && (u.status === 'ready' || u.status === 'manual') && admin;
  banner.hidden = !showBanner;
  if (showBanner) {
    banner.replaceChildren(
      h('span', {}, say(u)),
      u.status === 'ready'
        ? h('button', { className: 'btn small primary', onclick: () => confirm('Restart now to install the update? The lights hold their last state for a few seconds.') && act('update.install') }, 'Restart now')
        : h('button', { className: 'btn small primary', onclick: () => act('update.install') }, 'Download'),
      h('button', { className: 'btn small', onclick: () => (banner.hidden = true) }, 'Later'));
  }
  if (!box) return;
  box.replaceChildren(
    h('p', { className: 'hint' }, `This is version ${S.version || '?'}. `, u ? say(u) : 'Updates are checked automatically in the installed desktop app.'),
    u ? h('div', { className: 'row wrap' },
      h('button', { className: 'btn small', disabled: !admin, onclick: () => act('update.check').then((r) => r && toast('Checking for updates…')) }, 'Check now'),
      u.status === 'ready' || u.status === 'manual' ? h('button', { className: 'btn small primary', disabled: !admin, onclick: () => act('update.install') }, u.status === 'ready' ? 'Restart and install' : 'Download') : null) : null);
}

on('state', render);

export { render as renderUpdates };
