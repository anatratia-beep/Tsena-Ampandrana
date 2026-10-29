// Versements : vue PAR PAGE (par défaut), espèces reçues saisies et corrigées directement dans le tableau ;
// la vue par vendeur reste disponible et ses chiffres ne changent pas.
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
const roles = await p.evaluate(() => ({ seller: window.__tsena.get('roles', 'role-seller'), manager: window.__tsena.get('roles', 'role-manager') }));
ok(roles.manager?.name === 'Responsable' && roles.manager.permissions.includes('orders.dispatch') && roles.manager.permissions.includes('handover.receive'), 'rôle Responsable : assigne les livreurs et reçoit les versements');
ok(!roles.seller.permissions.includes('orders.dispatch') && roles.seller.permissions.includes('handover.self'), 'rôle Vendeur : ne remet pas les colis au livreur (le responsable le fait), voit sa feuille');
await p.evaluate(async () => {
  const t = window.__tsena; const now = new Date().toISOString(); const hash = t.get('users', 'user-superadmin').passwordHash;
  await t.save('categories', [{ id: 'pp', name: 'Poignet précieux' }, { id: 'is', name: 'Intimity style' }]);
  await t.save('products', [{ id: 'a', code: 'A', name: 'Montre', categoryId: 'pp', priceRetail: 15000, active: true }, { id: 'bx', code: 'B', name: 'Boxer', categoryId: 'is', priceRetail: 10000, active: true }]);
  await t.save('variants', [{ id: 'va', productId: 'a', sku: 'A', costAvg: 5000, active: true }, { id: 'vb', productId: 'bx', sku: 'B', costAvg: 4000, active: true }]);
  await t.save('stockMoves', [{ variantId: 'va', qty: 50, type: 'initial', at: now }, { variantId: 'vb', qty: 50, type: 'initial', at: now }]);
  await t.save('users', [
    { id: 'u1', username: 'aina', fullName: 'Aina', roleId: 'role-seller', active: true, passwordHash: hash, mustChangePassword: false, pageIds: ['pp'] },
    { id: 'u2', username: 'bako', fullName: 'Bako', roleId: 'role-seller', active: true, passwordHash: hash, mustChangePassword: false, pageIds: ['is'] },
    { id: 'u3', username: 'resp', fullName: 'Rindra', roleId: 'role-manager', active: true, passwordHash: hash, mustChangePassword: false },
  ]);
  await t.save('zones', { id: 'z1', name: 'Analakely', fee: 3000, active: true });
  await t.save('couriers', { id: 'c1', name: 'Faly', active: true });
  const shop = (id, by, name, v, q, price, method) => ({ id, number: id, kind: 'order', channel: 'shop', phone: '', status: 'delivered', lines: [{ id: 'l' + id, variantId: v, qty: q, unitPrice: price, qtyKept: q }], payments: [{ id: 'p' + id, at: now, amount: q * price, method, receivedBy: 'shop' }], discount: 0, deliveryFee: 0, createdBy: by, createdByName: name, createdAt: now });
  await t.save('orders', [
    shop('S1', 'u1', 'Aina', 'va', 2, 15000, 'cash'),
    shop('S2', 'u1', 'Aina', 'vb', 1, 10000, 'mvola'),
    { id: 'D1', number: 'D1', kind: 'order', channel: 'facebook', phone: '0340000000', zoneId: 'z1', courierId: 'c1', status: 'delivered', lines: [{ id: 'ld', variantId: 'va', qty: 1, unitPrice: 15000, qtyKept: 1, qtyReturned: 0 }], deliveryFee: 3000, feeCharged: 3000, discount: 0,
      payments: [{ id: 'pd', at: now, amount: 18000, method: 'cash', receivedBy: 'courier', courierId: 'c1' }], dispatchedAt: now, returnedAt: now, courierSettledAt: now, createdBy: 'u1', createdByName: 'Aina', createdAt: now },
    shop('S3', 'u2', 'Bako', 'vb', 2, 10000, 'cash'),
  ]);
  await t.save('cashMoves', { at: now, account: 'cash', amount: -2000, type: 'expense', label: 'Taxi', userName: 'Aina' });
});
await p.goto('http://localhost:5173/#/versements'); await p.waitForTimeout(800);
let tx = N(await p.locator('main').innerText());
ok(/Par page/.test(tx) && /Page par page/i.test(tx), 'vue « Par page » affichée par défaut');
const row = (name) => p.locator('.handover-table tbody tr', { hasText: name });
let rA = N(await row('Poignet précieux').innerText()).replace(/\s+/g, ' ');
ok(/Poignet précieux Aina 45 000 Ar 48 000 Ar — — — − 3 000 Ar 45 000 Ar/.test(rA), `Poignet précieux : ventes 45 000, espèces 48 000, frais − 3 000, à payer 45 000 (${rA})`);
let rB = N(await row('Intimity style').innerText()).replace(/\s+/g, ' ');
ok(/Intimity style Aina, Bako 30 000 Ar 20 000 Ar 10 000 Ar — — — 20 000 Ar/.test(rB), `Intimity style : ventes 30 000, espèces 20 000, MVola 10 000, à payer 20 000 (${rB})`);
ok(/Total\s+75 000 Ar\s+68 000 Ar\s+10 000 Ar\s+0 Ar\s+0 Ar\s+3 000 Ar\s+65 000 Ar\s+0 Ar/.test(tx), 'ligne Total : 75 000 ventes, 65 000 à payer (comme par vendeur)');
// Saisie directe des espèces reçues
await row('Poignet précieux').getByLabel(/Espèces reçues de/).fill('40000');
await row('Poignet précieux').getByLabel(/Espèces reçues de/).press('Enter'); await p.waitForTimeout(500);
let hs = await p.evaluate(() => window.__tsena.all('handovers'));
ok(hs.length === 1 && hs[0].amount === 40000 && hs[0].expected === 45000 && hs[0].gap === -5000 && hs[0].userName === 'Poignet précieux', 'page Poignet précieux : 40 000 reçu, écart −5 000');
rA = N(await row('Poignet précieux').innerText()).replace(/\s+/g, ' ');
ok(rA.includes('40 000 Ar') && rA.includes('écart − 5 000 Ar'), `montant reçu affiché avec l’écart (${rA})`);
// Correction
await row('Poignet précieux').getByRole('button', { name: 'Corriger le montant reçu' }).click();
await row('Poignet précieux').getByLabel(/Espèces reçues de/).fill('45000');
await row('Poignet précieux').getByRole('button', { name: 'Valider le montant reçu' }).click(); await p.waitForTimeout(500);
hs = await p.evaluate(() => window.__tsena.all('handovers'));
ok(hs.length === 1 && hs[0].status === 'received' && hs[0].amount === 45000 && hs[0].gap === 0, 'correction : 45 000, plus d’écart');
const au = await p.evaluate(() => window.__tsena.all('audit').filter((a) => /Versement vendeur/.test(a.action)).map((a) => a.action));
ok(au.includes('Versement vendeur annulé') && au.filter((a) => a === 'Versement vendeur reçu').length === 2, 'ancien montant tracé dans le journal');
// Les vendeurs ne sont pas touchés
await p.getByRole('button', { name: 'Par vendeur' }).click(); await p.waitForTimeout(300);
tx = N(await p.locator('main').innerText());
const rowS = N(await p.locator('tr.row-link', { hasText: 'Aina' }).innerText()).replace(/\s+/g, ' ');
ok(rowS.includes('55 000 Ar') && rowS.includes('45 000 Ar') && rowS.includes('À recevoir'), `vue par vendeur inchangée : Aina 55 000 ventes, 45 000 à payer, à recevoir (${rowS})`);
await p.locator('tr.row-link', { hasText: 'Bako' }).getByLabel(/Espèces reçues de/).fill('20000');
await p.locator('tr.row-link', { hasText: 'Bako' }).getByLabel(/Espèces reçues de/).press('Enter'); await p.waitForTimeout(500);
ok(!(await p.getByRole('dialog').count()), 'saisir dans le tableau n’ouvre pas la fiche');
hs = await p.evaluate(() => window.__tsena.all('handovers').filter((h) => h.userId === 'u2'));
ok(hs.length === 1 && hs[0].amount === 20000 && hs[0].gap === 0, 'vendeur Bako : 20 000 reçu directement dans le tableau');
await p.getByRole('button', { name: 'Par page' }).click(); await p.waitForTimeout(300);
const sw = await p.evaluate(() => document.documentElement.scrollWidth); ok(sw <= W + 1, `pas de débordement (${sw})`);
await p.waitForTimeout(4500); await p.locator('.card', { hasText: 'Page par page' }).screenshot({ path: process.env.SHOT || '/tmp/versements-page.png' });
console.log(fail ? `${fail} ÉCHEC(S)` : 'TOUT EST BON'); await b.close(); process.exit(fail ? 1 : 0);
