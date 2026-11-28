// Versement : Orange Money noté « encaissé par le livreur » — les frais du livreur sont retirés de l'Orange (pas des espèces).
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 }, timezoneId: 'Indian/Antananarivo', deviceScaleFactor: Number(process.env.DPR || 1) })).newPage();
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const N = (t) => t.replace(/[  ]/g, ' ').replace(/\s+/g, ' ');
p.on('pageerror', (e) => console.log('ERR', e.message));
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
const variants = [
  ['Orange encaissé par le livreur', {}, { payments: [{ id: 'py1', at: new Date().toISOString(), amount: 38000, method: 'orange', receivedBy: 'courier', courierId: 'k1' }] }, /^Powerbank Nandrianina 35 000 Ar 0 Ar à recevoir — — — 35 000 Ar — 3 000 Ar 0 Ar$/],
  ['Orange reçu par la boutique', {}, {}, /^Powerbank Nandrianina 35 000 Ar 0 Ar à recevoir — — — 35 000 Ar — 3 000 Ar 0 Ar$/],
];
for (const [name, cx, ox, want] of variants) {
  await p.evaluate(async ([cx, ox]) => {
    const t = window.__tsena; const now = new Date().toISOString(); const hash = t.get('users', 'user-superadmin').passwordHash;
    for (const o of t.all('orders')) await t.remove?.('orders', o.id);
    await t.save('categories', [{ id: 'pw', name: 'Powerbank' }]);
    await t.save('products', [{ id: 'a', code: 'POWE', name: 'TRANSPARENT', categoryId: 'pw', priceRetail: 35000, active: true }]);
    await t.save('variants', [{ id: 'va', productId: 'a', sku: 'POWE-TRA', costAvg: 5000, active: true }]);
    await t.save('users', [{ id: 'u1', username: 'nan', fullName: 'Nandrianina', roleId: 'role-seller', active: true, passwordHash: hash, mustChangePassword: false, pageIds: ['pw'] }]);
    await t.save('couriers', [{ id: 'k1', name: 'Daniel', active: true, ...cx }]);
    const o = { id: 'L241', number: 'C-L0241', kind: 'order', channel: 'facebook', phone: '034433205', name: 'Jason', zoneId: 'zone-centre', place: 'Ankadivato', courierId: 'k1', dispatchedAt: now, status: 'delivered', returnedAt: now, courierSettledAt: now, lines: [{ id: 'l1', variantId: 'va', qty: 1, unitPrice: 35000, qtyKept: 1 }], discount: 0, deliveryFee: 3000, feeCharged: 3000, createdBy: 'u1', createdByName: 'Nandrianina', createdAt: now,
      payments: [{ id: 'py1', at: now, amount: 38000, method: 'orange', receivedBy: 'shop', ref: 'OM', note: 'Payé par le client au retour du livreur' }], ...ox };
    await t.save('orders', [o]);
  }, [cx, ox]);
  await p.goto('http://localhost:5173/#/versements'); await p.waitForTimeout(900);
  const row = N(await p.locator('.handover-table tbody tr', { hasText: 'Powerbank' }).first().innerText().catch(() => '—'));
  ok(want.test(row), `${name} : Orange 35 000, frais 3 000, espèces 0 (${row})`);
  if (process.env.SHOT && name.includes('livreur')) await p.locator('.handover-table').first().screenshot({ path: process.env.SHOT });
}
await b.close();
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); process.exit(fail ? 1 : 0);
