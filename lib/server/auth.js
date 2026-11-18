'use strict';
// Access control with three PIN levels:
//   admin     - everything (patch, settings, PINs)
//   operator  - run and program the show (no patch, settings or PINs)
//   volunteer - run the show only: GO, sections, scenes, pads, blackout, tracks transport
// With no admin PIN set, everyone is admin (as before). The computer running the app can
// always be admin (setting "localAdmin", on by default).
const crypto = require('crypto');

const ROLES = ['volunteer', 'operator', 'admin'];
const rank = (r) => ROLES.indexOf(r);

const VOLUNTEER = new Set([
  'cue.go', 'cue.back', 'cue.goto', 'cue.release', 'section.go', 'song.select', 'scene.toggle', 'scene.level', 'scene.releaseAll',
  'pad.press', 'blackout.set', 'strobe.hold', 'flash.all', 'tempo.tap', 'transport', 'hold.set', 'busk.release', 'panic',
  'gm.set', 'look.apply',
]);
// Changes to the rig and the system: admin only
// …except these, which change nothing in the show (blinking a light on the test page)
const OPERATOR_EXCEPT = new Set(['fixture.identify']);
const ADMIN_PREFIX = ['fixture.', 'profile.', 'stage3d.', 'mvr.', 'settings.', 'show.', 'access.', 'snapshot.restore', 'update.'];

function requiredRole(type) {
  if (VOLUNTEER.has(type)) return 'volunteer';
  if (OPERATOR_EXCEPT.has(type)) return 'operator';
  // Reports from the audio computer and inputs are machine-to-machine, but still need operator rights
  if (ADMIN_PREFIX.some((p) => type.startsWith(p))) return 'admin';
  return 'operator';
}

const hashPin = (pin, salt) => crypto.createHash('sha256').update(`${salt}:${pin}`).digest('hex');

class Auth {
  constructor() {
    this.sessions = new Map(); // token -> { role, at }
  }

  // access settings stored in the show: { enabled, localAdmin, salt, pins: { admin, operator, volunteer } (hashes) }
  setConfig(access) {
    this.access = access || {};
  }

  get enabled() {
    return !!(this.access && this.access.pins && this.access.pins.admin);
  }

  isLocal(req) {
    const a = (req.socket && req.socket.remoteAddress) || '';
    return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
  }

  // Role of a request: from its token, or admin when access control is off / it comes from this computer.
  roleOf(req, token) {
    if (!this.enabled) return 'admin';
    if (this.access.localAdmin !== false && this.isLocal(req)) return 'admin';
    const s = token && this.sessions.get(token);
    return s ? s.role : null;
  }

  login(pin) {
    if (!this.enabled) return { token: null, role: 'admin' };
    const salt = this.access.salt || '';
    for (const role of [...ROLES].reverse()) {
      const h = this.access.pins[role];
      if (h && h === hashPin(String(pin), salt)) {
        const token = crypto.randomBytes(18).toString('hex');
        this.sessions.set(token, { role, at: Date.now() });
        return { token, role };
      }
    }
    return null;
  }

  logout(token) {
    this.sessions.delete(token);
  }

  allowed(role, type) {
    return !!role && rank(role) >= rank(requiredRole(type));
  }
}

// New access settings from PINs typed by an admin (empty = remove that level).
function makeAccess(current, { admin, operator, volunteer, localAdmin }) {
  const cur = current || {};
  const salt = cur.salt || crypto.randomBytes(8).toString('hex');
  const pins = { ...(cur.pins || {}) };
  const set = (role, pin) => {
    if (pin === undefined) return;
    if (pin === '' || pin === null) delete pins[role];
    else {
      if (!/^\d{4,8}$/.test(String(pin))) throw new Error('PINs are 4 to 8 digits');
      pins[role] = hashPin(String(pin), salt);
    }
  };
  set('admin', admin);
  set('operator', operator);
  set('volunteer', volunteer);
  if (!pins.admin && (pins.operator || pins.volunteer)) throw new Error('Set an admin PIN first');
  return { salt, pins, localAdmin: localAdmin === undefined ? cur.localAdmin !== false : !!localAdmin };
}

module.exports = { Auth, makeAccess, requiredRole, ROLES, hashPin };
