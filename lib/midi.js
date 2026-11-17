'use strict';
// MIDI input from the Mac's CoreMIDI ports: USB MIDI interfaces, the IAC Driver
// (for Ableton Live on the same Mac) and macOS Network MIDI sessions (for
// Playback on an iPad). Uses the optional native module @julusian/midi.
// If it is not installed, the browser's Web MIDI bridge can be used instead.
const { EventEmitter } = require('events');

class MidiIn extends EventEmitter {
  constructor(log = console) {
    super();
    this.log = log;
    this.inputs = new Map(); // port name -> Input
    this.ports = [];
    this.filter = '';
    try {
      this.lib = require('@julusian/midi');
    } catch {
      this.lib = null;
      this.error = 'MIDI module not installed (run "npm install" once with internet access)';
      return;
    }
    try {
      this.probe = new this.lib.Input();
    } catch (e) {
      this.lib = null;
      this.error = `This computer's MIDI system could not be opened: ${e.message}`;
    }
  }

  configure(portFilter) {
    this.filter = portFilter || '';
    if (!this.lib) return;
    this.refresh();
    if (!this.timer) this.timer = setInterval(() => this.refresh(), 3000);
  }

  refresh() {
    try {
      const n = this.probe.getPortCount();
      const names = [];
      for (let i = 0; i < n; i++) names.push(this.probe.getPortName(i));
      const changed = names.join('\n') !== this.ports.join('\n');
      this.ports = names;
      const wanted = new Set(names.filter((nm) => !this.filter || nm === this.filter));
      for (const [name, input] of this.inputs) {
        if (!wanted.has(name) || changed) {
          input.closePort();
          this.inputs.delete(name);
        }
      }
      names.forEach((name, i) => {
        if (!wanted.has(name) || this.inputs.has(name)) return;
        const input = new this.lib.Input();
        input.ignoreTypes(true, true, true); // ignore sysex, clock, active sensing
        input.on('message', (_dt, msg) => this.emit('message', msg, name));
        input.openPort(i);
        this.inputs.set(name, input);
      });
      if (changed) this.emit('ports', this.status());
      this.error = null;
    } catch (e) {
      if (this.error !== e.message) this.log.warn(`MIDI: ${e.message}`);
      this.error = e.message;
    }
  }

  status() {
    return { available: !!this.lib, ports: this.ports, open: [...this.inputs.keys()], error: this.error || null };
  }

  close() {
    clearInterval(this.timer);
    for (const input of this.inputs.values()) input.closePort();
  }
}

module.exports = { MidiIn };
