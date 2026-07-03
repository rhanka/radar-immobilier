import { createRequire } from 'module';
const PW_BASES = [
  '/home/antoinefa/src/sent-tech/package.json',
  '/home/antoinefa/src/sentropic/e2e/package.json',
  '/home/antoinefa/src/openerp/package.json',
  '/home/antoinefa/src/mermaid-editor/package.json',
];
let chromium = null;
for (const base of PW_BASES) {
  try { chromium = createRequire(base)('playwright').chromium; if (chromium) { console.log('using playwright from', base); break; } } catch {}
}
if (!chromium) { console.error('no usable playwright found'); process.exit(3); }

const BASE = 'http://localhost:5301';
const out = '/home/antoinefa/src/radar-immobilier';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1024 } });
const page = await ctx.newPage();
const log = (...a) => console.log(...a);

async function dismissTour() {
  // The demo guided tour can overlay the app; try common skip affordances.
  for (const label of ['Passer', 'Passer la visite', 'Ignorer', 'Fermer', 'Skip', '×', 'Terminer']) {
    const b = page.getByRole('button', { name: new RegExp(label, 'i') });
    if (await b.count().catch(() => 0)) {
      try { await b.first().click({ timeout: 1500 }); log('dismissed tour via', label); return; } catch {}
    }
  }
}

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await dismissTour();
await page.waitForTimeout(500);

// Navigate to the Ontologie view (TopNav tab).
let clicked = false;
for (const loc of [
  page.getByRole('button', { name: /Ontologie/i }),
  page.getByRole('link', { name: /Ontologie/i }),
  page.getByText(/^Ontologie$/i),
]) {
  if (await loc.count().catch(() => 0)) {
    try { await loc.first().click({ timeout: 2000 }); clicked = true; log('clicked Ontologie'); break; } catch {}
  }
}
if (!clicked) log('WARN: Ontologie tab not found by text');

// Wait for real seeded content to render.
await page.waitForTimeout(1500);
try { await page.getByText(/4193751/).first().waitFor({ timeout: 8000 }); log('real lot 4193751 visible'); }
catch { log('WARN: lot 4193751 not visible yet'); }

await page.screenshot({ path: `${out}/uat-ontology-10-valleyfield.png`, fullPage: false });
await page.screenshot({ path: `${out}/uat-ontology-11-valleyfield-full.png`, fullPage: true });
log('captured Valleyfield');

// Switch city to Beauharnois if a selector exists.
for (const loc of [
  page.getByRole('combobox'),
  page.locator('select'),
]) {
  if (await loc.count().catch(() => 0)) {
    try { await loc.first().selectOption({ label: /Beauharnois/i }).catch(async () => {
      await loc.first().selectOption({ value: 'beauharnois' });
    }); log('selected Beauharnois'); break; } catch (e) { log('city select failed', e.message); }
  }
}
// Or a Beauharnois button/tab.
const bh = page.getByRole('button', { name: /Beauharnois/i });
if (await bh.count().catch(() => 0)) { try { await bh.first().click({ timeout: 2000 }); log('clicked Beauharnois'); } catch {} }

await page.waitForTimeout(1500);
try { await page.getByText(/4716029/).first().waitFor({ timeout: 6000 }); log('real lot 4716029 visible'); } catch { log('WARN: 4716029 not visible'); }
await page.screenshot({ path: `${out}/uat-ontology-20-beauharnois-full.png`, fullPage: true });
log('captured Beauharnois');

await browser.close();
log('DONE');
