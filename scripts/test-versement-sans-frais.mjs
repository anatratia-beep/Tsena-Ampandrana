// Versements : les frais de livraison ne sont jamais dans les espèces à remettre, quel que soit leur sort : livreur salarié
// (caisse frais), frais « payés à part », ou frais payés en espèces au magasin ; MVola / Orange : prix des articles seulement.
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
  const t = window.__tsena; const now = new Date().toISOString(); const hash = t.get('users', 'user-superadmin').passwordHash;
  await t.save('categories', [{ id: 'pf', name: 'Plateforme' }]);
  await t.save('products', [{ id: 'a', code: 'A', name: 'Support', categoryId: 'pf', priceRetail: 50000, active: true }]);
  await t.save('variants', [{ id: 'va', productId: 'a', sku: 'A', costAvg: 20000, active: true }]);
  await t.save('stockMoves', [{ variantId: 'va', qty: 50, type: 'initial', at: now }]);
  await t.save('users', [{ id: 'u1', username: 'tsiory', fullName: 'Tsiory', roleId: 'role-seller', active: true, passwordHash: hash, mustChangePassword: false, pageIds: ['pf'] }]);
  await t.save('zones', { id: 'z1', name: 'Analakely', fee: 4000, active: true });
  await t.save('couriers', [{ id: 'c1', name: 'Faly', active: true }, { id: 'ct', name: 'Toky', active: true, feeToShop: true }]);
  const o = (id, courierId, qty, fee, payments, extra = {}) => ({ id, number: id, kind: 'order', channel: 'facebook', phone: '034000000' + id.slice(-1), zoneId: 'z1', courierId, status: 'delivered',
    lines: [{ id: 'l' + id, variantId: 'va', qty, unitPrice: 50000, qtyKept: qty, qtyReturned: 0 }], deliveryFee: fee, feeCharged: fee, discount: 0, payments,
    dispatchedAt: now, returnedAt: now, courierSettledAt: now, createdBy: 'u1', createdByName: 'Tsiory', createdAt: now, ...extra });
  await t.save('orders', [
    // Toky (frais pour la caisse frais) : le client lui paie 154 000 (150 000 + 4 000 de frais)
    o('T1', 'ct', 3, 4000, [{ id: 'p1', at: now, amount: 154000, method: 'cash', receivedBy: 'courier', courierId: 'ct' }]),
    // Faly, frais « payés à part » : il remet tout, 105 000 (100 000 + 5 000)
    o('T2', 'c1', 2, 5000, [{ id: 'p2', at: now, amount: 105000, method: 'cash', receivedBy: 'courier', courierId: 'c1' }], { feeStatus: 'paid' }),
    // Client venu payer au magasin en espèces, frais compris : 53 000 (50 000 + 3 000 dus au livreur)
    o('T3', 'c1', 1, 3000, [{ id: 'p3', at: now, amount: 53000, method: 'cash', receivedBy: 'shop' }]),
    // Client qui paie au magasin par MVola, frais compris : 52 000 (50 000 + 2 000 dus au livreur)
    o('T4', 'c1', 1, 2000, [{ id: 'p4', at: now, amount: 52000, method: 'mvola', receivedBy: 'shop' }]),
  ]);
});
await p.goto('http://localhost:5173/#/versements'); await p.waitForTimeout(900);
const row = N(await p.locator('.handover-table tbody tr', { hasText: 'Plateforme' }).innerText()).replace(/\s+/g, ' ');
ok(/Plateforme Tsiory 350 000 Ar 300 000 Ar/.test(row) && / 300 000 Ar$/.test(row), `Plateforme : ventes 350 000, espèces du jour 300 000 sans aucun frais (pas 312 000) (${row})`);
ok(/ 50 000 Ar — — 2 000 Ar 300 000 Ar$/.test(row), `MVola 50 000 (vidin'entana ihany, pas 52 000), frais livreurs MVola 2 000 à part (${row})`);
console.log(fail ? `${fail} ÉCHEC(S)` : 'TOUT EST BON'); await b.close(); process.exit(fail ? 1 : 0);
