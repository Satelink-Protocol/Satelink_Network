import { chromium } from 'playwright';
import fs from 'node:fs';
const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });
const widths = [360, 390, 768, 1024, 1440];
const themes = ['light', 'dark'];
const targets = [
  ['sat-home', 'https://satelink.network/'],
  ['sat-pricing', 'https://satelink.network/pricing'],
  ['sat-product', 'https://satelink.network/product/overview'],
  ['sat-login', 'https://satelink.network/login'],
  ['console', 'https://console.satelink.network/'],
  ['jakuraa', 'https://jakuraa.com/'],
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
    if (name === 'sat-home' && w >= 1024) {
      // open Products mega-menu
      const trig = p.locator('header').getByRole('button', { name: /^Products/i }).first();
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
console.log(JSON.stringify(results.map(r=>[r.name,r.w,r.t,r.status,r.finalUrl!==r.url?r.finalUrl:'',r.hscroll,r.dataTheme,r.error||''].join(' ')),null,0));
