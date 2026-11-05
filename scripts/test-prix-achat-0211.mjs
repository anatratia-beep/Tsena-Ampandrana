// Prix d'achat compté à part dès le 02/11/2026 : la vente interne « Pile » du 02/11 n'est plus une vente ; la ligne de la
// page reste visible (versement déjà reçu à 0 avec écart −38 524) et un ✏️ sur les espèces du jour enlève l'écart.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 }, timezoneId: 'Indian/Antananarivo' })).newPage();
const N = (t) => t.replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
await p.evaluate(async () => {
  const t = window.__tsena; const at = '2026-11-02T07:00:00.000Z';
  await t.save('categories', [{ id: 'pile', name: 'Pile' }]);
  await t.save('products', [{ id: 'a', code: 'A', name: 'Pile', categoryId: 'pile', priceRetail: 50000, active: true }]);
  await t.save('variants', [{ id: 'va', productId: 'a', sku: 'A', costAvg: 38524, active: true }]);
  await t.save('orders', [{ id: 'I1', number: 'I1', kind: 'order', channel: 'shop', internal: true, employeeName: 'Mbolatiana', status: 'delivered', lines: [{ id: 'l1', variantId: 'va', qty: 1, unitPrice: 38524, qtyKept: 1 }], payments: [{ id: 'p1', at, amount: 38524, method: 'cash', receivedBy: 'shop' }], discount: 0, deliveryFee: 0, createdBy: 'u1', createdByName: 'Mbolatiana', createdAt: at }]);
  await t.save('handovers', [{ id: 'ho_page:pile_2026-11-02', userId: 'page:pile', userName: 'Pile', date: '2026-11-02', amount: 0, expected: 38524, gap: -38524, status: 'received', at, byName: 'NJARA' }]);
});
await p.goto('http://localhost:5173/#/versements'); await p.waitForTimeout(600);
await p.getByLabel('Choisir le jour').fill('2026-11-02'); await p.waitForTimeout(600);
const row = () => p.locator('.handover-table tbody tr', { hasText: 'Pile' }).first();
ok(await row().count() === 1, 'ligne Pile encore visible (versement reçu)');
let c = (await row().locator('td').allInnerTexts()).map(N); console.log(JSON.stringify(c));
ok(/^0 Ar|^—/.test(c[1]), `Total ventes 0 (vente interne hors ventes) (${c[1]})`);
ok(/écart − 38 524/.test(c[2]), 'écart −38 524 encore là avant correction');
await row().getByRole('button', { name: /Corriger les espèces du jour/ }).click();
await p.getByLabel('Espèces du jour reçues de Pile').fill('0'); await p.keyboard.press('Enter'); await p.waitForTimeout(600);
c = (await row().locator('td').allInnerTexts()).map(N);
ok(!/écart/.test(c[2]), `après ✏️ 0 : plus d'écart (${c[2]})`);
const gaps = await p.evaluate(() => window.__tsena.all('handovers').filter((h) => h.status === 'received' && h.gap < -0.5).length);
ok(gaps === 0, 'plus d’impayé vendeur');
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); await b.close(); process.exit(fail ? 1 : 0);
