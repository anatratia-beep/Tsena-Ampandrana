// Accueil : « Stock final » — pièces en stock par page et total de toutes les pages.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 1280, height: 1000 }, timezoneId: 'Indian/Antananarivo' })).newPage();
const N = (t) => t.replace(/[\u00a0\u202f]/g, ' ');
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
await p.evaluate(async () => {
  const t = window.__tsena;
  await t.save('categories', [{ id: 'pA', name: 'Plateforme', code: 'PL', order: 1 }, { id: 'pB', name: 'Netvision', code: 'NV', order: 2 }, { id: 'sA', name: 'Talons', parentId: 'pA', code: 'TA', order: 1 }]);
  await t.save('products', [{ id: 'P1', code: 'T1', name: 'Talon', categoryId: 'sA', priceRetail: 30000, active: true, unit: 'pièce' }, { id: 'P2', code: 'N1', name: 'Câble', categoryId: 'pB', priceRetail: 5000, active: true, unit: 'pièce' }]);
  await t.save('variants', [{ id: 'V1', productId: 'P1', sku: 'T1-36', size: '36', active: true, costAvg: 15000 }, { id: 'V2', productId: 'P1', sku: 'T1-37', size: '37', active: true, costAvg: 15000 }, { id: 'V3', productId: 'P2', sku: 'N1', active: true, costAvg: 2000 }]);
  await t.addMoves([{ variantId: 'V1', qty: 4, type: 'adjust' }, { variantId: 'V2', qty: 6, type: 'adjust' }, { variantId: 'V3', qty: 25, type: 'adjust' }]);
});
await p.goto('http://localhost:5173/#/'); await p.waitForTimeout(800);
const card = p.locator('.card').filter({ has: p.getByRole('heading', { name: 'Stock final' }) });
ok(await card.count() === 1, 'carte « Stock final » sur l’accueil');
const tx = N(await card.innerText());
console.log(tx);
ok(tx.includes('Toutes les pages') && tx.includes('35 pcs'), 'total de toutes les pages : 35 pièces');
ok(/Plateforme\s+10\s+2/.test(tx) && /Netvision\s+25\s+1/.test(tx), 'détail par page (pièces, variantes ; sous-catégories comptées dans leur page)');
ok(tx.includes('425 000') && tx.includes('200 000'), 'valeurs au prix de vente (425 000) et au coût (200 000)');
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); await b.close(); process.exit(fail ? 1 : 0);
