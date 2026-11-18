'use strict';
// MIDI input from the Mac's CoreMIDI ports: USB MIDI interfaces, the IAC Driver
// (for Ableton Live on the same Mac) and macOS Network MIDI sessions (for
// Playback on an iPad). Uses the optional native module @julusian/midi.
// If it is not installed, the browser's Web MIDI bridge can be used instead.
const { EventEmitter } = require('events');
const { MtcDecoder } = require('./timecode');

class MidiIn extends EventEmitter {
  constructor(log = console) {
    super();
    this.log = log;
    this.inputs = new Map(); // port name -> Input
    this.ports = [];
    this.filter = '';
    this.mtc = new MtcDecoder();
    this.mtc.on('time', (t) => this.emit('timecode', t));
    this.mtc.on('stop', () => this.emit('timecodeStop'));
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
    this.start();
  }

  // A hardware controller (Launchpad, APC…): its port is always open, and its messages go to the
  // controller ('controller' event), never to the song triggers.
  setControllerPort(name) {
    this.controllerPort = name || '';
    this.start();
  }

  start() {
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
      const wanted = new Set(names.filter((nm) => !this.filter || nm === this.filter || nm === this.controllerPort));
      for (const [name, input] of this.inputs) {
        if (!wanted.has(name) || changed) {
          input.closePort();
          this.inputs.delete(name);
        }
      }
      names.forEach((name, i) => {
        if (!wanted.has(name) || this.inputs.has(name)) return;
        const input = new this.lib.Input();
        input.ignoreTypes(false, false, true); // keep SysEx (timecode locate) and clock/MTC; ignore active sensing
        input.on('message', (_dt, msg) => this.handle(msg, name));
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

  // MIDI clock (24 ticks per beat) is turned into one 'beat' event per beat with the tempo,
  // so the 24-48 messages a second never reach the engine.
  handle(msg, name) {
    if (this.controllerPort && name === this.controllerPort) return void this.emit('controller', msg, name);
    const st = msg[0];
    if (st === 0xf8) return this.tick(name);
    if (st === 0xfa || st === 0xfb) {
      this.clock = { name, ticks: 0, times: [] };
      return;
    }
    if (st === 0xfc) {
      this.clock = null;
      this.emit('clockStop');
      return;
    }
    if (this.mtc.feed(msg)) return; // MIDI timecode
    if (st === 0xf0) return; // other SysEx: not used
    this.emit('message', msg, name);
  }

  tick(name) {
    const now = Date.now();
    if (!this.clock || this.clock.name !== name) this.clock = { name, ticks: 0, times: [] };
    const c = this.clock;
    c.times.push(now);
    if (c.times.length > 49) c.times.shift();
    if (c.ticks % 24 === 0 && c.times.length >= 25) {
      const span = (c.times.at(-1) - c.times[0]) / (c.times.length - 1);
      const bpm = 60000 / (span * 24);
      if (bpm >= 30 && bpm <= 300) this.emit('beat', Math.round(bpm * 10) / 10);
    }
    c.ticks++;
  }

  // ----- MIDI out (e.g. program change to SuperRack, Ableton or MainStage on song change)
  outPorts() {
    if (!this.lib) return [];
    try {
      if (!this.outProbe) this.outProbe = new this.lib.Output();
      const n = this.outProbe.getPortCount();
      return Array.from({ length: n }, (_, i) => this.outProbe.getPortName(i));
    } catch {
      return [];
    }
  }

  // Several outputs stay open (e.g. program changes to SuperRack and lights on a Launchpad)
  send(portName, bytes) {
    if (!this.lib || !portName) return false;
    this.outs = this.outs || new Map();
    try {
      let out = this.outs.get(portName);
      if (!out) {
        const i = this.outPorts().indexOf(portName);
        if (i < 0) throw new Error(`MIDI output "${portName}" not found`);
        out = new this.lib.Output();
        out.openPort(i);
        this.outs.set(portName, out);
      }
      out.sendMessage(bytes);
      return true;
    } catch (e) {
      if (this.lastOutError !== e.message) this.log.warn(`MIDI out: ${e.message}`);
      this.lastOutError = e.message;
      const out = this.outs.get(portName);
      if (out) try { out.closePort(); } catch {}
      this.outs.delete(portName);
      return false;
    }
  }

  status() {
    return { available: !!this.lib, ports: this.ports, outputs: this.outPorts(), open: [...this.inputs.keys()], error: this.error || null };
  }

  close() {
    clearInterval(this.timer);
    for (const input of this.inputs.values()) input.closePort();
    for (const out of (this.outs || new Map()).values()) try { out.closePort(); } catch {}
  }
}

module.exports = { MidiIn };
