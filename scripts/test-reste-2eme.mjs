// 1er / 2ème paiement du reste selon le jour : vente du samedi 10/10/2026 de 100 000 payée 20 000 le jour (espèces),
// 10 000 MVola le dimanche et 30 000 le lundi (1er paiement : jour de travail suivant ; la part MVola va dans le total MVola),
// 40 000 le mardi (2ème paiement).
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
  const sale = (id, day, pays) => ({ id, number: `V-${id}`, kind: 'order', channel: 'shop', status: 'delivered', name: 'Client', createdAt: at(day), createdBy: 'user-superadmin', createdByName: 'Admin', discount: 0, lines: [{ id: 'l', variantId: 'v1', qty: 1, unitPrice: 100000 }], payments: pays.map(([d, a, m], i) => ({ id: `${id}${i}`, at: at(d), amount: a, method: m, receivedBy: 'shop' })) });
  await t.save('orders', [
    sale('S1', '2026-10-10', [['2026-10-10', 20000, 'cash'], ['2026-10-11', 10000, 'mvola'], ['2026-10-12', 30000, 'cash'], ['2026-10-13', 40000, 'cash']]),
    sale('S2', '2026-10-13', [['2026-10-15', 50000, 'cash']]),
  ]);
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
ok(/Espèces\s*20 000 Ar/.test(tx) && /MVola\s*10 000 Ar/.test(tx) && /1er paiement du reste\s*30 000 Ar/.test(tx) && /2ème paiement du reste\s*40 000 Ar/.test(tx) && /Reste à payer\s*0 Ar/.test(tx), 'samedi : espèces 20 000, 1er paiement (dimanche MVola → total MVola 10 000 ; lundi espèces 30 000), 2ème paiement (mardi) 40 000, reste 0');
if (fail) console.log(tx.slice(0, 900));
tx = await day('2026-10-13');
ok(/1er paiement du reste\s*0 Ar/.test(tx) && /2ème paiement du reste\s*50 000 Ar/.test(tx) && /Reste à payer\s*50 000 Ar/.test(tx), 'mardi : rien le mercredi, 50 000 le jeudi → 2ème paiement, reste 50 000');
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); await b.close(); process.exit(fail ? 1 : 0);
