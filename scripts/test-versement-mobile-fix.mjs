// Versements : MVola / Orange Money corrigeables à la main (✏️) ; le montant corrigé est totalisé, le calcul reste
// affiché ; « remettre » revient au calcul. Les règlements de ventes des jours précédents restent en détail seulement.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const W = Number(process.argv[2] || 1280);
const p = await (await b.newContext({ viewport: { width: W, height: 900 }, timezoneId: 'Indian/Antananarivo', acceptDownloads: true })).newPage();
const N = (t) => t.replace(/[\u00a0\u202f]/g, ' ');
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
  await t.save('orders', [shop('S1', now, [[15000, 'mvola', now]]), shop('O1', ago(3), [[5000, 'cash', ago(3)], [10000, 'mvola', now]])]);
});
await p.goto('http://localhost:5173/#/versements'); await p.waitForTimeout(800);
const row = () => p.locator('.handover-table tbody tr', { hasText: 'Poignet précieux' }).first();
const foot = async () => N(await p.locator('.handover-table tfoot').first().innerText()).replace(/\s+/g, ' ');
let r = N(await row().innerText()).replace(/\s+/g, ' ');
ok(/15 000 Ar règlements 10 000 Ar/.test(r), `MVola du jour 15 000 ; règlement d'une vente d'avant (10 000) en détail seulement (${r})`);
await row().getByRole('button', { name: /Corriger MVola/ }).click();
await p.getByLabel('MVola de Poignet précieux').fill('12000'); await p.keyboard.press('Enter'); await p.waitForTimeout(400);
r = N(await row().innerText()).replace(/\s+/g, ' ');
ok(/12 000 Ar/.test(r) && /calculé 15 000 Ar/.test(r), `MVola corrigé : 12 000, calcul 15 000 affiché (${r})`);
ok(/Total .* 12 000 Ar/.test(await foot()), `total MVola = montant corrigé (${await foot()})`);
await row().getByRole('button', { name: 'remettre' }).click(); await p.waitForTimeout(400);
r = N(await row().innerText()).replace(/\s+/g, ' ');
ok(/15 000 Ar/.test(r) && !/calculé 15 000/.test(r), 'remettre : retour au calcul');
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); await b.close(); process.exit(fail ? 1 : 0);
