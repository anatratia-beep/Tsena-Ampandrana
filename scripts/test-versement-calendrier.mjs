// Versements : calendrier pour revoir le versement enregistré d'un jour passé (et boutons Aujourd'hui / Hier).
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Indian/Antananarivo' })).newPage();
const N = (t) => t.replace(/[  ]/g, ' ');
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const d3 = ymd(new Date(Date.now() - 3 * 864e5));
await p.evaluate(async (d3) => {
  const t = window.__tsena; const hash = t.get('users', 'user-superadmin').passwordHash; const at = `${d3}T10:00:00.000+03:00`;
  await t.save('categories', [{ id: 'pf', name: 'Batterie' }]);
  await t.save('products', [{ id: 'a', code: 'A', name: 'Batterie', categoryId: 'pf', priceRetail: 90000, active: true }]);
  await t.save('variants', [{ id: 'va', productId: 'a', sku: 'A', costAvg: 20000, active: true }]);
  await t.save('users', [{ id: 'u1', username: 'mbola', fullName: 'Mbolatiana', roleId: 'role-seller', active: true, passwordHash: hash, mustChangePassword: false, pageIds: ['pf'] }]);
  await t.save('orders', [{ id: 'W1', number: 'W1', kind: 'order', channel: 'shop', phone: '', status: 'delivered', lines: [{ id: 'l1', variantId: 'va', qty: 1, unitPrice: 90000, qtyKept: 1 }], discount: 0, deliveryFee: 0,
    payments: [{ id: 'p1', at, amount: 90000, method: 'cash', receivedBy: 'shop' }], createdBy: 'u1', createdByName: 'Mbolatiana', createdAt: at }]);
}, d3);
await p.goto('http://localhost:5173/#/versements'); await p.waitForTimeout(800);
ok(await p.locator('.handover-table tbody tr', { hasText: 'Batterie' }).count() === 0, "aujourd'hui : pas la ligne de ce jour-là");
await p.getByLabel('Choisir le jour').fill(d3); await p.waitForTimeout(500);
ok(N(await p.locator('.handover-table tbody tr', { hasText: 'Batterie' }).innerText()).includes('90 000 Ar'), 'calendrier : versement du jour choisi affiché');
await p.getByRole('button', { name: 'Hier' }).click(); await p.waitForTimeout(400);
ok(await p.getByLabel('Choisir le jour').inputValue() === ymd(new Date(Date.now() - 864e5)), 'bouton Hier');
await p.getByLabel('Choisir le jour').fill(d3); await p.waitForTimeout(400);
if (process.env.SHOT) await p.locator('main').screenshot({ path: process.env.SHOT });
await p.getByRole('button', { name: 'Aujourd’hui' }).click(); await p.waitForTimeout(300);
ok(await p.getByLabel('Choisir le jour').inputValue() === ymd(new Date()), 'bouton Aujourd’hui');
console.log(fail ? `${fail} ÉCHEC(S)` : 'TOUT EST BON'); await b.close(); process.exit(fail ? 1 : 0);
