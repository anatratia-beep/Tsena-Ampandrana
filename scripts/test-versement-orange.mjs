// Versement par page : 1er / 2ème paiement en orange quand il ne correspond pas au « Suivi des restes par page ».
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
const idx = /10 000 Ar/.test(c[3]) ? 3 : 4, label = idx === 3 ? '1er paiement espèces' : '2ème paiement espèces';
const cell = () => row().locator('td').nth(idx);
ok(/10 000 Ar/.test(c[idx]), `paiement espèces d'une vente d'hier = 10 000 (${c[idx]})`);
ok(!(await cell().getAttribute('class')).includes('cell-mismatch'), 'même montant que le suivi : pas en orange');
await row().getByRole('button', { name: new RegExp(`Corriger ${label}`) }).click();
await p.getByLabel(`${label} de Poignet précieux`).fill('7000'); await p.keyboard.press('Enter'); await p.waitForTimeout(500);
c = await cells();
ok((await cell().getAttribute('class')).includes('cell-mismatch'), `7 000 au lieu de 10 000 : case en orange (${c[idx]})`);
ok(/suivi des restes : 10 000 Ar/.test(c[idx]), `montant du suivi affiché dessous (${c[idx]})`);
const color = await cell().locator('.mismatch-num').evaluate((e) => getComputedStyle(e).color);
ok(color === 'rgb(194, 97, 15)', `chiffre orange (${color})`);
if (process.env.SHOT) {
  await p.waitForTimeout(3500);
  await p.locator('.card', { hasText: 'Suivi des restes par page' }).first().screenshot({ path: process.env.SHOT.replace('.png', '-1.png') });
  await p.locator('.card', { hasText: 'Page par page' }).first().screenshot({ path: process.env.SHOT.replace('.png', '-2.png') });
}
await cell().getByRole('button', { name: 'remettre' }).click(); await p.waitForTimeout(500);
ok(!(await cell().getAttribute('class')).includes('cell-mismatch'), 'remettre : plus en orange');
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); await b.close(); process.exit(fail ? 1 : 0);
