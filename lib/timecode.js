'use strict';
// MIDI Timecode (MTC) decoder: quarter-frame messages (0xF1) and full-frame SysEx.
// Ableton Live, Playback, QLab and video servers can send MTC; cues and song sections can follow it.
const { EventEmitter } = require('events');

const RATES = [24, 25, 29.97, 30];

class MtcDecoder extends EventEmitter {
  constructor() {
    super();
    this.parts = new Array(8).fill(0);
    this.seen = 0;
    this.lastAt = 0;
    this.stopTimer = null;
  }

  // One MIDI message (array of bytes). Returns true if it was timecode.
  feed(bytes) {
    const st = bytes[0];
    if (st === 0xf1 && bytes.length >= 2) {
      this.quarter(bytes[1]);
      return true;
    }
    // Full frame: F0 7F <dev> 01 01 hh mm ss ff F7 (sent when jumping / locating)
    if (st === 0xf0 && bytes[1] === 0x7f && bytes[3] === 0x01 && bytes[4] === 0x01 && bytes.length >= 9) {
      this.emitTime(bytes[5], bytes[6], bytes[7], bytes[8], false);
      return true;
    }
    return false;
  }

  quarter(data) {
    const type = (data >> 4) & 0x07;
    this.parts[type] = data & 0x0f;
    this.seen |= 1 << type;
    if (type === 7 && this.seen === 0xff) {
      const p = this.parts;
      const hh = p[6] | ((p[7] & 0x07) << 4); // includes rate bits 5-6
      this.emitTime(hh, p[4] | (p[5] << 4), p[2] | (p[3] << 4), p[0] | (p[1] << 4), true);
      this.seen = 0;
    }
  }

  // hh holds the frame rate in bits 5-6. Quarter frames describe the time 2 frames ago.
  emitTime(hhRaw, mm, ss, ff, running) {
    const fps = RATES[(hhRaw >> 5) & 0x03];
    const hh = hhRaw & 0x1f;
    const seconds = hh * 3600 + mm * 60 + ss + (ff + (running ? 2 : 0)) / fps;
    this.lastAt = Date.now();
    this.emit('time', { seconds, fps, running, text: format(seconds, fps) });
    // No quarter frames for half a second = stopped
    clearTimeout(this.stopTimer);
    if (running) {
      this.stopTimer = setTimeout(() => this.emit('stop'), 500);
      this.stopTimer.unref && this.stopTimer.unref();
    }
  }
}

function format(seconds, fps = 30) {
  const s = Math.max(0, seconds);
  const f = Math.floor((s % 1) * fps);
  const t = Math.floor(s);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(t / 3600))}:${p(Math.floor((t % 3600) / 60))}:${p(t % 60)}:${p(f)}`;
}

// "01:02:03:12" (or "1:02:03", "62.5") -> seconds
function parseTimecode(text, fps = 30) {
  const s = String(text || '').trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const parts = s.split(/[:;.]/).map(Number);
  if (parts.some((n) => !Number.isFinite(n)) || parts.length > 4) return null;
  // "mm:ss" or "hh:mm:ss" (no frames) or "hh:mm:ss:ff"
  const [h, m, sec, f] = parts.length === 4 ? parts : parts.length === 3 ? [...parts, 0] : [0, ...parts, 0];
  return h * 3600 + m * 60 + sec + f / fps;
}

module.exports = { MtcDecoder, format, parseTimecode, RATES };
