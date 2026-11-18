'use strict';
// Planning Center Services: read the upcoming service plans and turn one into the shape the
// engine's "plan.import" action takes.
//
// Sign-in uses a Personal Access Token (api.planningcenteronline.com → Personal Access Tokens:
// an Application ID and a Secret). They are kept in their own file in the data folder, never in
// the show file (so they are not in backups, exports or undo history).
const fs = require('fs');

const BASE = 'https://api.planningcenteronline.com';

class PlanningCenter {
  constructor(file, base = BASE) {
    this.file = file;
    this.base = base;
    this.creds = null;
    try {
      this.creds = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {}
  }

  get connected() {
    return !!(this.creds && this.creds.appId && this.creds.secret);
  }

  async get(path, creds = this.creds) {
    if (!creds) throw new Error('Connect Planning Center first (Setup → Planning Center)');
    let r;
    try {
      r = await fetch(this.base + path, {
        headers: { Authorization: `Basic ${Buffer.from(`${creds.appId}:${creds.secret}`).toString('base64')}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
    } catch (e) {
      throw new Error(`Could not reach Planning Center (${e.message}). Is this computer online?`);
    }
    if (r.status === 401) throw new Error('Planning Center did not accept the Application ID / Secret');
    if (r.status === 403) throw new Error('This Planning Center account cannot read Services plans');
    if (!r.ok) throw new Error(`Planning Center answered ${r.status}`);
    return r.json();
  }

  // Check the token, then remember it
  async connect(appId, secret) {
    const creds = { appId: String(appId || '').trim(), secret: String(secret || '').trim() };
    if (!creds.appId || !creds.secret) throw new Error('Enter the Application ID and the Secret');
    await this.get('/services/v2/service_types?per_page=1', creds);
    this.creds = creds;
    fs.writeFileSync(this.file, JSON.stringify(creds), { mode: 0o600 });
  }

  disconnect() {
    this.creds = null;
    try { fs.unlinkSync(this.file); } catch {}
  }

  async serviceTypes() {
    const j = await this.get('/services/v2/service_types?per_page=100');
    return (j.data || []).map((d) => ({ id: d.id, name: d.attributes.name }));
  }

  async upcomingPlans(serviceTypeId) {
    const j = await this.get(`/services/v2/service_types/${encodeURIComponent(serviceTypeId)}/plans?filter=future&order=sort_date&per_page=8`);
    return (j.data || []).map((d) => ({ id: d.id, title: d.attributes.title || d.attributes.series_title || '', dates: d.attributes.dates || '', sortDate: d.attributes.sort_date || '' }));
  }

  // One plan, ready for the "plan.import" action
  async plan(serviceTypeId, planId) {
    const st = encodeURIComponent(serviceTypeId), pl = encodeURIComponent(planId);
    const [planJ, itemsJ] = await Promise.all([
      this.get(`/services/v2/service_types/${st}/plans/${pl}`),
      this.get(`/services/v2/service_types/${st}/plans/${pl}/items?include=song,arrangement,key&per_page=200`),
    ]);
    return toPlan(planJ, itemsJ);
  }
}

// Planning Center JSON (JSON:API) -> { title, date, items: [{ title, kind, song? }] }
function toPlan(planJ, itemsJ) {
  const inc = new Map((itemsJ.included || []).map((x) => [`${x.type}:${x.id}`, x.attributes || {}]));
  const rel = (item, name) => {
    const d = item.relationships && item.relationships[name] && item.relationships[name].data;
    return d ? inc.get(`${d.type}:${d.id}`) || null : null;
  };
  const items = (itemsJ.data || [])
    .slice()
    .sort((a, b) => (a.attributes.sequence || 0) - (b.attributes.sequence || 0))
    .map((it) => {
      const at = it.attributes || {};
      const kind = ['song', 'header', 'media'].includes(at.item_type) ? at.item_type : 'item';
      const out = { title: at.title || '', kind };
      if (kind === 'song') {
        const song = rel(it, 'song') || {};
        const arr = rel(it, 'arrangement') || {};
        const key = rel(it, 'key') || {};
        out.song = {
          title: song.title || at.title || '',
          key: at.key_name || key.starting_key || key.name || '',
          bpm: arr.bpm || null,
          sequence: Array.isArray(arr.sequence) ? arr.sequence : arr.sequence_short || [],
        };
      }
      return out;
    });
  const p = (planJ.data && planJ.data.attributes) || {};
  return { title: p.title || p.series_title || 'Service', date: p.dates || p.sort_date || '', items };
}

module.exports = { PlanningCenter, toPlan };
