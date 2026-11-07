// Versements : « Restes impayés par page » — détail par jour avec chaque commande impayée et un bouton « Payé »
// qui ouvre « Paiement reçu » : le reste baisse tout de suite.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Indian/Antananarivo', deviceScaleFactor: Number(process.env.DPR || 1) })).newPage();
const N = (t) => t.replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
const days = await p.evaluate(async () => {
  const t = window.__tsena; const pad = (n) => String(n).padStart(2, '0');
  // jours de travail (pas dimanche) : d0 = vente, d1 = jour suivant (1er paiement)
  const at = (d, h = 10) => { const x = new Date(d); x.setHours(h, 0, 0, 0); return x.toISOString(); };
  const back = (n) => { const x = new Date(); x.setDate(x.getDate() - n); return x; };
  let k = 2; while (back(k).getDay() === 0 || back(k - 1).getDay() === 0) k++;
  const d0 = back(k), d1 = back(k - 1); const day = (x) => `${pad(x.getDate())}/${pad(x.getMonth() + 1)}/${String(x.getFullYear()).slice(2)}`;
  await t.save('categories', [{ id: 'nv', name: 'Netvision' }, { id: 'pp', name: 'Poignet précieux' }]);
  await t.save('products', [{ id: 'a', code: 'A', name: 'Casque', categoryId: 'nv', priceRetail: 10000, active: true }, { id: 'b', code: 'B', name: 'Montre', categoryId: 'pp', priceRetail: 10000, active: true }]);
  await t.save('variants', [{ id: 'va', productId: 'a', sku: 'A', costAvg: 5000, active: true }, { id: 'vb', productId: 'b', sku: 'B', costAvg: 5000, active: true }]);
  const o = (id, v, amount, d, x) => ({ id, number: id, kind: 'order', channel: 'facebook', phone: '0340000000', name: 'Client ' + id, status: 'delivered', lines: [{ id: 'l' + id, variantId: v, qty: 1, unitPrice: amount }], payments: [], discount: 0, deliveryFee: 0, createdAt: at(d, 8), dispatchedAt: at(d), ...x });
  await t.save('orders', [
    o('N1', 'va', 90000, d0, { payments: [{ id: 'p1', at: at(d1), amount: 40000, method: 'mvola', receivedBy: 'shop' }] }),
    o('N2', 'va', 30000, d0, { status: 'cancelled', notes: 'Annulée : client injoignable', statusDates: { cancelled: at(d1) } }),
    o('N3', 'va', 25000, d1, { status: 'out' }),
    o('P1', 'vb', 20000, d0, {}),
    o('P2', 'vb', 15000, d1, { payments: [{ id: 'p2', at: at(new Date()), amount: 15000, method: 'mvola', receivedBy: 'shop' }] }), // soldée plus tard
    o('X1', 'vb', 50000, d0, { status: 'cancelled', dispatchedAt: undefined }), // jamais partie : pas une vente
  ]);
  return { d0: day(d0), d1: day(d1) };
});
await p.goto('http://localhost:5173/#/versements'); await p.waitForTimeout(900);
const card = p.locator('.card', { has: p.getByRole('heading', { name: /Restes impayés par page/ }) });
const total = async () => N(await card.locator('.card-pad strong.num').first().innerText());
ok(await total() === '95 000 Ar', `total impayé 95 000 (${await total()})`);
await card.locator('tr.row-link', { hasText: 'Netvision' }).click(); await p.waitForTimeout(300);
const orders = (await card.locator('.rest-order').allInnerTexts()).map(N);
console.log(orders.join('\n'));
ok(orders.some((r) => /^N1 Client N1 50 000 Ar Payé$/.test(r)), 'N1 : client et reste 50 000 avec bouton Payé');
ok(orders.some((r) => /^N3 Client N3 25 000 Ar Payé$/.test(r)), 'N3 : reste 25 000 avec bouton Payé');
if (process.env.SHOT) { await card.scrollIntoViewIfNeeded(); await card.screenshot({ path: process.env.SHOT }); }
await card.locator('.rest-order', { hasText: 'N1' }).getByRole('button', { name: 'Payé' }).click(); await p.waitForTimeout(300);
const dlg = p.getByRole('dialog');
ok(/Paiement reçu — N1/.test(await dlg.innerText()), 'fenêtre Paiement reçu — N1');
if (process.env.SHOT2) await dlg.screenshot({ path: process.env.SHOT2 });
await dlg.getByRole('button', { name: 'Enregistrer' }).click(); await p.waitForTimeout(600);
ok(await total() === '45 000 Ar', `après Payé : total impayé 45 000 (${await total()})`);
ok(await p.evaluate(() => window.__tsena.get('orders', 'N1').payments.length === 2), 'paiement ajouté à N1');
if (process.env.SHOT3) await card.screenshot({ path: process.env.SHOT3 });
await card.locator('.rest-order', { hasText: 'N3' }).dblclick(); await p.waitForTimeout(500);
ok(p.url().endsWith('#/commandes/N3'), `double-clic : la commande N3 s’ouvre (${p.url()})`);
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); await b.close(); process.exit(fail ? 1 : 0);
