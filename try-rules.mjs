import { chromium } from 'playwright';
const BASE = 'http://localhost:3000';
const CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PRIYA = '00000000-0000-4000-8000-000000000001';
const browser = await chromium.launch({ executablePath: CHROMIUM });
const ctx = await browser.newContext({ baseURL: BASE });
await ctx.addCookies([{ name: 'orbit_user', value: PRIYA, url: BASE }]);
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
async function settle() { await page.waitForLoadState('networkidle').catch(()=>{}); await page.waitForTimeout(700); }

await page.goto('/rules');
await settle();
console.log('--- LIST ---');
console.log((await page.locator('main').innerText()).slice(0, 2200));

const rows = page.locator('a[href^="/rules/"]');
console.log('rule rows:', await rows.count());
await rows.first().click();
await page.waitForLoadState('domcontentloaded');
await settle();
console.log('--- DETAIL URL ---', page.url());
console.log((await page.locator('main').innerText()).slice(0, 2500));

console.log('--- DRY RUN ---');
await page.getByRole('button', { name: /Dry run/ }).click();
await settle();
console.log(page.url());
const preview = await page.locator('section', { hasText: 'Preview' }).first().innerText();
console.log(preview.slice(0, 2500));
console.log('--- AUDIT ---');
console.log((await page.locator('aside').innerText()).slice(0, 1200));
await browser.close();
