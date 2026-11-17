'use strict';
// Actions – OSC commands and OSC learn. Each action runs with `this` = the engine; return { show: true } when the saved show changed.
const FX = require('../../../public/fxmath');
const { clamp01, nameKey, baseKey, isHex, palIndex } = require('../util');
const { PAL_NAMES } = require('../defaults');

module.exports = {

  // ----- OSC ----------------------------------------------------------------------------
  'osc.message'(a) {
    const address = String(a.address || '');
    const args = Array.isArray(a.args) ? a.args : [];
    const first = args[0];
    const press = args.length === 0 || !(first === 0 || first === false || first === '0' || first === 0.0);
    const lower = address.toLowerCase();
    this.rt.lastOsc = { address, args: args.slice(0, 4), at: Date.now(), result: '' };
    const res = (t, show = false) => { this.rt.lastOsc.result = t; return { show }; };
    const named = (list, x) => {
      if (typeof x === 'number' || /^\d+$/.test(String(x ?? ''))) return list[Number(x) - 1];
      return list.find((o) => nameKey(o.name) === nameKey(x)) || list.find((o) => baseKey(o.name) === baseKey(x));
    };
    const fwd = (type, payload) => { this.actions[type].call(this, payload); };

    // Learn: the next OSC message becomes the trigger
    if (this.rt.learn) {
      if (!press) return { runtime: false };
      const L = this.rt.learn;
      this.rt.learn = null;
      const song = this.song(L.songId);
      const target = L.sectionId ? song && song.sections.find((x) => x.id === L.sectionId) : song;
      if (!target) return res('learn target is gone');
      target.trigger = { t: 'osc', a: address, ...(typeof first === 'string' ? { v: first } : {}) };
      return res(`learned for ${target.name}`, true);
    }
    // Learned song / section triggers
    const same = (tr) => tr && tr.t === 'osc' && tr.a.toLowerCase() === lower && (tr.v === undefined || tr.v === first);
    const trigSong = this.show.songs.find((x) => same(x.trigger));
    let hit = null;
    const cur = this.song(this.rt.songId);
    if (cur) { const sec = cur.sections.find((x) => same(x.trigger)); if (sec) hit = [cur, sec]; }
    if (!hit) for (const sg of this.show.songs) { const sec = sg.sections.find((x) => same(x.trigger)); if (sec) { hit = [sg, sec]; break; } }
    if (trigSong || hit) {
      if (!press) return { runtime: false };
      if (trigSong && trigSong.id !== this.rt.songId) fwd('song.select', { id: trigSong.id });
      if (!hit) return res(`song: ${trigSong.name}`);
      if (this.rt.mode === 'manual') return res(`${hit[1].name} (ignored: Manual mode)`);
      if (this.rt.hold) return res(`${hit[1].name} (ignored: Hold is on)`);
      this.goSection(hit[0], hit[1]);
      return res(`${hit[0].name} · ${hit[1].name}`);
    }

    // Built-in addresses: /sl/...
    const parts = address.split('/').filter(Boolean);
    if (!parts.length || parts[0].toLowerCase() !== 'sl') return res('no match');
    const cmd = (parts[1] || '').toLowerCase();
    const val = (d = 1) => (typeof first === 'number' ? first : typeof first === 'boolean' ? (first ? 1 : 0) : first === undefined ? d : Number(first));
    const sectionGo = (sec, song) => {
      if (this.rt.mode === 'auto' && !this.rt.hold) { /* OSC acts like the tracks: allowed in auto */ }
      this.goSection(song, sec);
      return res(`${song.name} · ${sec.name}`);
    };
    switch (cmd) {
      case 'go': if (!press) return { runtime: false }; fwd('cue.go', {}); return res('GO');
      case 'back': if (!press) return { runtime: false }; fwd('cue.back', {}); return res('Back');
      case 'cue': { const c = named(this.show.cues, parts[2] ?? first); if (!c) return res('no such cue'); fwd('cue.goto', { id: c.id }); return res(`cue ${c.name}`); }
      case 'next': case 'prev': {
        if (!press) return { runtime: false };
        if (!cur) return res('no song picked');
        if (this.rt.mode === 'manual' && a.strict) return res('Manual mode');
        const i = cur.sections.findIndex((x) => x.id === this.rt.sectionId);
        const sec = cur.sections[cmd === 'next' ? i + 1 : Math.max(0, i - 1)];
        return sec ? sectionGo(sec, cur) : res('end of song');
      }
      case 'section': {
        if (!press && parts.length < 3) return { runtime: false };
        if (!cur) return res('no song picked');
        const sec = named(cur.sections, parts[2] ?? first);
        if (!sec) return res('no such section');
        if (this.rt.mode === 'manual') return res(`${sec.name} (ignored: Manual mode)`);
        if (this.rt.hold) return res(`${sec.name} (ignored: Hold is on)`);
        return sectionGo(sec, cur);
      }
      case 'song': { const sg = named(this.show.songs, parts[2] ?? first); if (!sg) return res('no such song'); fwd('song.select', { id: sg.id }); return res(`song ${sg.name}`); }
      case 'look': { const l = named(this.show.looks, parts[2] ?? first); if (!l) return res('no such look'); fwd('look.apply', { id: l.id }); return res(`look ${l.name}`); }
      case 'scene': {
        const sc = named(this.show.scenes, parts[2] ?? first);
        if (!sc) return res('no such scene');
        const lvl = parts[2] !== undefined ? val(1) : args.length > 1 ? Number(args[1]) : null;
        if (lvl === null || Number.isNaN(lvl)) fwd('scene.toggle', { id: sc.id });
        else fwd('scene.level', { id: sc.id, level: clamp01(lvl) });
        return res(`scene ${sc.name}`);
      }
      case 'pad': {
        const key = parts[2] ?? first;
        const pad = this.show.pads.find((p) => p.key && p.key === String(key).toLowerCase()) || named(this.show.pads, key);
        if (!pad) return res('no such pad');
        const down = parts[2] !== undefined ? press : args.length > 1 ? !(args[1] === 0 || args[1] === false) : true;
        fwd('pad.press', { id: pad.id, down });
        if (pad.mode === 'toggle' && parts[2] === undefined && args.length <= 1) fwd('pad.press', { id: pad.id, down: false });
        return res(`pad ${pad.name}`);
      }
      case 'gm': case 'master': fwd('gm.set', { value: clamp01(val(1)) }); return res(`master ${Math.round(clamp01(val(1)) * 100)}%`);
      case 'blackout': fwd('blackout.set', { on: args.length ? press : !this.rt.blackout }); return res('blackout');
      case 'strobe': fwd('strobe.hold', { on: press }); return res(press ? 'strobe on' : 'strobe off');
      case 'flash': fwd('flash.all', { on: press }); return res(press ? 'flash on' : 'flash off');
      case 'tap': if (!press) return { runtime: false }; fwd('tempo.tap', {}); return res('tap');
      case 'bpm': fwd('tempo.set', { bpm: val(120) }); return res(`${val(120)} BPM`);
      case 'mode': { const m = String(parts[2] ?? first).toLowerCase(); fwd('mode.set', { mode: m }); return res(`mode ${m}`); }
      case 'hold': fwd('hold.set', { on: press }); return res(press ? 'hold' : 'resume');
      case 'release': if (!press) return { runtime: false }; fwd('busk.release', {}); return res('released');
      case 'palette': {
        // /sl/palette/primary "#ff8800"  or  /sl/palette/secondary r g b (0..1)
        const i = palIndex(parts[2]);
        if (i < 0) return res('use /sl/palette/primary|secondary|tertiary');
        const rgb = args.length >= 3 ? args.slice(0, 3).map(Number) : null;
        fwd('palette.set', rgb ? { index: i, rgb, scope: 'live' } : { index: i, color: String(first), scope: 'live' });
        return res(`${PAL_NAMES[i]} colour`);
      }
      case 'group': {
        const g = named(this.show.groups, parts[2]);
        if (!g) return res('no such group');
        const what = (parts[3] || '').toLowerCase();
        if (what === 'level') fwd('busk.level', { groupId: g.id, level: clamp01(val(1)) });
        else if (what === 'flash') fwd('busk.flash', { groupId: g.id, on: press });
        else if (what === 'color' || what === 'colour') {
          const role = palIndex(first);
          if (role >= 0) fwd('busk.color', { groupId: g.id, role: role + 1 });
          else if (args.length >= 3) fwd('busk.color', { groupId: g.id, rgb: args.slice(0, 3).map(Number) });
          else if (isHex(first)) fwd('busk.color', { groupId: g.id, rgb: FX.hexToRgb(first) });
          else fwd('busk.color', { groupId: g.id, rgb: null });
        } else if (what === 'fx') {
          const fx = typeof first === 'string' ? FX.BUILTIN.concat(this.show.effects).find((e) => nameKey(e.name) === nameKey(first) || e.id === first) : null;
          fwd('busk.fx', { groupId: g.id, fx: fx ? fx.id : 'off' });
        } else return res('use /sl/group/<name>/level|color|flash|fx');
        return res(`group ${g.name} ${what}`);
      }
      default: return res('unknown /sl command');
    }
  },
};
