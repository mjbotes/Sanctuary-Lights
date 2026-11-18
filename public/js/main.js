// Start-up.
// Importing every module wires up its buttons and keys.
import './core.js';
import './tabs.js';
import './render.js';
import './stage2d.js';
import './selection.js';
import './live.js';
import './program.js';
import './cues.js';
import './patch.js';
import './setup.js';
import './songs.js';
import './busk.js';
import './fx.js';
import './pads.js';
import './tracks.js';
import './tricks.js';
import './palette.js';
import './propresenter.js';
import './screens.js';
import './view3d.js';
import './access.js';
import './history.js';
import './simple.js';
import './safety.js';
import './updates.js';
import './lighting.js';
import './wizard.js';
import './testpanel.js';
import './parts.js';
import './help.js';
import './design.js';
import './plan.js';
import './schedule.js';
import './share.js';
import './mcp.js';
import './practice.js';
import './controller.js';
import './snapshot.js';
import { $, S, on } from './core.js';
import { startSession } from './access.js';
import { renderRuntime } from './live.js';
import { renderAll } from './render.js';
import { updateScreenWarn } from './screens.js';
import { renderLive } from './stage2d.js';
import { stage3d } from './view3d.js';

// Updates from the server -> redraw
on('state', () => {
  renderAll();
  if (stage3d) stage3d.setShow(S.show, S.profiles);
});
on('runtime', () => renderRuntime());
on('live', () => {
  renderLive();
  if (stage3d) stage3d.setLive(S.live.fixtures);
  updateScreenWarn();
});
import { pollDmx } from './setup.js';
import { startWebMidi } from './songs.js';
import { audio, becomeHost, lsGet } from './tracks.js';
import { place3d } from './view3d.js';

// ----- start ----------------------------------------------------------------
try {
  const t = localStorage.getItem('tab');
  if (t && $(`#tabs button[data-tab="${t}"]`)) $(`#tabs button[data-tab="${t}"]`).click();
} catch {}
startSession();
pollDmx();
place3d();
// Re-join as the audio computer after a reload
setTimeout(() => { if (lsGet('audioHost') === '1') becomeHost(true); }, 800);
try {
  if (localStorage.getItem('webMidi')) {
    $('#webMidi').checked = true;
    startWebMidi(true);
  }
} catch {}
