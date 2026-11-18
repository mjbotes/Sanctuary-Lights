'use strict';
// MCP server: lets an AI assistant (Claude Desktop, Claude Code, or any MCP client) see and change
// the show. It speaks MCP's "Streamable HTTP" transport (JSON-RPC 2.0 over POST /mcp); Claude
// Desktop connects through bin/sanctuary-lights-mcp.js, a small stdio bridge.
//
// Safety:
// - Off until an admin switches it on (Setup → AI assistant), and every request needs the secret
//   token (Authorization: Bearer …). The token lives in its own file, never in the show.
// - The assistant acts as an Operator or an Admin (chosen in Setup), with the same permission checks
//   as a person, and every change goes through app.run(): it shows on every screen at once and Undo
//   reverses it.
const fs = require('fs');
const crypto = require('crypto');
const { nameKey } = require('../engine/util');
const { NAMED } = require('../engine/actions/compose');
const { plan, describe } = require('../snapshot');

const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const pct = (v) => Math.round((Number(v) || 0) * 100);

class Mcp {
  constructor(app, file) {
    this.app = app;
    this.file = file;
    this.cfg = { enabled: false, role: 'operator', token: '' };
    try { Object.assign(this.cfg, JSON.parse(fs.readFileSync(file, 'utf8'))); } catch {}
    if (!this.cfg.token) this.cfg.token = crypto.randomBytes(24).toString('base64url');
    this.tools = makeTools(app, () => this.cfg.role);
  }

  save() {
    try { fs.writeFileSync(this.file, JSON.stringify(this.cfg), { mode: 0o600 }); } catch (e) { this.app.log.warn(`MCP settings: ${e.message}`); }
  }

  configure({ enabled, role, regenerate }) {
    if (enabled !== undefined) this.cfg.enabled = !!enabled;
    if (role !== undefined) this.cfg.role = role === 'admin' ? 'admin' : 'operator';
    if (regenerate) this.cfg.token = crypto.randomBytes(24).toString('base64url');
    this.save();
  }

  authorized(req, url) {
    const h = String(req.headers.authorization || '');
    const t = h.startsWith('Bearer ') ? h.slice(7).trim() : url.searchParams.get('token') || '';
    const a = Buffer.from(t), b = Buffer.from(this.cfg.token);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  // One JSON-RPC message -> response object, or null for notifications
  async message(m) {
    const reply = (result) => ({ jsonrpc: '2.0', id: m.id, result });
    const fail = (code, message) => ({ jsonrpc: '2.0', id: m.id ?? null, error: { code, message } });
    if (!m || m.jsonrpc !== '2.0' || typeof m.method !== 'string') return fail(-32600, 'Invalid request');
    const notification = m.id === undefined || m.id === null;
    switch (m.method) {
      case 'initialize': {
        const asked = m.params && m.params.protocolVersion;
        return reply({
          protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'sanctuary-lights', title: 'Sanctuary Lights', version: this.app.cfg.version },
          instructions: INSTRUCTIONS,
        });
      }
      case 'ping':
        return notification ? null : reply({});
      case 'tools/list':
        return reply({ tools: this.tools.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations })) });
      case 'tools/call': {
        const tool = this.tools.find((t) => t.name === (m.params && m.params.name));
        if (!tool) return fail(-32602, `Unknown tool: ${m.params && m.params.name}`);
        try {
          const out = await tool.run((m.params && m.params.arguments) || {});
          if (out && Array.isArray(out.content)) return reply(out); // e.g. a picture
          return reply({ content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out, null, 1) }] });
        } catch (e) {
          return reply({ content: [{ type: 'text', text: e.message }], isError: true });
        }
      }
      default:
        if (notification) return null; // notifications/initialized, cancelled…
        return fail(-32601, `Method not found: ${m.method}`);
    }
  }

  // POST /mcp
  async handle(req, res, url, body) {
    const send = (code, data, headers = {}) => {
      res.writeHead(code, { 'Content-Type': 'application/json', ...headers });
      res.end(data === undefined ? '' : JSON.stringify(data));
    };
    if (!this.cfg.enabled) return send(403, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'The AI assistant connection is switched off (Setup → AI assistant)' } });
    if (!this.authorized(req, url)) return send(401, { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Wrong or missing token' } });
    let msg;
    try { msg = JSON.parse(body || 'null'); } catch { return send(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
    const list = Array.isArray(msg) ? msg : [msg];
    const out = [];
    for (const m of list) {
      const r = await this.message(m);
      if (r) out.push(r);
    }
    if (!out.length) return send(202);
    const headers = list.some((m) => m && m.method === 'initialize') ? { 'Mcp-Session-Id': crypto.randomUUID() } : {};
    return send(200, Array.isArray(msg) ? out : out[0], headers);
  }
}

const INSTRUCTIONS = `Sanctuary Lights runs a church's stage lighting. Start with get_overview to see the lights, songs, looks and service parts.
- Songs have sections (Intro, Verse, Chorus…); each section shows a look. light_song designs every section from the rig and the song's colours; compose_look builds or changes a look in plain terms (groups or roles, intensity %, colours, effects).
- Colours: prefer "primary"/"secondary"/"tertiary" (each song's palette) so one look works for every song; front lights should usually stay warm white so faces are visible.
- Service parts (Worship, Hosting, Sermon, Video…) decide what drives the lights during each part of the service.
- Everything you change appears live on stage and on every screen, and can be undone with undo. Prefer building looks without show:true unless asked to change what is on stage now.`;

function makeTools(app, roleOf) {
  const eng = () => app.engine;
  const run = (action) => app.run(action, roleOf(), 'the AI assistant');
  const song = (name) => {
    const s = name ? eng().findSong(name) : eng().song(eng().rt.songId);
    if (!s) throw new Error(name ? `No song "${name}". Songs: ${eng().show.songs.map((x) => x.name).join(', ') || 'none'}` : 'No song is picked; name one');
    return s;
  };
  const section = (s, name) => {
    const k = nameKey(name);
    const sec = s.sections.find((x) => nameKey(x.name) === k) || s.sections.find((x) => nameKey(x.name).startsWith(k));
    if (!sec) throw new Error(`"${s.name}" has no section "${name}". Sections: ${s.sections.map((x) => x.name).join(', ')}`);
    return sec;
  };
  const look = (name) => {
    const l = eng().show.looks.find((x) => nameKey(x.name) === nameKey(name)) || eng().show.looks.find((x) => nameKey(x.name).endsWith(nameKey(name)));
    if (!l) throw new Error(`No look "${name}"`);
    return l;
  };
  const part = (name) => {
    const p = eng().show.parts.find((x) => nameKey(x.name) === nameKey(name) || x.id === name);
    if (!p) throw new Error(`No service part "${name}". Parts: ${eng().show.parts.map((x) => x.name).join(', ')}`);
    return p;
  };
  const lookName = (id) => (eng().show.looks.find((l) => l.id === id) || {}).name || null;
  const hex = (c) => {
    const v = String(c || '').trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(v)) return v;
    if (NAMED[v]) return NAMED[v];
    throw new Error(`Unknown colour "${c}". Use #rrggbb or: ${Object.keys(NAMED).join(', ')}`);
  };
  const str = { type: 'string' };
  const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
  const RO = { readOnlyHint: true, openWorldHint: false };
  const W = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

  return [
    {
      name: 'get_overview', title: 'Overview of the show', annotations: RO,
      description: 'The rig (lights by role and group), service parts, set list and song library, looks, effects, and what is on stage now.',
      inputSchema: obj({}),
      run() {
        const e = eng(), sh = e.show, rt = e.rt;
        const roles = e.rigRoles();
        const fname = (id) => (sh.fixtures.find((f) => f.id === id) || {}).name;
        const cur = e.song(rt.songId);
        return {
          show: sh.name,
          lights: Object.fromEntries(Object.entries(roles).filter(([, l]) => l.length).map(([r, l]) => [r, l.map(fname)])),
          groups: sh.groups.map((g) => ({ name: g.name, lights: g.fixtures.length })),
          serviceParts: sh.parts.map((p) => ({ name: p.name, look: lookName(p.lookId), brightness: `${pct(p.level)}%`, songsChangeLights: p.sections, followScreenColours: p.screenColor })),
          setList: e.setList().map((s) => ({ name: s.name, sections: s.sections.length, key: s.key, bpm: s.bpm })),
          songLibrary: sh.songs.filter((s) => s.archived).map((s) => s.name),
          looks: sh.looks.map((l) => l.name),
          effects: require('../../public/fxmath').BUILTIN.map((x) => x.name).concat((sh.effects || []).map((x) => x.name)),
          serviceOrder: sh.order ? sh.order.items.map((i) => `${i.kind === 'header' ? '## ' : ''}${i.title}`) : null,
          now: {
            song: cur ? cur.name : null,
            section: cur && (cur.sections.find((x) => x.id === rt.sectionId) || {}).name || null,
            look: rt.base.kind === 'look' ? lookName(rt.base.lookId) : 'cue list',
            part: (e.part(rt.partId) || {}).name,
            master: `${pct(rt.gm)}%`, blackout: rt.blackout, followMode: rt.mode,
            palette: e.paletteNow(),
          },
        };
      },
    },
    {
      name: 'see_stage', title: 'Look at the stage', annotations: RO,
      description: 'A picture of what the lights are doing now, and a summary per group (brightness, colour, effects). The picture is the 3D view (from an open Sanctuary Lights window) or, if none is open, a 2D plan seen from above with the audience at the bottom. Use it to check a look after changing it. In practice mode it shows the practice, not the real lights.',
      inputSchema: obj({ view: { type: 'string', enum: ['front', 'foh', 'top', 'side'], description: 'Camera for the 3D view (default front)' } }),
      async run({ view }) {
        const e = eng();
        const url = await app.requestSnapshot(view || 'front');
        const look = e.computeLook(Date.now()); // after the wait: matches the picture
        const m = url && /^data:(image\/(?:jpeg|png));base64,(.*)$/s.exec(url);
        const image = m ? { type: 'image', mimeType: m[1], data: m[2] } : { type: 'image', mimeType: 'image/png', data: plan(e, look).toString('base64') };
        const note = m ? `3D view (${view || 'front'}).` : '2D plan from above (no app window open for a 3D picture): each glow is a light in its colour and brightness; the audience is at the bottom; red rings are lights pointing at a screen.';
        return { content: [image, { type: 'text', text: `${note}\n${describe(e, look)}` }] };
      },
    },
    {
      name: 'get_service_report', title: 'Service report', annotations: RO,
      description: 'What happened during a service (default: today): songs with start times and how long each ran, sections, service parts, cues, blackout, Panic, practice, and problems (ProPresenter / USB-DMX / DMX output dropouts, errors), each with what caused it. day: YYYY-MM-DD; without entries, lists the days that have reports.',
      inputSchema: obj({ day: { ...str, description: 'YYYY-MM-DD (default today)' } }),
      run({ day: d }) {
        const r = app.servicelog.report(d);
        if (!r.entries.length) return { day: r.day, note: 'Nothing recorded that day', daysWithReports: app.servicelog.days().slice(0, 20) };
        const t = (at) => new Date(at).toTimeString().slice(0, 5);
        return {
          day: r.day, from: t(r.from), to: t(r.to),
          songs: r.songs.map((s) => `${t(s.at)} ${s.name}${s.minutes !== null ? ` (${s.minutes} min, ${s.sections} section changes)` : ''}`),
          problems: r.problems.map((p) => `${t(p.at)} ${p.text}`),
          timeline: r.entries.map((x) => `${t(x.at)} [${x.kind}] ${x.text}${x.by ? ` (by ${x.by})` : ''}`),
        };
      },
    },
    {
      name: 'get_song', title: 'A song in detail', annotations: RO,
      description: 'Sections (with their look and fade), colours (primary/secondary/tertiary), key and BPM of a song. Without a name: the song that is picked now.',
      inputSchema: obj({ song: { ...str, description: 'Song name (loose match)' } }),
      run({ song: name }) {
        const s = song(name);
        const KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
        return {
          name: s.name, inSetList: !s.archived, notes: s.notes, bpm: s.bpm,
          key: s.key === null || s.key === undefined ? null : `${KEYS[s.key]}${s.minor ? 'm' : ''}`,
          colours: s.palette || eng().show.palette,
          sections: s.sections.map((x) => ({ name: x.name, look: lookName(x.lookId), fade: x.fade })),
          tracks: s.stems.length,
        };
      },
    },
    {
      name: 'add_song', title: 'Add a song', annotations: W,
      description: 'Add a song with its sections in order. A song programmed before (even in the library, or named slightly differently) comes back with its lighting instead.',
      inputSchema: obj({ name: str, sections: { type: 'array', items: str, description: 'e.g. ["Intro","Verse 1","Chorus","Verse 2","Chorus 2","Bridge","Chorus 3","Outro"]' }, bpm: { type: 'number' } }, ['name']),
      run({ name, sections, bpm }) {
        const r = run({ type: 'song.add', name, sections: sections || [] }) || {};
        const s = eng().song(eng().rt.songId);
        if (r.restored && sections && sections.length) run({ type: 'song.arrange', id: s.id, sections });
        if (bpm) run({ type: 'song.edit', id: s.id, bpm });
        return r.restored ? `"${s.name}" was already programmed: it is back in the set list with its lighting${sections && sections.length ? ', in this arrangement' : ''}.` : `Added "${s.name}" with ${s.sections.length} sections. Use light_song to light it.`;
      },
    },
    {
      name: 'arrange_song', title: 'Change the order of a song\'s sections', annotations: W,
      description: 'Set the sections of a song in order. Sections keep their looks; new ones get the look of their kind (Chorus 4 -> chorus look).',
      inputSchema: obj({ song: str, sections: { type: 'array', items: str } }, ['song', 'sections']),
      run({ song: name, sections }) {
        const s = song(name);
        run({ type: 'song.arrange', id: s.id, sections });
        return `${s.name}: ${s.sections.map((x) => `${x.name} (${lookName(x.lookId) || 'no look'})`).join(', ')}`;
      },
    },
    {
      name: 'light_song', title: 'Light a song', annotations: W,
      description: 'Design a look for every section of a song from the rig and the song\'s colours (intro calm, chorus big, bridge moving…). Replaces the song\'s own looks.',
      inputSchema: obj({ song: str }, ['song']),
      run({ song: name }) {
        const s = song(name);
        run({ type: 'song.design', id: s.id });
        return `${s.name} is lit: ${s.sections.map((x) => `${x.name} → ${lookName(x.lookId)}`).join('; ')}`;
      },
    },
    {
      name: 'set_song_colors', title: 'Set a song\'s colours', annotations: W,
      description: 'The song\'s primary, secondary and tertiary colours (#rrggbb or a colour name). Looks that use the palette follow at once.',
      inputSchema: obj({ song: str, primary: str, secondary: str, tertiary: str }, ['song']),
      run(a) {
        const s = song(a.song);
        if (eng().rt.songId !== s.id) run({ type: 'song.select', id: s.id });
        ['primary', 'secondary', 'tertiary'].forEach((k, i) => { if (a[k]) run({ type: 'palette.set', index: i, color: hex(a[k]) }); });
        return `${s.name} colours: ${(eng().song(s.id).palette || eng().show.palette).join(', ')}`;
      },
    },
    {
      name: 'set_section', title: 'Change a section', annotations: W,
      description: 'Which look a song section shows, and its fade time in seconds.',
      inputSchema: obj({ song: str, section: str, look: str, fade: { type: 'number' } }, ['song', 'section']),
      run(a) {
        const s = song(a.song), sec = section(s, a.section);
        run({ type: 'section.edit', songId: s.id, id: sec.id, ...(a.look ? { lookId: look(a.look).id } : {}), ...(a.fade !== undefined ? { fade: a.fade } : {}) });
        return `${s.name} · ${sec.name}: look ${lookName(sec.lookId) || 'none'}, fade ${sec.fade}s`;
      },
    },
    {
      name: 'compose_look', title: 'Build or change a look', annotations: W,
      description: 'Create a look (or change one with the same name) from parts: which lights (group names, light names, or roles: front, back, movers, house, special, all), intensity 0-100, colour (#rrggbb, primary/secondary/tertiary, or a name like warm white, amber, deep blue), pan/tilt/zoom 0-100, and an effect (e.g. pulse, chase, sparkle, circle, ballyhoo, palette chase) with speed (beats multiplier, 0.25-4) and size 0-100. Lights not mentioned are off, unless start is "current" (change the existing look) or the name of another look to start from.',
      inputSchema: obj({
        name: str,
        start: { ...str, description: '"dark" (default), "current", or a look name to start from' },
        parts: {
          type: 'array',
          items: obj({
            lights: { description: 'Group, role or light name(s)', anyOf: [str, { type: 'array', items: str }] },
            intensity: { type: 'number' }, color: str, pan: { type: 'number' }, tilt: { type: 'number' }, zoom: { type: 'number' },
            effect: str, effect_speed: { type: 'number' }, effect_size: { type: 'number' },
          }, ['lights']),
        },
        show: { type: 'boolean', description: 'Also put it on stage now' },
      }, ['name', 'parts']),
      run(a) {
        const r = run({ type: 'look.compose', name: a.name, start: a.start, parts: a.parts, show: !!a.show }) || {};
        return `Look "${r.look}" saved (${r.lights} lights, ${r.effects} effects)${a.show ? ' and on stage now' : ''}.`;
      },
    },
    {
      name: 'show_look', title: 'Put a look on stage', annotations: W,
      description: 'Show a look now (fade in seconds).',
      inputSchema: obj({ look: str, fade: { type: 'number' } }, ['look']),
      run({ look: name, fade }) {
        const l = look(name);
        run({ type: 'look.apply', id: l.id, fade: fade ?? 1 });
        return `On stage: ${l.name}`;
      },
    },
    {
      name: 'go', title: 'Go to a song or section', annotations: W,
      description: 'Pick a song and/or go to one of its sections (as an operator tap: it brings the worship lights back during a non-song part).',
      inputSchema: obj({ song: str, section: str }),
      run({ song: name, section: secName }) {
        const s = song(name);
        if (eng().rt.songId !== s.id) run({ type: 'song.select', id: s.id });
        if (secName) run({ type: 'section.go', songId: s.id, id: section(s, secName).id });
        return `Now: ${s.name}${secName ? ` · ${section(s, secName).name}` : ''}`;
      },
    },
    {
      name: 'set_part', title: 'Switch the service part', annotations: W,
      description: 'Switch to a service part (Worship, Hosting, Sermon, Video, Baptism…).',
      inputSchema: obj({ part: str }, ['part']),
      run({ part: name }) {
        const p = part(name);
        run({ type: 'part.go', id: p.id });
        return `Service part: ${p.name}`;
      },
    },
    {
      name: 'save_part', title: 'Create or change a service part', annotations: W,
      description: 'A service part (e.g. Baptism, Communion): its look, brightness 0-100, whether songs and screen colours change the lights, and the words in ProPresenter/Planning Center titles that pick it.',
      inputSchema: obj({ name: str, look: str, brightness: { type: 'number' }, songs_change_lights: { type: 'boolean' }, follow_screen_colors: { type: 'boolean' }, words: { ...str, description: 'Comma-separated, e.g. "baptism, baptise"' } }, ['name']),
      run(a) {
        const existing = eng().show.parts.find((x) => nameKey(x.name) === nameKey(a.name));
        const part = { name: a.name, ...(existing ? { id: existing.id } : { sections: false, screenColor: false }) };
        if (a.look) part.lookId = look(a.look).id;
        if (a.brightness !== undefined) part.level = Math.max(0, Math.min(100, a.brightness)) / 100;
        if (a.songs_change_lights !== undefined) part.sections = a.songs_change_lights;
        if (a.follow_screen_colors !== undefined) part.screenColor = a.follow_screen_colors;
        if (a.words !== undefined) part.match = a.words;
        run({ type: 'part.save', part });
        return `${existing ? 'Changed' : 'Added'} service part "${a.name}".`;
      },
    },
    {
      name: 'set_master', title: 'Master level and blackout', annotations: W,
      description: 'Overall brightness 0-100, and/or blackout on or off.',
      inputSchema: obj({ level: { type: 'number' }, blackout: { type: 'boolean' } }),
      run({ level, blackout }) {
        if (level !== undefined) run({ type: 'gm.set', value: Math.max(0, Math.min(100, level)) / 100 });
        if (blackout !== undefined) run({ type: 'blackout.set', on: blackout });
        return `Master ${pct(eng().rt.gm)}%, blackout ${eng().rt.blackout ? 'on' : 'off'}`;
      },
    },
    {
      name: 'practice', title: 'Practice mode', annotations: W,
      description: 'Practice mode on: the real lights stay exactly as they are while you try looks (see_stage shows the practice). Off: keep=false puts everything back to the real stage (nothing changes on the lights); keep=true sends what was practised to the lights. Use it before experimenting during a service or rehearsal.',
      inputSchema: obj({ on: { type: 'boolean' }, keep: { type: 'boolean' } }, ['on']),
      run({ on, keep }) {
        run({ type: 'practice.set', on, keep: !!keep });
        return on ? 'Practice mode on: the real lights are not changing.' : keep ? 'Practice sent to the real lights.' : 'Back to the real stage.';
      },
    },
    {
      name: 'panic', title: 'Panic', annotations: { ...W, destructiveHint: true },
      description: 'Stop every effect, strobe and live change, master to full, back to Worship and the safe look.',
      inputSchema: obj({}),
      run() { run({ type: 'panic' }); return 'Panic: back to the safe look.'; },
    },
    {
      name: 'add_schedule', title: 'Schedule a change (admin)', annotations: W,
      description: 'Run something at a time each week: switch to a part, show a look, blackout on/off, or set the master. Days 0=Sunday..6=Saturday; time "HH:MM" on the lighting computer\'s clock.',
      inputSchema: obj({ days: { type: 'array', items: { type: 'integer' } }, time: str, action: { type: 'string', enum: ['part', 'look', 'blackout', 'unblackout', 'master'] }, target: { ...str, description: 'Part or look name, or master level 0-100' } }, ['days', 'time', 'action']),
      run(a) {
        const target = a.action === 'part' ? part(a.target).id : a.action === 'look' ? look(a.target).id : a.action === 'master' ? Number(a.target) / 100 : null;
        run({ type: 'schedule.save', entry: { days: a.days, time: a.time, kind: a.action, target } });
        return `Scheduled ${a.action}${a.target ? ` ${a.target}` : ''} at ${a.time} on days ${a.days.join(', ')}.`;
      },
    },
    {
      name: 'undo', title: 'Undo', annotations: W,
      description: 'Undo the last change to the show (yours or anyone\'s).',
      inputSchema: obj({}),
      run() { const r = run({ type: 'history.undo' }) || {}; return `Undone: ${r.label || 'last change'}`; },
    },
    {
      name: 'run_action', title: 'Run any Sanctuary Lights action', annotations: W,
      description: 'For anything the other tools do not cover: run an app action by type with its parameters (ids, not names). Use get_overview/get_song first. Permission checks apply.',
      inputSchema: obj({ type: str, params: { type: 'object' } }, ['type']),
      run({ type, params }) {
        if (!eng().actions[type] && !['history.undo', 'history.redo', 'snapshot.save'].includes(type)) throw new Error(`Unknown action. Actions: ${Object.keys(eng().actions).join(', ')}`);
        const r = run({ ...(params || {}), type });
        return r ? r : 'Done.';
      },
    },
  ];
}

module.exports = { Mcp, PROTOCOLS };
