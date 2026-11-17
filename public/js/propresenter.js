// ProPresenter status, slide images and screen colour.
import { $, S, act, h, toast } from './core.js';
import { audio, isHost, lsGet } from './tracks.js';
import { stage3d } from './view3d.js';

// ----- ProPresenter ---------------------------------------------------------------
function renderPpStatus() {
  const el = $('#ppStatus');
  if (!el || !S.show) return;
  const pp = S.show.settings.pp || {};
  const c = S.ppConn;
  const live = S.runtime.pp;
  if (!pp.enabled) { el.textContent = 'Off.'; return; }
  el.replaceChildren(
    c && c.connected ? h('span', { style: { color: 'var(--go-hi)' } }, '● Connected') : h('span', { style: { color: '#ff8a80' } }, `● Not connected${c && c.error ? `: ${c.error}` : ''}`),
    live && live.presentation ? ` · ${live.presentation.name}${live.group ? ` · ${live.group}` : ''}${live.result ? ` → ${live.result}` : ''}` : '',
    live && live.presentation ? h('button', { type: 'button', className: 'btn small', style: { marginLeft: '8px' }, title: 'Make a song with this name and one section per group', onclick: () => act('pp.importSong').then((r) => r && toast(`Song "${live.presentation.name}" ready. Pick looks for its sections on the Songs tab.`)) }, 'Make song from this presentation') : null);
}

// The live slide image: shown on the 3D screens, and (if chosen) its colour is sent to the lights.
// Only the desktop app window or the audio computer does the colour maths, so it happens once.
const isColorWorker = () => /[?&]app=1/.test(location.search) || isHost() || lsGet('ppColorWorker') === '1';
let lastSlideKey = '';
function ppSlideChanged() {
  const live = S.runtime.pp;
  const pp = S.show && S.show.settings.pp;
  if (!live || !live.presentation || !live.presentation.uuid || !pp || !pp.enabled) {
    if (stage3d) stage3d.setSlide(null);
    return;
  }
  const key = `${live.presentation.uuid}|${live.index}`;
  if (key === lastSlideKey) return;
  lastSlideKey = key;
  const url = `/api/pp/thumb?uuid=${encodeURIComponent(live.presentation.uuid)}&index=${live.index}&q=480`;
  if (stage3d) stage3d.setSlide(url);
  if (pp.colorMode === 'slide' && isColorWorker()) slideColor(url).then((rgb) => rgb && act('pp.color', { rgb, key })).catch(() => {});
}
// Strong colours count more than greys, black and white (text on a dark background stays out of it).
function slideColor(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = 48; c.height = 27;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0, 48, 27);
      const d = g.getImageData(0, 0, 48, 27).data;
      let r = 0, gr = 0, b = 0, wsum = 0;
      for (let i = 0; i < d.length; i += 4) {
        const R = d[i] / 255, G = d[i + 1] / 255, B = d[i + 2] / 255;
        const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
        const sat = mx ? (mx - mn) / mx : 0;
        const w = sat * sat * mx + 0.002;
        r += R * w; gr += G * w; b += B * w; wsum += w;
      }
      let rgb = [r / wsum, gr / wsum, b / wsum];
      const mx = Math.max(...rgb);
      const mn = Math.min(...rgb);
      if (mx < 0.08 || (mx - mn) / mx < 0.12) return resolve([1, 1, 1]); // no real colour on screen: open white
      rgb = rgb.map((v) => v / mx); // full brightness, keep the hue
      resolve(rgb.map((v) => Math.round(v * 1000) / 1000));
    };
    img.onerror = reject;
    img.src = url;
  });
}

// Show the current slide again (e.g. after the 3D view was created)
function resetSlide() {
  lastSlideKey = '';
  ppSlideChanged();
}

export { resetSlide, renderPpStatus, isColorWorker, lastSlideKey, ppSlideChanged, slideColor };
