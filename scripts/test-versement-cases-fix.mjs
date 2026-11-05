// Versements : Total ventes, 1er et 2ème paiement espèces corrigeables à la main (✏️), comme MVola / Orange.
// Le montant corrigé est totalisé ; le total à payer suit ; un versement déjà reçu est réenregistré (mêmes espèces du jour).
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 }, timezoneId: 'Indian/Antananarivo' })).newPage();
const N = (t) => t.replace(/[  ]/g, ' ').replace(/\s+/g, ' ');
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
await p.evaluate(async () => {
  const t = window.__tsena; const now = new Date().toISOString(); const ago = (n) => new Date(Date.now() - n * 864e5).toISOString(); const hash = t.get('users', 'user-superadmin').passwordHash;
  await t.save('categories', [{ id: 'pp', name: 'Poignet précieux' }]);
  await t.save('products', [{ id: 'a', code: 'A', name: 'Montre', categoryId: 'pp', priceRetail: 15000, active: true }]);
  await t.save('variants', [{ id: 'va', productId: 'a', sku: 'A', costAvg: 5000, active: true }]);
  await t.save('stockMoves', [{ variantId: 'va', qty: 50, type: 'initial', at: now }]);
  await t.save('users', [{ id: 'u1', username: 'aina', fullName: 'Aina', roleId: 'role-seller', active: true, passwordHash: hash, mustChangePassword: false, pageIds: ['pp'] }]);
  const shop = (id, at, pays) => ({ id, number: id, kind: 'order', channel: 'shop', phone: '', status: 'delivered', lines: [{ id: 'l' + id, variantId: 'va', qty: 1, unitPrice: 15000, qtyKept: 1 }], payments: pays.map(([a, m, w], i) => ({ id: `p${id}${i}`, at: w, amount: a, method: m, receivedBy: 'shop' })), discount: 0, deliveryFee: 0, createdBy: 'u1', createdByName: 'Aina', createdAt: at });
  await t.save('orders', [shop('S1', now, [[15000, 'cash', now]]), shop('O1', ago(1), [[5000, 'cash', ago(1)], [10000, 'cash', now]])]);
});
await p.goto('http://localhost:5173/#/versements'); await p.waitForTimeout(800);
const row = () => p.locator('.handover-table tbody tr', { hasText: 'Poignet précieux' }).first();
const cells = async () => (await row().locator('td').allInnerTexts()).map(N);
const foot = async () => N(await p.locator('.handover-table tfoot').first().innerText());
let c = await cells(); console.log('ligne', JSON.stringify(c));
const n1 = c[3];
ok(/10 000 Ar/.test(n1) || /10 000 Ar/.test(c[4]), `un paiement espèces d'une vente d'hier (10 000) (${c[3]} | ${c[4]})`);
const col = /10 000 Ar/.test(n1) ? 'n1' : 'n2', idx = col === 'n1' ? 3 : 4, label = col === 'n1' ? '1er paiement espèces' : '2ème paiement espèces';
// Total ventes
await row().getByRole('button', { name: /Corriger Total ventes/ }).click();
await p.getByLabel('Total ventes de Poignet précieux').fill('14000'); await p.keyboard.press('Enter'); await p.waitForTimeout(400);
c = await cells();
ok(/14 000 Ar/.test(c[1]) && /calculé 15 000 Ar/.test(c[1]), `Total ventes corrigé 14 000, calcul 15 000 visible (${c[1]})`);
ok(/^Total 14 000 Ar/.test(await foot()), `total des ventes = 14 000 (${await foot()})`);
// reçu comme calculé
await row().getByRole('button', { name: /Reçu comme calculé/ }).click(); await p.waitForTimeout(500);
const amt = () => p.evaluate(() => window.__tsena.all('handovers').filter((h) => h.status === 'received').map((h) => h.amount));
ok(JSON.stringify(await amt()) === '[25000]', `versement reçu 25 000 (${JSON.stringify(await amt())})`);
// 1er / 2ème paiement corrigé après réception
await row().getByRole('button', { name: new RegExp(`Corriger ${label}`) }).click();
await p.getByLabel(`${label} de Poignet précieux`).fill('9000'); await p.keyboard.press('Enter'); await p.waitForTimeout(600);
c = await cells();
ok(/9 000 Ar/.test(c[idx]) && /calculé 10 000 Ar/.test(c[idx]), `${label} corrigé 9 000 (${c[idx]})`);
ok(/^15 000 Ar/.test(c[2]) && !/chiffres changés/.test(c[2]), `espèces du jour restent 15 000, pas « chiffres changés » (${c[2]})`);
ok(/24 000 Ar/.test(c[c.length - 1]), `total à payer = 24 000 (${c[c.length - 1]})`);
ok(JSON.stringify(await amt()) === '[24000]', `versement réenregistré à 24 000 (${JSON.stringify(await amt())})`);
// remettre
await row().locator('td').nth(idx).getByRole('button', { name: 'remettre' }).click(); await p.waitForTimeout(600);
c = await cells();
ok(/25 000 Ar/.test(c[c.length - 1]) && JSON.stringify(await amt()) === '[25000]', `remettre : retour à 25 000 (${c[c.length - 1]})`);
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); await b.close(); process.exit(fail ? 1 : 0);
