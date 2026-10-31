// Versements (suite) : frais payés au magasin pour un livreur salarié ou une commande sans livreur : jamais dans le versement.
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
    // Toky (frais pour la caisse frais) : le client vient payer au magasin en espèces, frais compris : 54 000
    o('S1', 'ct', 1, 4000, [{ id: 'q1', at: now, amount: 54000, method: 'cash', receivedBy: 'shop' }], { courierSettledAt: undefined }),
    // Commande remise au client au magasin (sans livreur) avec 4 000 de frais facturés, payée 54 000 en espèces
    o('S2', undefined, 1, 4000, [{ id: 'q2', at: now, amount: 54000, method: 'cash', receivedBy: 'shop' }], { courierId: undefined, courierSettledAt: undefined, dispatchedAt: undefined, returnedAt: undefined }),
    // Toky, client payé par MVola au magasin frais compris : 54 000
    o('S3', 'ct', 1, 4000, [{ id: 'q3', at: now, amount: 54000, method: 'mvola', receivedBy: 'shop' }], { courierSettledAt: undefined }),
  ]);
});
await p.goto('http://localhost:5173/#/versements'); await p.waitForTimeout(900);
const row = N(await p.locator('.handover-table tbody tr', { hasText: 'Plateforme' }).innerText()).replace(/\s+/g, ' ');
console.log(row);
const d = await p.evaluate(() => window.__tsena.handovers.sellerDay(window.__tsena.get('users', 'u1'), new Date().toLocaleDateString('sv-SE')));
ok(Math.round(d.toPay) === 100000, `espèces à verser 100 000 (pas 108 000) : ${d.toPay}`);
ok(Math.round(d.pay.mvola - d.feeBy.mvola) === 50000, `MVola 50 000 (pas 54 000) : ${d.pay.mvola - d.feeBy.mvola}`);
console.log(fail ? `${fail} ÉCHEC(S)` : 'TOUT EST BON'); await b.close(); process.exit(fail ? 1 : 0);
