// Setup → AI assistant (MCP): switch the connection on, choose what the assistant may do, and copy
// the settings for Claude Desktop / Claude Code.
import { $, S, authHeaders, h, toast } from './core.js';

const api = async (body) => {
  const r = await fetch('/api/mcp', body ? { method: 'POST', body: JSON.stringify(body), headers: authHeaders() } : { headers: authHeaders() });
  const j = await r.json().catch(() => ({ ok: false }));
  if (!j.ok) throw new Error(j.error || 'Only an admin can change this');
  return j;
};

const copyBox = (text) => {
  const pre = h('pre', { className: 'mcp-code' }, text);
  const btn = h('button', { className: 'btn small', onclick: async () => {
    try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Select the text and copy it', true); }
  } }, 'Copy');
  return h('div', { className: 'mcp-copy' }, pre, btn);
};

async function render() {
  const box = $('#mcpBox');
  if (!box) return;
  let c;
  try { c = await api(); } catch (e) { box.replaceChildren(h('p', { className: 'hint' }, e.message)); return; }
  let showToken = false;
  const draw = () => {
    const local = c.urls[0];
    const lan = c.urls[1] || c.urls[0];
    const env = { SANCTUARY_LIGHTS_URL: local, SANCTUARY_LIGHTS_TOKEN: c.token, ...(c.bridge.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) };
    const desktop = JSON.stringify({ mcpServers: { 'sanctuary-lights': { command: c.bridge.command, args: [c.bridge.script], env } } }, null, 2);
    const desktopOther = JSON.stringify({ mcpServers: { 'sanctuary-lights': { command: 'node', args: ['/path/to/sanctuary-lights-mcp.js'], env: { SANCTUARY_LIGHTS_URL: lan, SANCTUARY_LIGHTS_TOKEN: c.token } } } }, null, 2);
    const code = `claude mcp add --transport http sanctuary-lights ${local} --header "Authorization: Bearer ${c.token}"`;
    box.replaceChildren(
      h('p', { className: 'hint' }, 'Let an AI assistant such as Claude see and change the show: light songs, build looks, set up service parts and the schedule, or run the lights. Everything it does appears on every screen straight away, and Undo reverses it.'),
      h('label', { className: 'check plain' },
        h('input', { type: 'checkbox', checked: c.enabled, onchange: async (e) => { c = { ...c, ...(await api({ enabled: e.target.checked })) }; draw(); toast(e.target.checked ? 'AI assistant connection on' : 'AI assistant connection off'); } }),
        ' Allow an AI assistant to connect'),
      h('label', { className: 'form mcp-role' }, 'It may',
        h('select', { onchange: async (e) => { c = { ...c, ...(await api({ role: e.target.value })) }; draw(); } },
          h('option', { value: 'operator', selected: c.role === 'operator' }, 'do what an Operator can (songs, looks, parts, running the lights)'),
          h('option', { value: 'admin', selected: c.role === 'admin' }, 'do what an Admin can (also the patch, settings and schedule)'))),
      h('div', { className: 'row' },
        h('span', { className: 'lbl' }, 'Token'),
        h('code', { className: 'mcp-token' }, showToken ? c.token : '••••••••••••••••'),
        h('button', { className: 'btn small', onclick: () => { showToken = !showToken; draw(); } }, showToken ? 'Hide' : 'Show'),
        h('button', { className: 'btn small warn', title: 'Connected assistants stop working until they get the new token', onclick: async () => { if (!confirm('Make a new token? Assistants using the old one are disconnected.')) return; c = { ...c, ...(await api({ regenerate: true })) }; showToken = true; draw(); } }, 'New token')),
      c.enabled ? h('div', {},
        h('h3', { className: 'sub' }, 'Claude Desktop on this computer'),
        h('p', { className: 'hint' }, 'Claude Desktop → Settings → Developer → Edit Config, paste this (merge it if the file already has "mcpServers"), save, and restart Claude Desktop.'),
        copyBox(desktop),
        h('h3', { className: 'sub' }, 'Claude Code'),
        copyBox(code),
        h('details', { className: 'mcp-more' }, h('summary', {}, 'Claude Desktop on another computer'),
          h('p', { className: 'hint' }, 'Install Node.js there, download ', h('a', { href: '/mcp-bridge.js', download: 'sanctuary-lights-mcp.js' }, 'sanctuary-lights-mcp.js'), ', put its path in "args", and use this config. Both computers must be on the same network.'),
          copyBox(desktopOther)),
        h('p', { className: 'hint' }, 'Try asking: "Light Graves Into Gardens", "Make the bridge bigger with the movers sweeping", "Add a Baptism part with a bright, cool look", or "Every Sunday at 9:30 switch to Pre-service".'))
        : h('p', { className: 'hint' }, 'Switch it on to see how to connect Claude.'));
  };
  draw();
}

$('nav button[data-tab=setup]').addEventListener('click', () => { if (S.role === 'admin' || !S.role) render(); });
export { render as renderMcp };
