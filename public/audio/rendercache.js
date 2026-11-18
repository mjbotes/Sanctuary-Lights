// Keeps rendered key/tempo versions of stems on the server, so a song changed to a new key is not
// rendered again after the app restarts.
// File format: "SLR1", then channels, frames, sample rate (uint32 little-endian), then 16-bit samples,
// one channel after the other.
import { hashKey } from './timing.js';

const MAGIC = 0x31524c53; // "SLR1"

export function renderKey(file, semitones, tempo, formant) {
  return hashKey(`v1|${file}|${semitones}|${tempo.toFixed(5)}|${formant ? 1 : 0}`);
}

export function encode(channels, sampleRate) {
  const frames = channels[0].length;
  const out = new ArrayBuffer(16 + channels.length * frames * 2);
  const head = new DataView(out, 0, 16);
  head.setUint32(0, MAGIC, true);
  head.setUint32(4, channels.length, true);
  head.setUint32(8, frames, true);
  head.setUint32(12, sampleRate, true);
  const pcm = new Int16Array(out, 16);
  channels.forEach((d, c) => {
    const o = c * frames;
    for (let i = 0; i < frames; i++) {
      const v = Math.max(-1, Math.min(1, d[i]));
      pcm[o + i] = Math.round(v * 32767);
    }
  });
  return out;
}

export function decode(buf) {
  if (buf.byteLength < 16) return null;
  const head = new DataView(buf, 0, 16);
  if (head.getUint32(0, true) !== MAGIC) return null;
  const nch = head.getUint32(4, true), frames = head.getUint32(8, true), sampleRate = head.getUint32(12, true);
  if (buf.byteLength !== 16 + nch * frames * 2) return null;
  const pcm = new Int16Array(buf, 16);
  const channels = [];
  for (let c = 0; c < nch; c++) {
    const d = new Float32Array(frames);
    for (let i = 0; i < frames; i++) d[i] = pcm[c * frames + i] / 32767;
    channels.push(d);
  }
  return { channels, sampleRate };
}

// Load a cached render, or null.
export async function load(key) {
  try {
    const r = await fetch(`/assets/rendered/${key}.pcm`);
    if (!r.ok) return null;
    return decode(await r.arrayBuffer());
  } catch {
    return null;
  }
}

// Save in the background; failures only mean it is rendered again next time.
export function save(key, channels, sampleRate, headers = {}) {
  try {
    fetch(`/api/upload/render?key=${key}`, { method: 'POST', body: encode(channels, sampleRate), headers }).catch(() => {});
  } catch {}
}
