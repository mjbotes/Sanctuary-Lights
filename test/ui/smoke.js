// Browser smoke test: opens the app, visits every tab and fails on any page error.
// Run:  node test/ui/smoke.js   (starts its own server on a free port with a temporary show)
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..', '..');
const port = 18000 + Math.floor(Math.random() * 2000);
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-smoke-'));

(async () => {
  const srv = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(port), LIGHTS_DATA: data }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  srv.stdout.on('data', (d) => (out += d));
  srv.stderr.on('data', (d) => (out += d));
  for (let i = 0; i < 50 && !out.includes('is running'); i++) await new Promise((r) => setTimeout(r, 100));
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [];
  let failed = false;
  try {
    for (const viewport of [{ width: 1400, height: 900 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport });
      page.on('pageerror', (e) => errors.push(`${viewport.width}px: ${e.message}`));
      page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(`${viewport.width}px console: ${m.text()}`));
      page.on('dialog', (d) => d.dismiss());
      await page.goto(`http://localhost:${port}/`);
      await page.waitForTimeout(800);
      const tabs = await page.locator('#tabs button[data-tab]').evaluateAll((b) => b.map((x) => x.dataset.tab));
      for (const tab of tabs) {
        await page.click(`#tabs button[data-tab="${tab}"]`);
        await page.waitForTimeout(250);
        const visible = await page.locator(`#tab-${tab}`).isVisible();
        if (!visible) errors.push(`${viewport.width}px: tab ${tab} did not show`);
      }
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      if (viewport.width < 500 && sw > viewport.width + 2) errors.push(`${viewport.width}px: page scrolls sideways (${sw}px)`);
      await page.close();
    }
  } catch (e) {
    errors.push(String(e));
  } finally {
    await browser.close();
    srv.kill();
  }
  if (errors.length) {
    failed = true;
    console.error('UI smoke test FAILED:\n' + errors.join('\n'));
  } else console.log('UI smoke test passed');
  try { fs.rmSync(data, { recursive: true, force: true }); } catch {}
  process.exit(failed ? 1 : 0);
})();
