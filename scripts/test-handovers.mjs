// Versements des vendeurs au responsable : calcul par vendeur (ventes par page, espèces, mobile money, frais livreurs,
// dépenses, total à payer), validation par le responsable, feuille du vendeur, rôle Responsable.
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
ok(!roles.seller.permissions.includes('orders.dispatch') && roles.seller.permissions.includes('handover.self'), 'rôle Vendeur : n’assigne plus les livreurs, voit sa feuille');
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
      payments: [{ id: 'pd', at: now, amount: 18000, method: 'cash', receivedBy: 'courier', courierId: 'c1' }], dispatchedAt: now, returnedAt: now, createdBy: 'u1', createdByName: 'Aina', createdAt: now },
    shop('S3', 'u2', 'Bako', 'vb', 2, 10000, 'cash'),
  ]);
  await t.save('cashMoves', { at: now, account: 'cash', amount: -2000, type: 'expense', label: 'Taxi', userName: 'Aina' });
});
await p.goto('http://localhost:5173/#/versements'); await p.waitForTimeout(800);
let tx = N(await p.locator('main').innerText());
ok(tx.includes('Versements des vendeurs') && tx.includes('Aina') && tx.includes('Bako'), 'tableau des vendeurs du jour');
const rowA = N(await p.locator('tr.row-link', { hasText: 'Aina' }).innerText());
ok(rowA.includes('55 000 Ar'), `Aina : total ventes 55 000 (${rowA.replace(/\s+/g, ' ')})`);
ok(rowA.includes('48 000 Ar') && rowA.includes('10 000 Ar'), 'Aina : espèces 48 000 (30 000 sur place + 18 000 du livreur), MVola 10 000');
ok(rowA.includes('3 000 Ar') && rowA.includes('2 000 Ar') && rowA.includes('43 000 Ar'), 'Aina : − frais livreur 3 000 − dépense 2 000 = 43 000 à payer');
ok(tx.includes('63 000 Ar'), 'total à payer de tous les vendeurs : 63 000');
await p.locator('tr.row-link', { hasText: 'Aina' }).click(); await p.waitForTimeout(300);
const dlg = p.getByRole('dialog');
tx = N(await dlg.innerText());
ok(tx.includes('Ventes — Poignet précieux') && tx.includes('45 000 Ar') && tx.includes('Ventes — Intimity style'), 'détail par page : Poignet précieux 45 000, Intimity style 10 000');
await dlg.getByLabel(/Montant reçu/).fill('40000'); await p.waitForTimeout(100);
ok(N(await dlg.innerText()).includes('Écart : -3 000 Ar') || N(await dlg.innerText()).includes('Écart : −3 000 Ar'), 'écart affiché avant validation');
await dlg.getByRole('button', { name: /Valider/ }).click(); await p.waitForTimeout(500);
const h = await p.evaluate(() => window.__tsena.all('handovers')[0]);
ok(h && h.amount === 40000 && h.expected === 43000 && h.gap === -3000 && h.userName === 'Aina', 'versement enregistré : reçu 40 000, attendu 43 000, écart −3 000');
tx = N(await p.locator('main').innerText());
ok(tx.includes('Historique des versements') && tx.includes('20 000 Ar'), 'historique + reste à recevoir (Bako 20 000)');
const [dl] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'Excel' }).click()]);
ok(dl.suggestedFilename().startsWith('versements-vendeurs_'), 'export Excel');
let sw = await p.evaluate(() => document.documentElement.scrollWidth); ok(sw <= W + 1, `pas de débordement (${sw})`);
// Le vendeur voit sa feuille
await p.goto('http://localhost:5173/#/compte'); await p.waitForTimeout(400);
await p.locator('main').getByRole('button', { name: 'Se déconnecter' }).click();
await p.waitForTimeout(400);
await p.getByLabel("Nom d'utilisateur").fill('aina'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter'); await p.waitForTimeout(600);
await p.goto('http://localhost:5173/#/versements'); await p.waitForTimeout(600);
tx = N(await p.locator('main').innerText());
ok(tx.includes('Ma feuille du jour') && tx.includes('TOTAL À PAYER') && tx.includes('43 000 Ar') && tx.includes('Reçu') && !tx.includes('Bako'), 'le vendeur voit seulement sa feuille et le montant reçu');
sw = await p.evaluate(() => document.documentElement.scrollWidth); ok(sw <= W + 1, `pas de débordement vendeur (${sw})`);
console.log(fail ? `${fail} ÉCHEC(S)` : 'TOUT EST BON'); await b.close();
