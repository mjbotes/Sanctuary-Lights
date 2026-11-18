// Stage geometry shared by the server and the 3D view.
// Coordinates in metres: x left/right (stage left is negative), y height, z towards the audience (upstage is negative).
(function (root) {
  'use strict';
  const D2R = Math.PI / 180;
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
  const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
  const mul = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
  const len = (a) => Math.sqrt(dot(a, a));
  const norm = (a) => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };
  // Rotate v around unit axis k by angle a (Rodrigues)
  const rotate = (v, k, a) => {
    const c = Math.cos(a), s = Math.sin(a);
    return add(add(mul(v, c), mul(cross(k, v), s)), mul(k, dot(k, v) * (1 - c)));
  };
  const UP = { x: 0, y: 1, z: 0 };

  const STAGE = { w: 12, d: 6, h: 0.6 };
  function defaultPos(f, stage = STAGE) {
    return { x: (f.x - 0.5) * stage.w * 1.1, y: 6, z: -stage.d + f.y * (stage.d + 6) };
  }
  function defaultAim(f, pos, stage = STAGE) {
    if (pos.z > 0) return { x: pos.x * 0.6, y: stage.h + 1.5, z: -stage.d / 2 };
    return { x: pos.x, y: stage.h, z: pos.z };
  }
  function placement(f, stage) {
    const pos = f.pos3d || defaultPos(f, stage);
    const aim = f.aim || defaultAim(f, pos, stage);
    return { pos, aim };
  }

  // Beam direction. Moving heads turn away from their aim: pan 540 deg around vertical, tilt 270 deg.
  function beamDir(pos, aim, mover, pan = 0.5, tilt = 0.5) {
    let d0 = sub(aim, pos);
    if (len(d0) < 1e-6) d0 = { x: 0, y: -1, z: 0 };
    d0 = norm(d0);
    if (!mover) return d0;
    let right = cross(d0, UP);
    if (len(right) < 1e-6) right = { x: 1, y: 0, z: 0 };
    right = norm(right);
    const t = rotate(d0, right, (tilt - 0.5) * 270 * D2R);
    return norm(rotate(t, UP, (pan - 0.5) * 540 * D2R));
  }

  // Screen: { x, y, z (centre), w, h, rotY (deg, 0 = facing the audience), rotX (deg, tilt) }
  function screenFrame(s) {
    const ry = (s.rotY || 0) * D2R, rx = (s.rotX || 0) * D2R;
    let right = { x: Math.cos(ry), y: 0, z: -Math.sin(ry) };
    let normal = { x: Math.sin(ry), y: 0, z: Math.cos(ry) };
    let up = UP;
    if (rx) {
      up = rotate(up, right, rx);
      normal = rotate(normal, right, rx);
    }
    return { c: { x: s.x || 0, y: s.y || 0, z: s.z || 0 }, right, up, normal };
  }

  // Does a beam (cone with the given full angle in degrees) light up a screen?
  // Returns { hit, dist } where dist is how far the beam axis passes from the screen edge (negative = inside).
  function beamHitsScreen(pos, dir, beamDeg, s) {
    const fr = screenFrame(s);
    const denom = dot(dir, fr.normal);
    if (Math.abs(denom) < 1e-6) return { hit: false };
    const t = dot(sub(fr.c, pos), fr.normal) / denom;
    if (t <= 0.05) return { hit: false }; // screen is behind the light
    const p = add(pos, mul(dir, t));
    const local = sub(p, fr.c);
    const u = dot(local, fr.right), v = dot(local, fr.up);
    const r = Math.tan((beamDeg / 2) * D2R) * t / Math.max(0.2, Math.abs(denom)); // footprint radius on the screen
    const dx = Math.max(0, Math.abs(u) - s.w / 2), dy = Math.max(0, Math.abs(v) - s.h / 2);
    const out = Math.hypot(dx, dy);
    const inside = Math.abs(u) <= s.w / 2 && Math.abs(v) <= s.h / 2;
    return { hit: inside || out < r, dist: inside ? -1 : out - r, at: p };
  }

  // Unit direction from "turn" (around vertical, 0 = towards stage right... +x) and "tilt" (up/down) in degrees.
  function directionOf(turnDeg, tiltDeg) {
    const t = (turnDeg || 0) * D2R, e = (tiltDeg || 0) * D2R;
    return { x: Math.cos(e) * Math.cos(t), y: Math.sin(e), z: -Math.cos(e) * Math.sin(t) };
  }

  const api = { defaultPos, defaultAim, placement, beamDir, screenFrame, beamHitsScreen, directionOf, dot, sub, norm, STAGE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Geom = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
