// 1er / 2ème paiement en MVola / Orange Money : vente du samedi 10/10 de 100 000, MVola 15 000 le jour ; lundi 20 000 espèces +
// 30 000 MVola (1er paiement mixte) ; mardi 10 000 Orange (2ème paiement). Les cases 1er / 2ème ne gardent que les espèces.
// 10 000 le dimanche et 30 000 le lundi (1er paiement : jour de travail suivant), 40 000 le mardi (2ème paiement).
// Vente du mardi 13/10 : 50 000 le jeudi (2 jours après) → 2ème paiement, rien en 1er paiement.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 1280, height: 1000 }, timezoneId: 'Indian/Antananarivo' })).newPage();
const N = (t) => t.replace(/[  ]/g, ' ');
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
await p.evaluate(async () => {
  const t = window.__tsena; const at = (d) => `${d}T07:00:00.000Z`;
  await t.save('categories', [{ id: 'pg1', name: 'Hotel' }]);
  await t.save('products', [{ id: 'p1', code: 'SV', name: 'Savon', categoryId: 'pg1', priceRetail: 100000, active: true }]);
  await t.save('variants', [{ id: 'v1', productId: 'p1', sku: 'SV', active: true }]);
  await t.save('stockMoves', [{ variantId: 'v1', qty: 50, type: 'initial', at: at('2026-10-01') }]);
  await t.save('orders', [{ id: 'S1', number: 'V-S1', kind: 'order', channel: 'shop', status: 'delivered', name: 'Client', createdAt: at('2026-10-10'), createdBy: 'user-superadmin', createdByName: 'Admin', discount: 0, lines: [{ id: 'l', variantId: 'v1', qty: 1, unitPrice: 100000 }],
    payments: [['2026-10-10', 15000, 'mvola'], ['2026-10-12', 20000, 'cash'], ['2026-10-12', 30000, 'mvola'], ['2026-10-13', 10000, 'orange']].map(([d, a, m], i) => ({ id: `S1${i}`, at: at(d), amount: a, method: m, receivedBy: 'shop' })) }]);
});
const day = async (d) => {
  await p.goto('http://localhost:5173/#/'); await p.waitForTimeout(500);
  // Aujourd'hui, puis recule jour par jour jusqu'au jour voulu.
  await p.locator('.situation-card select').first().selectOption('today'); await p.waitForTimeout(200);
  const n = Math.round((Date.now() - new Date(`${d}T12:00:00+03:00`).getTime()) / 86400000);
  for (let i = 0; i < n; i++) await p.locator('.situation-card').getByRole('button', { name: /précédente/ }).first().click();
  await p.waitForTimeout(400);
  return N(await p.locator('.situation-card').innerText());
};
let tx = await day('2026-10-10');
ok(/MVola\s*45 000 Ar/.test(tx) && /Orange Money\s*10 000 Ar/.test(tx), 'MVola 15 000 + 1er paiement MVola 30 000 = 45 000 ; Orange 2ème paiement 10 000');
ok(/1er paiement du reste\s*20 000 Ar/.test(tx) && /2ème paiement du reste\s*0 Ar/.test(tx) && /Reste à payer\s*25 000 Ar/.test(tx), 'cases 1er / 2ème paiement : espèces seulement (20 000 / 0), reste 25 000');
await p.locator('.sit-table tbody button', { hasText: '45 000' }).first().click(); await p.waitForTimeout(200);
tx = N(await p.locator('.situation-card').innerText());
ok(/Jour de la vente : 15 000 Ar/.test(tx) && /1er paiement MVola : 30 000 Ar/.test(tx) && /Total : 45 000 Ar/.test(tx), 'détail MVola de la page (clic dans le tableau) : 15 000 + 30 000 = 45 000');
if (fail) console.log(tx.slice(0, 1500));
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); await b.close(); process.exit(fail ? 1 : 0);
