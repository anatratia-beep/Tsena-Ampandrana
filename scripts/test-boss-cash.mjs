// Rapport au patron : cartes « … à verser au patron » par moyen (espèces, MVola, Orange Money) = ventes − dépenses de ce moyen.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Indian/Antananarivo' })).newPage();
const N = (t) => t.replace(/[\u00a0\u202f]/g, ' ');
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
await p.evaluate(async () => { const t = window.__tsena;
  await t.save('categories', [{ id: 'pp', name: 'Poignet précieux' }]);
  await t.save('products', [{ id: 'a', code: 'A', name: 'Montre', categoryId: 'pp', priceRetail: 15000, active: true }]);
  await t.save('variants', [{ id: 'va', productId: 'a', sku: 'A', costAvg: 5000, active: true }]);
  await t.save('stockMoves', [{ variantId: 'va', qty: 100, type: 'initial', at: '2026-08-01T08:00:00+03:00' }]);
  await t.save('couriers', [{ id: 'c1', name: 'Rado', active: true }]);
  const line = (id, q) => [{ id: 'l' + id, variantId: 'va', qty: q, unitPrice: 15000, qtyKept: q }];
  const at = '2026-08-05T10:00:00+03:00';
  await t.save('orders', [
    // Sur place : 30 000 en espèces
    { id: 's1', number: 's1', kind: 'order', channel: 'shop', phone: '', status: 'delivered', lines: line('s1', 2), payments: [{ id: 'p1', at, amount: 30000, method: 'cash', receivedBy: 'shop' }], discount: 0, deliveryFee: 0, createdAt: at },
    // Sur place : 15 000 en MVola
    { id: 's2', number: 's2', kind: 'order', channel: 'shop', phone: '', status: 'delivered', lines: line('s2', 1), payments: [{ id: 'p2', at, amount: 15000, method: 'mvola', receivedBy: 'shop' }], discount: 0, deliveryFee: 0, createdAt: at },
    // Sur place : 10 000 en Orange Money
    { id: 's4', number: 's4', kind: 'order', channel: 'shop', phone: '', status: 'delivered', lines: [{ id: 'ls4', variantId: 'va', qty: 1, unitPrice: 10000, qtyKept: 1 }], payments: [{ id: 'p4', at, amount: 10000, method: 'orange', receivedBy: 'shop' }], discount: 0, deliveryFee: 0, createdAt: at },
    // Livraison : le livreur encaisse 18 000 (15 000 + 3 000 de frais), rapporte 15 000 le jour même
    { id: 's3', number: 's3', kind: 'order', channel: 'online', phone: '0340000000', status: 'delivered', courierId: 'c1', zoneId: 'z1', lines: line('s3', 1), deliveryFee: 3000, feeCharged: 3000, payments: [{ id: 'p3', at, amount: 18000, method: 'cash', receivedBy: 'courier', courierId: 'c1' }], discount: 0, createdAt: at, dispatchedAt: at, courierSettledAt: '2026-08-05T17:00:00+03:00' },
  ]);
  await t.save('cashMoves', [{ at: '2026-08-05T12:00:00+03:00', account: 'cash', amount: -5000, type: 'expense', label: 'Sakafo' }, { at: '2026-08-05T13:00:00+03:00', account: 'mvola', amount: -2000, type: 'expense', label: 'Crédit' }, { at: '2026-08-05T14:00:00+03:00', account: 'orange', amount: -1000, type: 'expense', label: 'Frais' }]);
});
await p.goto('http://localhost:5173/#/rapports/patron?p=day&a=2026-08-05'); await p.waitForTimeout(800);
const tx = N(await p.locator('main').innerText());
if (process.env.DBG) console.log(tx.slice(0, 1500));
// Espèces : 30 000 + 18 000 − 3 000 (frais gardés par le livreur) = 45 000 de ventes − 5 000 = 40 000
ok(/Espèces à verser au patron\s*40 000 Ar[\s\S]*?Ventes 45 000 Ar − dépenses 5 000 Ar/.test(tx), 'espèces : 45 000 − 5 000 = 40 000');
ok(/MVola à verser au patron\s*13 000 Ar[\s\S]*?Ventes 15 000 Ar − dépenses 2 000 Ar/.test(tx), 'MVola : 15 000 − 2 000 = 13 000');
ok(/Orange Money à verser au patron\s*9 000 Ar[\s\S]*?Ventes 10 000 Ar − dépenses 1 000 Ar/.test(tx), 'Orange Money : 10 000 − 1 000 = 9 000');
ok(tx.includes('*À verser au patron*') && tx.includes('Espèces : 40 000 Ar') && tx.includes('MVola : 13 000 Ar') && tx.includes('Orange Money : 9 000 Ar'), 'lignes dans le message WhatsApp');
await b.close();
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); process.exit(fail ? 1 : 0);
