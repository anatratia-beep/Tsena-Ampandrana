// Feuille du vendeur : argent du livreur compté le jour du règlement, « Reste à encaisser » (reste d'hier, ventes du jour).
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 1280, height: 1000 }, timezoneId: 'Indian/Antananarivo' })).newPage();
const N = (t) => t.replace(/[  ]/g, ' ');
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
await p.evaluate(async () => {
  const t = window.__tsena; const now = new Date(); const y = new Date(now.getTime() - 86400000); const Y = y.toISOString(), T = now.toISOString();
  const hash = t.get('users', 'user-superadmin').passwordHash;
  await t.save('users', [{ id: 'u1', username: 'aina', fullName: 'Aina', roleId: 'role-seller', active: true, passwordHash: hash, mustChangePassword: false, pageIds: ['pg1'] }]);
  await t.save('categories', [{ id: 'pg1', name: 'Pyjama' }]);
  await t.save('products', [{ id: 'p1', code: 'PJ', name: 'Pyjama', categoryId: 'pg1', priceRetail: 20000, active: true }]);
  await t.save('variants', [{ id: 'v1', productId: 'p1', sku: 'PJ', active: true }]);
  await t.save('stockMoves', [{ variantId: 'v1', qty: 50, type: 'initial', at: Y }]);
  await t.save('couriers', [{ id: 'k1', name: 'Solo', active: true }]);
  const o = (id, extra) => ({ id, number: id, kind: 'order', channel: 'facebook', phone: '0340000000', name: 'Client ' + id, zoneId: 'zone-centre', courierId: 'k1', deliveryFee: 0, dispatchedAt: Y, createdAt: Y, createdBy: 'u1', createdByName: 'Aina', discount: 0, lines: [{ id: 'l' + id, variantId: 'v1', qty: 1, unitPrice: 20000, qtyKept: 1, qtyReturned: 0 }], ...extra });
  const paid = (id, at) => [{ id: 'p' + id, at, amount: 20000, method: 'cash', receivedBy: 'courier', courierId: 'k1' }];
  await t.save('orders', [
    o('H1', { status: 'delivered', returnedAt: Y, courierSettledAt: Y, payments: paid('H1', Y) }),
    o('H2', { status: 'delivered', returnedAt: Y, courierSettledAt: Y, payments: paid('H2', Y) }),
    o('H3', { status: 'delivered', returnedAt: Y, courierSettledAt: T, payments: paid('H3', Y) }),
    o('H4', { status: 'delivered', returnedAt: Y, payments: paid('H4', Y) }),
    o('H5', { status: 'out', payments: [] }),
    { id: 'S1', number: 'S1', kind: 'order', channel: 'shop', status: 'delivered', createdAt: T, createdBy: 'u1', createdByName: 'Aina', discount: 0, lines: [{ id: 'ls', variantId: 'v1', qty: 1, unitPrice: 20000 }], payments: [{ id: 'ps', at: T, amount: 20000, method: 'cash', receivedBy: 'shop' }] },
  ]);
});
await p.goto('http://localhost:5173/#/compte'); await p.waitForTimeout(400);
await p.locator('main').getByRole('button', { name: 'Se déconnecter' }).click(); await p.waitForTimeout(400);
await p.getByLabel("Nom d'utilisateur").fill('aina'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter'); await p.waitForTimeout(600);
await p.goto('http://localhost:5173/#/versements'); await p.waitForTimeout(600);
let tx = N(await p.locator('main').innerText());
ok(/TOTAL À PAYER[^\n]*\n?[^\n]*40 000 Ar/.test(tx) || tx.includes('40 000 Ar'), 'aujourd’hui : 40 000 à remettre (vente sur place 20 000 + H3 réglé ce jour 20 000)');
ok(tx.includes('dont 20 000 Ar pour des ventes des jours précédents'), 'dont 20 000 pour le reste d’hier');
ok(tx.includes('Reste à encaisser') && tx.includes('Reste d’hier') && tx.includes('H4') && tx.includes('H5') && !/\bH1\b/.test(tx.split('Reste à encaisser')[1] || ''), 'reste d’hier : H4 (chez le livreur) et H5 (en livraison)');
if (!tx.includes('H4')) console.log(tx.slice(0, 2500));
await p.goto('http://localhost:5173/#/mon-rapport'); await p.waitForTimeout(600);
tx = N(await p.locator('pre.recap-text').innerText());
ok(tx.includes('*Reste à encaisser*') && tx.includes('Jours précédents : 40 000 Ar (2 commande(s))'), 'rapport du jour : reste à encaisser des jours précédents');
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); await b.close(); process.exit(fail ? 1 : 0);
