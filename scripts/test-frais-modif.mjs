// Versements : la case « Frais livreurs MVola / Orange Money » se corrige (✏️) comme les autres cases,
// et la correction compte dans les frais de livraison du rapport versement de la semaine.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 }, timezoneId: 'Indian/Antananarivo', deviceScaleFactor: Number(process.env.DPR || 1) })).newPage();
const N = (t) => t.replace(/[  ]/g, ' ').replace(/\s+/g, ' ');
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
await p.evaluate(async () => {
  const t = window.__tsena; const now = new Date().toISOString(); const hash = t.get('users', 'user-superadmin').passwordHash;
  await t.save('categories', [{ id: 'pp', name: 'Poignet précieux' }]);
  await t.save('products', [{ id: 'a', code: 'A', name: 'Montre', categoryId: 'pp', priceRetail: 15000, active: true }]);
  await t.save('variants', [{ id: 'va', productId: 'a', sku: 'A', costAvg: 5000, active: true }]);
  await t.save('stockMoves', [{ variantId: 'va', qty: 50, type: 'initial', at: now }]);
  await t.save('users', [{ id: 'u1', username: 'aina', fullName: 'Aina', roleId: 'role-seller', active: true, passwordHash: hash, mustChangePassword: false, pageIds: ['pp'] }]);
  await t.save('orders', [{ id: 'S1', number: 'S1', kind: 'order', channel: 'shop', phone: '', status: 'delivered', lines: [{ id: 'l1', variantId: 'va', qty: 1, unitPrice: 15000, qtyKept: 1 }], payments: [{ id: 'p1', at: now, amount: 15000, method: 'mvola', receivedBy: 'shop' }], discount: 0, deliveryFee: 0, createdBy: 'u1', createdByName: 'Aina', createdAt: now }]);
});
await p.goto('http://localhost:5173/#/versements'); await p.waitForTimeout(800);
const row = p.locator('.handover-table tbody tr', { hasText: 'Poignet précieux' }).first();
await row.getByRole('button', { name: /Corriger Frais livreurs MVola \/ Orange Money/ }).click();
await p.getByLabel('Frais livreurs MVola / Orange Money de Poignet précieux').fill('2500'); await p.keyboard.press('Enter'); await p.waitForTimeout(500);
const tbl = p.locator('.handover-table').first();
const txt = N(await tbl.innerText());
ok(/2 500 Ar calculé 0 Ar · remettre/.test(txt), `frais corrigé 2 500, calcul visible (${txt.slice(0, 300)})`);
const foot = N(await tbl.locator('tfoot').innerText());
ok(/2 500 Ar/.test(foot), `total frais 2 500 (${foot})`);
if (process.env.SHOT) await tbl.screenshot({ path: process.env.SHOT });
// Rapport versement de la semaine : les frais corrigés (frais de colis oubliés…) comptent dans les dépenses.
await p.goto('http://localhost:5173/#/rapports/versement-semaine'); await p.waitForTimeout(900);
const exp = p.locator('.bw-top-exp');
ok(/frais de livraison 2 500 Ar/.test(N(await exp.innerText())), `rapport de la semaine : frais de livraison 2 500 (${N(await exp.innerText())})`);
if (process.env.SHOT2) await exp.screenshot({ path: process.env.SHOT2 });
await p.goto('http://localhost:5173/#/versements'); await p.waitForTimeout(800);
await tbl.getByRole('button', { name: 'remettre' }).click(); await p.waitForTimeout(400);
ok(!/calculé 0 Ar/.test(N(await tbl.innerText())), 'remettre : revient au calcul');
await b.close();
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); process.exit(fail ? 1 : 0);
