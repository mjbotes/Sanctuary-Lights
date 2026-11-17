'use strict';
// Undo / redo for changes to the saved show (not for live playback such as GO or faders).
// Each step stores the show as it was before the change, as JSON text.

const LABELS = {
  'cue.record': 'Record cue', 'cue.update': 'Update cue', 'cue.edit': 'Edit cue', 'cue.delete': 'Delete cue', 'cue.move': 'Move cue',
  'scene.record': 'Save scene', 'scene.update': 'Update scene', 'scene.edit': 'Edit scene', 'scene.delete': 'Delete scene', 'scene.move': 'Move scene',
  'look.record': 'Record look', 'look.update': 'Update look', 'look.edit': 'Rename look', 'look.delete': 'Delete look',
  'song.add': 'Add song', 'song.edit': 'Edit song', 'song.delete': 'Delete song', 'song.move': 'Move song',
  'section.add': 'Add section', 'section.edit': 'Edit section', 'section.delete': 'Delete section', 'section.move': 'Move section',
  'song.audio': 'Change key/tempo', 'stem.add': 'Add track', 'stem.edit': 'Change track', 'stem.delete': 'Remove track', 'marker.set': 'Set marker',
  'preset.record': 'Record preset', 'preset.edit': 'Rename preset', 'preset.delete': 'Delete preset', 'preset.move': 'Move preset',
  'effect.save': 'Edit effect', 'effect.delete': 'Delete effect',
  'pad.save': 'Edit pad', 'pad.delete': 'Delete pad', 'pad.move': 'Move pad',
  'fixture.add': 'Add lights', 'fixture.edit': 'Edit light', 'fixture.delete': 'Remove light',
  'profile.save': 'Save fixture type', 'profile.delete': 'Delete fixture type', 'profile.import': 'Import fixture types',
  'group.save': 'Save group', 'group.delete': 'Delete group',
  'stage3d.set': 'Change 3D stage', 'mvr.apply': 'Import MVR', 'settings.update': 'Change settings',
  'show.load': 'Load show', 'show.new': 'New show', 'palette.set': 'Change colours', 'palette.reset': 'Reset colours',
  'pp.importSong': 'Make song from ProPresenter', 'vocal.saveToSong': 'Save vocal settings',
  'snapshot.restore': 'Restore snapshot',
};
const labelFor = (type) => LABELS[type] || type;

class History {
  constructor(limit = 100) {
    this.limit = limit;
    this.undoStack = []; // { label, json, key, at }
    this.redoStack = [];
  }

  // Call after a change. `before` is the show JSON before it. Quick repeats of the same edit
  // (dragging a fader, typing) are merged into one step.
  record(type, key, before) {
    const last = this.undoStack[this.undoStack.length - 1];
    const now = Date.now();
    if (last && last.key === key && now - last.at < 2000) {
      last.at = now;
    } else {
      this.undoStack.push({ label: labelFor(type), json: before, key, at: now });
      if (this.undoStack.length > this.limit) this.undoStack.shift();
    }
    this.redoStack = [];
  }

  // Returns the show JSON to go back to, or null. `current` is the show JSON now.
  undo(current) {
    const step = this.undoStack.pop();
    if (!step) return null;
    this.redoStack.push({ label: step.label, json: current, key: null, at: 0 });
    return step;
  }

  redo(current) {
    const step = this.redoStack.pop();
    if (!step) return null;
    this.undoStack.push({ label: step.label, json: current, key: null, at: 0 });
    return step;
  }

  status() {
    const u = this.undoStack[this.undoStack.length - 1];
    const r = this.redoStack[this.redoStack.length - 1];
    return { undo: u ? u.label : null, redo: r ? r.label : null, depth: this.undoStack.length };
  }
}

module.exports = { History, labelFor };
