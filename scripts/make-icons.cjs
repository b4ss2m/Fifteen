// Renders the PNG app icons from public/icons/icon.svg. The PNGs are committed, so this is
// only needed after a redesign. Needs Playwright: `npx playwright install chromium` first.
const { readFileSync } = require('node:fs');
const { chromium } = require('playwright');

(async () => {
  const svg = readFileSync('public/icons/icon.svg', 'utf8');
  const browser = await chromium.launch();
  for (const size of [180, 192, 512]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<style>html,body{margin:0;background:#202228}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
    await page.screenshot({ path: `public/icons/icon-${size}.png` });
    await page.close();
  }
  await browser.close();
})();
