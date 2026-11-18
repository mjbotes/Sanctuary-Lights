// Musical timing for the tracks player: the bar/beat grid of a song (after tempo changes),
// the next bar line, and generated click / count-in audio.
// Times are in playback seconds (after a tempo change), unless the name says "orig".

// Grid of a song: beat length, beats per bar, first downbeat.
export function grid(song) {
  const bpm = (song && (song.targetBpm || song.bpm)) || 120;
  const tempo = song && song.targetBpm && song.bpm ? song.targetBpm / song.bpm : 1;
  return {
    bpm,
    beat: 60 / bpm,
    bpb: Math.max(1, Math.min(12, (song && song.beatsPerBar) || 4)),
    downbeat: ((song && song.downbeat) || 0) / tempo,
  };
}

export const barLength = (g) => g.beat * g.bpb;

// The first bar line after `pos` (at least `min` seconds away, so a jump can be scheduled cleanly).
export function nextBar(pos, g, min = 0.05) {
  const bar = barLength(g);
  const n = Math.floor((pos + min - g.downbeat) / bar) + 1;
  return g.downbeat + Math.max(0, n) * bar;
}

// Beat number at `pos` (0 = first downbeat); fractional.
export const beatAt = (pos, g) => (pos - g.downbeat) / g.beat;

// Nearest beat to `pos` (for snapping markers).
export function snapToBeat(pos, g) {
  return Math.max(0, g.downbeat + Math.round((pos - g.downbeat) / g.beat) * g.beat);
}

// One click sound: short sine burst; the first beat of the bar is higher.
function addClick(out, at, sr, accent) {
  const f = accent ? 1760 : 1100;
  const len = Math.floor(sr * 0.035);
  const start = Math.round(at * sr);
  for (let i = 0; i < len && start + i < out.length; i++) {
    if (start + i < 0) continue;
    const env = Math.exp(-i / (sr * 0.008));
    out[start + i] += (accent ? 0.9 : 0.6) * env * Math.sin((2 * Math.PI * f * i) / sr);
  }
}

// A click track for `seconds` of the song (mono). Starts at the first downbeat (and counts back before it).
export function clickTrack(sr, seconds, g) {
  const out = new Float32Array(Math.ceil(sr * seconds));
  const first = g.downbeat - Math.floor(g.downbeat / g.beat) * g.beat; // earliest beat in the song
  let n = Math.round((first - g.downbeat) / g.beat);
  for (let t = first; t < seconds; t += g.beat, n++) addClick(out, t, sr, ((n % g.bpb) + g.bpb) % g.bpb === 0);
  return out;
}

// Count-in: `bars` bars of click, ending exactly when the music starts.
export function countIn(sr, g, bars) {
  const beats = Math.max(1, bars) * g.bpb;
  const out = new Float32Array(Math.ceil(sr * beats * g.beat));
  for (let i = 0; i < beats; i++) addClick(out, i * g.beat, sr, i % g.bpb === 0);
  return { data: out, seconds: beats * g.beat };
}

// Small, fast hash for cache keys (FNV-1a, 64-bit as two 32-bit halves) -> 16 hex chars.
export function hashKey(text) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x811c9dc5) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}
