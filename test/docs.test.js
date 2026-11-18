'use strict';
// The user guides: every guide is listed in the Help tab, and every link between guides works.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'public', 'docs');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
const helpJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'help.js'), 'utf8');

test('every guide is listed in the Help tab', () => {
  for (const f of files) assert.ok(helpJs.includes(`'${f}'`), `${f} is missing from GUIDES in help.js`);
});

test('links between guides point at guides that exist', () => {
  for (const f of files) {
    const md = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const [, href] of md.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^https?:/.test(href)) continue;
      const target = href.split('#')[0];
      assert.ok(files.includes(target), `${f} links to missing guide ${href}`);
    }
  }
});

test('the guides render to HTML without leftover markdown', async () => {
  const { render } = await import('../public/js/markdown.js');
  for (const f of files) {
    const html = render(fs.readFileSync(path.join(dir, f), 'utf8'), (h) => h);
    assert.ok(!/\*\*|^#+ |\]\(/m.test(html.replace(/<pre>[\s\S]*?<\/pre>|<code>[\s\S]*?<\/code>/g, '')), `${f} has unrendered markdown`);
  }
});
