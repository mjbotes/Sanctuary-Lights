// Pictures of the stage for the AI assistant: when the server asks (see_stage), an app window
// renders the 3D view from a standard angle and sends it back. Only the desktop app window, or a
// screen that already uses the 3D view, answers (phones and iPads are left alone).
import { S, authHeaders, on } from './core.js';
import { get3d, stage3d } from './view3d.js';

const canAnswer = () => /[?&]app=1/.test(location.search) || !!stage3d;

on('snapshot', async (req) => {
  if (!req || !req.id || !canAnswer()) return;
  try {
    const s = get3d();
    if (!s) return; // no WebGL here
    // The 3D view needs a place on the page to render; use an off-screen box if it is not shown
    if (!s.canvas.isConnected) {
      let box = document.getElementById('snap3d');
      if (!box) {
        box = document.createElement('div');
        box.id = 'snap3d';
        Object.assign(box.style, { position: 'fixed', left: '-20000px', top: '0', width: '960px', height: '540px' });
        document.body.append(box);
      }
      s.attach(box, 'view');
    }
    if (S.show) s.setShow(S.show, S.profiles);
    if (S.live) s.setLive(S.live.fixtures);
    const url = s.snapshot(req.view || 'front');
    await fetch(`/api/snapshot?id=${encodeURIComponent(req.id)}`, { method: 'POST', body: url, headers: authHeaders() });
  } catch (e) {
    console.warn('Snapshot failed', e);
  }
});
