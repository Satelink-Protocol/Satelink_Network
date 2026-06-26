import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

const pagesToTest = [
  { name: 'overview', url: 'http://localhost:3000/satelink/os/overview' },
  { name: 'mission-control', url: 'http://localhost:3000/satelink/os/mission-control' },
  { name: 'nodes', url: 'http://localhost:3000/satelink/os/nodes' },
  { name: 'monitoring', url: 'http://localhost:3000/satelink/os/monitoring' },
  { name: 'command-center', url: 'http://localhost:3000/admin/command-center' },
  { name: 'usage', url: 'http://localhost:3000/satelink/os/usage' }
];

const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 375, height: 812 }
];

const outputDir = path.join('/Users/pradeepjakuraa/.gemini/antigravity-ide/brain/6398ae4d-df64-4b5d-9be3-b6fefbb9669a/responsive');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

async function run() {
  const browser = await puppeteer.launch({ headless: 'new' });
  
  for (const pageInfo of pagesToTest) {
    const page = await browser.newPage();
    try {
      await page.goto(pageInfo.url, { waitUntil: 'networkidle2', timeout: 15000 });
      // wait for some components to render
      await new Promise(r => setTimeout(r, 2000));

      for (const vp of viewports) {
        await page.setViewport(vp);
        // Wait a bit for layout to settle after resize
        await new Promise(r => setTimeout(r, 1000));
        
        const screenshotPath = path.join(outputDir, `${pageInfo.name}_${vp.name}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: false });
        console.log(`Saved screenshot: ${screenshotPath}`);
      }
    } catch (e) {
      console.error(`Error loading ${pageInfo.url}:`, e.message);
    }
    await page.close();
  }

  await browser.close();
  console.log("Visual verification complete.");
}

run();
