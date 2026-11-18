// Redraw everything after the show changed.
import { renderBusk } from './busk.js';
import { $, S } from './core.js';
import { renderCueTable, renderSceneTable } from './cues.js';
import { renderFx } from './fx.js';
import { renderRuntime, renderScenes } from './live.js';
import { renderPads } from './pads.js';
import { renderPatch, renderProfiles } from './patch.js';
import { renderControls } from './program.js';
import { renderScreens } from './screens.js';
import { renderGroups } from './selection.js';
import { renderSettings } from './setup.js';
import { renderLooks, renderSongs } from './songs.js';
import { renderLive, renderStages } from './stage2d.js';
import { renderTracks } from './tracks.js';
import { renderSetup3d } from './view3d.js';

// ----- render: everything -----------------------------------------------
function renderAll() {
  if (!S.show) return;
  $('#showName').textContent = S.show.name || 'Sanctuary Lights';
  document.title = `${S.show.name || 'Sanctuary'} · Lights`;
  renderStages();
  renderGroups();
  renderScenes();
  renderCueTable();
  renderSceneTable();
  renderPatch();
  renderProfiles();
  renderSettings();
  renderSongs();
  renderLooks();
  renderBusk();
  renderPads();
  renderFx();
  renderTracks();
  renderSetup3d();
  renderScreens();
  renderRuntime();
  renderControls();
  renderLive();
}

export { renderAll };
