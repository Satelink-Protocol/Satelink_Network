// Console V2 screenshots at 5 widths × 2 themes against a running console
// (harness-backed: seeded TEST DATA, never production). Usage:
//   node scripts/audit/console-screens.mjs <baseUrl> <outDir>
import { chromium } from 'playwright';
import fs from 'node:fs';
const [base, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const pages = [['home-simple', '/', 'simple'], ['data', '/data', 'simple'], ['billing', '/billing', 'simple'], ['spend', '/spend', 'simple'], ['agents', '/agents', 'simple'], ['home-advanced', '/', 'advanced']];
const b = await chromium.launch();
for (const w of [360, 390, 768, 1024, 1440]) for (const t of ['light', 'dark']) {
  const ctx = await b.newContext({ viewport: { width: w, height: 900 } });
  const u = new URL(base);
  for (const [name, path, mode] of pages) {
    await ctx.addCookies([{ name: 'satelink.session_token', value: 'acct_demo', domain: u.hostname, path: '/' }, { name: 'slc_theme', value: t, domain: u.hostname, path: '/' }, { name: 'slc_mode', value: mode, domain: u.hostname, path: '/' }]);
    const p = await ctx.newPage();
    await p.goto(base + path, { waitUntil: 'networkidle' });
    const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    if (over > 0) console.log('HSCROLL', name, w, t, over);
    await p.screenshot({ path: `${out}/${name}-${w}-${t}.png`, fullPage: false });
    await p.close();
  }
  await ctx.close();
}
await b.close();
console.log('done');
