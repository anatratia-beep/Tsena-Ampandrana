// Rapport patron : cases « Versement de la semaine » (total ventes, espèces, MVola, Orange Money reçus).
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
await p.evaluate(async () => {
  const t = window.__tsena; const now = new Date().toISOString();
  const o = t.all('orders').find((x) => x.id === 'S1');
  await t.save('orders', [{ ...o, payments: [...o.payments, { id: 'pm', at: now, amount: 20000, method: 'mvola', receivedBy: 'shop' }], lines: [{ ...o.lines[0], qty: 2, qtyKept: 2 }] }]);
});
await p.goto('http://localhost:5173/#/versements'); await p.waitForTimeout(800);
for (const [l, v] of [['Espèces réellement reçu', '25000'], ['MVola réellement reçu', '21000'], ['Orange Money réellement reçu', '0']]) { await p.getByLabel(l).fill(v); await p.keyboard.press('Tab'); await p.waitForTimeout(250); }
await p.goto('http://localhost:5173/#/rapports/patron'); await p.waitForTimeout(900);
const sec = p.locator('.boss-week');
const txt = N(await sec.innerText()); console.log(txt);
ok(/versement de la semaine du/i.test(txt), 'titre semaine');
ok(/Espèces 25 000 Ar calcul 30 000 Ar/.test(txt), 'espèces reçues 25 000 (calcul 30 000)');
ok(/MVola 21 000 Ar calcul 20 000 Ar/.test(txt), 'MVola reçu 21 000 (calcul 20 000)');
ok(/Orange Money 0 Ar calcul 0 Ar/.test(txt), 'Orange 0');
ok(/45 000 Ar/.test(txt), 'vente semaine 45 000');
ok(/Sommes 46 000 Ar Différence : \+ 1 000 Ar/.test(txt), 'sommes 46 000, différence + 1 000');
const ow = await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1); ok(ow, 'pas de débordement');
if (process.env.SHOT) await sec.screenshot({ path: process.env.SHOT });
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); await b.close(); process.exit(fail ? 1 : 0);
