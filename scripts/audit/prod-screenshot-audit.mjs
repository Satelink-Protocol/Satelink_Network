// Screenshot + measurement audit: satelink.network, console, jakuraa.com at
// 360/390/768/1024/1440 × light/dark. Bases default to production; override
// with SAT_BASE / CONSOLE_BASE / JAK_BASE to audit local builds or previews.
//   node scripts/audit/prod-screenshot-audit.mjs <outdir>
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
const SAT = process.env.SAT_BASE || 'https://satelink.network';
const CON = process.env.CONSOLE_BASE || 'https://console.satelink.network';
const JAK = process.env.JAK_BASE || 'https://jakuraa.com';
const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });
const widths = [360, 390, 768, 1024, 1440];
const themes = ['light', 'dark'];
const targets = [
  ['sat-home', `${SAT}/`],
  ['sat-pricing', `${SAT}/pricing`],
  ['sat-product', `${SAT}/product/overview`],
  ['console', `${CON}/sign-in`],
  ['jakuraa', `${JAK}/`],
];
const results = [];
const browser = await chromium.launch();
for (const [name, url] of targets) for (const w of widths) for (const t of themes) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, colorScheme: t, deviceScaleFactor: 1 });
  await ctx.addInitScript((th) => { try { localStorage.setItem('satelink-theme', th); } catch {} }, t);
  const host = new URL(url).hostname;
  await ctx.addCookies([{ name: 'slc_theme', value: t, domain: host, path: '/' }]);
  const p = await ctx.newPage();
  const rec = { name, url, w, t };
  try {
    const r = await p.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
    rec.status = r?.status(); rec.finalUrl = p.url();
    await p.waitForTimeout(600);
    rec.hscroll = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    rec.dataTheme = await p.evaluate(() => document.documentElement.getAttribute('data-theme'));
    await p.screenshot({ path: `${OUT}/${name}-${w}-${t}.png` });
    const axe = await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa']).analyze().catch(() => null);
    rec.axe = axe ? axe.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => `${v.id}×${v.nodes.length}`) : 'n/a';
    if (name === 'sat-home' && w >= 1024) {
      // open Products mega-menu
      const trig = p.getByRole('banner').getByRole('button', { name: /^Products/i }).first();
      if (await trig.count()) {
        await trig.hover(); await trig.click().catch(()=>{}); await p.waitForTimeout(500);
        const panel = await p.evaluate(() => {
          const cands=[...document.querySelectorAll('[role=menu],[data-state=open],[role=dialog],nav div')].filter(e=>{const r=e.getBoundingClientRect();return r.height>150&&r.width>300&&getComputedStyle(e).visibility!=='hidden'&&r.top<400;});
          const el=cands.sort((a,b)=>b.getBoundingClientRect().height-a.getBoundingClientRect().height)[0];
          if(!el) return null; const cs=getComputedStyle(el); const r=el.getBoundingClientRect();
          return {bg:cs.backgroundColor, z:cs.zIndex, top:r.top,h:r.height, tag:el.tagName, cls:el.className?.toString().slice(0,120)};
        });
        rec.megaMenu = panel;
        await p.screenshot({ path: `${OUT}/${name}-${w}-${t}-megamenu.png` });
      } else rec.megaMenu = 'no Products button';
      rec.headerItems = await p.evaluate(() => [...document.querySelectorAll('header a, header button')].filter(e=>e.offsetParent).map(e=>(e.innerText||e.getAttribute('aria-label')||'').trim()).filter(Boolean));
    }
    if (name === 'sat-home' && w <= 390) rec.headerItems = await p.evaluate(() => [...document.querySelectorAll('header a, header button')].filter(e=>e.offsetParent).map(e=>(e.innerText||e.getAttribute('aria-label')||'').trim()).filter(Boolean));
  } catch (e) { rec.error = String(e).slice(0, 200); }
  results.push(rec); await ctx.close();
}
await browser.close();
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
for (const r of results) console.log([r.name,r.w,r.t,r.status,r.finalUrl!==r.url?r.finalUrl:'','hscroll='+r.hscroll,'axe='+JSON.stringify(r.axe),r.error||''].join(' '));
