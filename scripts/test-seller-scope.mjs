// Vendeur limité à ses pages (accueil, commandes, caisse du jour) ; situation par page à l'accueil (total, espèces,
// MVola, Orange, Airtel, reste à payer, annulé, échange, reportées) ; livraison « à reporter » au plus 3 fois puis annulation.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const W = Number(process.argv[2] || 1280);
const p = await (await b.newContext({ viewport: { width: W, height: 900 }, timezoneId: 'Indian/Antananarivo' })).newPage();
const N = (t) => t.replace(/[\s  ]+/g, ' ');
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
const login = async (u) => { await p.getByLabel("Nom d'utilisateur").fill(u); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter'); await p.waitForTimeout(700); await p.getByRole('button', { name: 'Plus tard' }).click({ timeout: 1500 }).catch(() => {}); };
const logout = async () => { await p.goto('http://localhost:5173/#/compte'); await p.waitForTimeout(400); await p.locator('main').getByRole('button', { name: 'Se déconnecter' }).click(); await p.waitForTimeout(400); };
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await login('super-adm');
await p.evaluate(async () => {
  const t = window.__tsena; const now = new Date().toISOString(); const hash = t.get('users', 'user-superadmin').passwordHash;
  await t.save('categories', [{ id: 'net', name: 'NETVISION' }, { id: 'box', name: 'BOXER' }]);
  await t.save('products', [{ id: 'n1', code: 'NET1', name: 'Lunette Net', categoryId: 'net', priceRetail: 10000, active: true }, { id: 'b1', code: 'BOX1', name: 'Boxer Box', categoryId: 'box', priceRetail: 20000, active: true }]);
  await t.save('variants', [{ id: 'vn', productId: 'n1', sku: 'NET1', costAvg: 4000, active: true }, { id: 'vb', productId: 'b1', sku: 'BOX1', costAvg: 8000, active: true }]);
  await t.save('stockMoves', [{ variantId: 'vn', qty: 50, type: 'initial', at: now }, { variantId: 'vb', qty: 50, type: 'initial', at: now }]);
  await t.save('users', { id: 'u9', username: 'vendeur1', fullName: 'Hery Net', roleId: 'role-seller', active: true, passwordHash: hash, mustChangePassword: false, pageIds: ['net'] });
  await t.save('couriers', { id: 'k1', name: 'Fara', active: true });
  const L = (v, q, pr) => [{ id: 'l' + v + q, variantId: v, qty: q, unitPrice: pr, qtyKept: q, qtyReturned: 0 }];
  const pay = (amount, method) => ({ id: 'p' + Math.random(), at: now, amount, method, receivedBy: 'shop' });
  await t.save('orders', [
    { id: 'S1', number: 'V-1', kind: 'order', channel: 'shop', phone: '', status: 'delivered', lines: L('vn', 1, 10000), payments: [pay(5000, 'cash'), pay(5000, 'mvola')], discount: 0, deliveryFee: 0, createdAt: now, dispatchedAt: now, returnedAt: now, createdBy: 'user-superadmin', createdByName: 'Super-admin' },
    { id: 'S2', number: 'V-2', kind: 'order', channel: 'shop', phone: '', status: 'delivered', lines: L('vb', 1, 20000), payments: [pay(20000, 'airtel')], discount: 0, deliveryFee: 0, createdAt: now, dispatchedAt: now, returnedAt: now },
    { id: 'S3', number: 'V-3', kind: 'order', channel: 'shop', phone: '', status: 'delivered', lines: L('vn', 2, 10000), payments: [pay(12000, 'orange')], discount: 0, deliveryFee: 0, createdAt: now, dispatchedAt: now, returnedAt: now },
    { id: 'C4', number: 'C-4', kind: 'order', channel: 'facebook', phone: '0340000004', name: 'Annule', status: 'cancelled', statusDates: { cancelled: now }, lines: [{ id: 'x', variantId: 'vn', qty: 3, unitPrice: 10000 }], payments: [], discount: 0, deliveryFee: 0, createdAt: now },
    { id: 'E5', number: 'E-5', kind: 'exchange', channel: 'facebook', phone: '0340000005', name: 'Echange', status: 'new', lines: [{ id: 'y', variantId: 'vn', qty: 1, unitPrice: 10000 }], payments: [], discount: 0, deliveryFee: 0, createdAt: now },
    { id: 'C8', number: 'C-8', kind: 'order', channel: 'facebook', phone: '0340000008', name: 'Reporte', status: 'ready', reports: [{ at: now, to: '2099-01-01', reason: 'Client absent' }], wantedDate: '2099-01-01', lines: [{ id: 'r8', variantId: 'vn', qty: 1, unitPrice: 10000 }], payments: [], discount: 0, deliveryFee: 0, createdAt: now },
    { id: 'C7', number: 'C-7', kind: 'order', channel: 'facebook', phone: '0340000007', name: 'Box client', status: 'new', lines: [{ id: 'z', variantId: 'vb', qty: 1, unitPrice: 20000 }], payments: [], discount: 0, deliveryFee: 0, createdAt: now },
  ]);
  await t.save('stockMoves', [{ variantId: 'vn', qty: -1, type: 'sale', refType: 'order', refId: 'S1', at: now }, { variantId: 'vb', qty: -1, type: 'sale', refType: 'order', refId: 'S2', at: now }, { variantId: 'vn', qty: -2, type: 'sale', refType: 'order', refId: 'S3', at: now }]);
  // Commande partie avec le livreur : le client demande de reporter
  await t.save('orders', { id: 'C6', number: 'C-6', kind: 'order', channel: 'facebook', phone: '0340000006', name: 'Rasoa', zoneId: 'zone-ville', status: 'out', courierId: 'k1', dispatchedAt: now, lines: [{ id: 'w', variantId: 'vn', qty: 2, unitPrice: 10000 }], payments: [], discount: 0, deliveryFee: 3000, createdAt: now });
  await t.save('stockMoves', { variantId: 'vn', qty: -2, type: 'dispatch', refType: 'order', refId: 'C6', at: now });
});
const stock = (v) => p.evaluate((id) => window.__tsena.all('stockMoves').filter((m) => m.variantId === id).reduce((s, m) => s + m.qty, 0), v);
// 1. Gérant : situation par page
await p.goto('http://localhost:5173/#/'); await p.waitForTimeout(900);
let tx = N(await p.locator('.situation-card').innerText());
ok(tx.includes('Situation par page') && tx.includes('NETVISION') && tx.includes('BOXER'), 'gérant : situation de toutes les pages');
ok(tx.includes('Total commandes 110 000 Ar') && tx.includes('− Annulé 30 000 Ar') && tx.includes('− Reporté 10 000 Ar') && tx.includes('= Ventes 70 000 Ar'), 'total commandes 110 000 − annulé 30 000 − reporté 10 000 = ventes 70 000');
ok(tx.includes('Espèces 5 000 Ar') && tx.includes('MVola 5 000 Ar') && tx.includes('Orange Money 12 000 Ar') && tx.includes('Airtel Money 20 000 Ar') && tx.includes('Reste à payer 28 000 Ar'), 'ventes = espèces 5 000 + MVola 5 000 + Orange 12 000 + Airtel 20 000 + reste 28 000');
ok(!tx.includes('Échange 10 000'), 'échange pas encore pris par le client : pas compté');
// 2. À reporter : 3 fois au plus, puis annulation
for (let i = 1; i <= 3; i++) {
  if (i > 1) await p.evaluate(async () => { const t = window.__tsena; await t.save('orders', { id: 'C6', status: 'out', courierId: 'k1', dispatchedAt: new Date().toISOString() }); await t.save('stockMoves', { variantId: 'vn', qty: -2, type: 'dispatch', refType: 'order', refId: 'C6', at: new Date().toISOString() }); });
  await p.goto('http://localhost:5173/#/commandes/C6'); await p.waitForTimeout(500);
  await p.getByRole('button', { name: `À reporter (${i - 1}/3)` }).click(); await p.waitForTimeout(200);
  await p.getByRole('dialog').getByRole('button', { name: `Reporter (${i}/3)` }).click(); await p.waitForTimeout(500);
}
const o6 = await p.evaluate(() => window.__tsena.get('orders', 'C6'));
ok(o6.reports.length === 3 && o6.status === 'ready' && !o6.courierId && o6.wantedDate, `3 reports notés, commande en attente de livraison avec la nouvelle date (${o6.status})`);
ok(await stock('vn') === 50 - 3 - 0, `colis revenu en boutique à chaque report : stock NET ${await stock('vn')}`);
tx = N(await p.locator('main').innerText());
ok(tx.includes('Reportée 3/3'), 'badge « Reportée 3/3 »');
await p.getByRole('button', { name: 'Reportée 3 fois : annuler ?' }).click(); await p.waitForTimeout(200);
ok(N(await p.getByRole('dialog').innerText()).includes('déjà fait reporter cette livraison 3 fois'), 'après 3 reports : annulation proposée');
await p.getByRole('dialog').getByRole('button', { name: 'Annuler la commande' }).click(); await p.waitForTimeout(500);
ok((await p.evaluate(() => window.__tsena.get('orders', 'C6'))).status === 'cancelled', 'commande annulée après 3 reports');
// 3. Vendeur NETVISION : seulement sa page
await logout(); await login('vendeur1');
await p.goto('http://localhost:5173/#/'); await p.waitForTimeout(900);
tx = N(await p.locator('main').innerText());
const sit = N(await p.locator('.situation-card').innerText());
ok(sit.includes('Situation de mes pages') && sit.includes('NETVISION') && !sit.includes('BOXER'), 'vendeur : situation de sa page seulement');
ok(sit.includes('= Ventes 30 000 Ar') && !sit.includes('Airtel Money 20 000'), 'vendeur : ventes de sa page seulement (30 000), pas le total de tous');
ok(sit.includes('− Annulé 50 000 Ar') && sit.includes('− Reporté 10 000 Ar') && sit.includes('Total commandes 90 000 Ar'), 'commande annulée après 3 reports : seulement dans « annulé » ; total 90 000');
await p.goto('http://localhost:5173/#/commandes/enregistrees'); await p.waitForTimeout(500);
tx = N(await p.locator('main').innerText());
ok(tx.includes('Echange') && !tx.includes('Box client') && await p.locator('.scope-bar button').count() === 0, 'commandes : seulement celles de sa page, pas de bouton « Tout »');
await p.goto('http://localhost:5173/#/caisse-du-jour'); await p.waitForTimeout(500);
tx = N(await p.locator('main').innerText());
ok(tx.includes('Ventes de mes pages') && tx.includes('30 000 Ar') && !tx.includes('50 000 Ar'), 'caisse du jour : ventes de sa page seulement');
const sw = await p.evaluate(() => document.documentElement.scrollWidth); ok(sw <= W + 1, `pas de débordement (${sw})`);
console.log(fail ? `${fail} ÉCHEC(S)` : 'TOUT EST BON'); await b.close();
