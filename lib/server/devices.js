'use strict';
// Everything outside the computer: DMX output (Art-Net / sACN / USB), MIDI, OSC and ProPresenter.
// Inputs turn into engine actions through app.input(action).
const { Output } = require('../output');
const { MidiIn } = require('../midi');
const { ProPresenter } = require('../propresenter');
const { OscIn } = require('../osc');
const { DmxInput } = require('../dmxinput');
const { Controller } = require('../controller');

class Devices {
  constructor(app, log = console) {
    this.app = app;
    this.log = log;
    this.output = new Output(log);
    this.midi = new MidiIn(log);
    this.pp = new ProPresenter(log);
    this.osc = new OscIn(log);
    this.input = new DmxInput(log);
    this.lastUniverses = new Map();
    this.loopTimer = null;
    this.fps = 0;

    const input = (label, action) => {
      try {
        app.input(action);
      } catch (e) {
        log.warn(`${label}: ${e.message}`);
      }
    };
    this.midi.on('message', (data) => input('MIDI', { type: 'midi.message', data }));
    this.midi.on('beat', (bpm) => input('MIDI clock', { type: 'tempo.beat', bpm }));
    this.midi.on('clockStop', () => input('MIDI clock', { type: 'tempo.clockStop' }));
    this.midi.on('timecode', (t) => input('Timecode', { type: 'tc.update', seconds: t.seconds, fps: t.fps }));
    this.midi.on('timecodeStop', () => input('Timecode', { type: 'tc.stop' }));
    this.midi.on('ports', () => app.pushState());
    // Hardware controller (Launchpad, APC…) on its own MIDI port
    this.controller = new Controller(app, this.midi);
    this.midi.on('controller', (msg) => this.controller.message(msg));
    this.pp.on('slide', (slide) => input('ProPresenter', { type: 'pp.slide', ...slide }));
    this.pp.on('video', (v) => input('ProPresenter', { type: 'pp.video', ...v }));
    this.pp.on('status', () => app.pushState());
    this.osc.on('message', (m) => input('OSC', { type: 'osc.message', address: m.address, args: m.args }));
    this.osc.on('status', () => app.pushState());
    this.output.usb.onStatus = () => app.pushState(); // USB-DMX plugged in / unplugged
  }

  // Apply settings (called at start and whenever the show changes)
  configure(settings) {
    this.output.configure(settings);
    if (settings.midiInput !== this.midiInput) {
      this.midiInput = settings.midiInput;
      this.midi.configure(settings.midiInput);
    }
    this.pp.configure(settings.pp || {});
    this.controller.configure(settings.controller || {});
    const o = settings.osc || {};
    this.osc.configure(o.enabled !== false, o.port || 8000);
    const inp = settings.input || {};
    const patched = [...new Set(this.app.engine.show.fixtures.map((f) => f.universe))];
    this.input.configure({ ...inp, artnetBase: settings.artnetBase, ownCid: settings.cid, universes: patched.length ? patched : [1] });
    if (settings.fps !== this.fps) this.startLoop(settings.fps);
  }

  // The DMX loop: compute the look, render DMX and send it, `fps` times a second.
  startLoop(fps) {
    this.fps = fps;
    clearInterval(this.loopTimer);
    this.loopTimer = setInterval(() => {
      try {
        this.app.latestLook = this.app.engine.computeLook();
        // Practice mode: the real lights keep what they had when practice started
        if (this.app.engine.rt.practice) {
          if (!this.frozen) this.frozen = this.lastUniverses || new Map();
          this.output.send(this.frozen);
          return;
        }
        this.frozen = null;
        this.lastUniverses = this.input.apply(this.app.engine.render(this.app.latestLook));
        this.output.send(this.lastUniverses);
      } catch (e) {
        this.app.reportError('DMX loop', e);
      }
    }, Math.round(1000 / fps));
  }

  // Program change to other software (SuperRack, Ableton, MainStage...) when the song changes.
  sendSongMidi(song, port) {
    if (!song || !song.midiOut || !port) return;
    this.midi.send(port, [0xc0 | ((song.midiOut.ch || 1) - 1), song.midiOut.pc & 0x7f]);
  }

  status() {
    return { outputError: this.output.lastError, usb: this.output.usb.status, dmxIn: this.input.status(), midi: this.midi.status(), pp: this.pp.state, osc: this.osc.status() };
  }

  close() {
    clearInterval(this.loopTimer);
    this.output.close();
    this.controller.close();
    this.midi.close();
    this.pp.close();
    this.osc.close();
    this.input.close();
  }
}

module.exports = { Devices };
