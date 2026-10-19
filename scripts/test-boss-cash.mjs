// Rapport au patron, « À verser au patron » : total = ventes espèces − impayés, puis total − dépenses espèces ; MVola / Orange Money = total − dépenses ;
// reste impayé sur 1 semaine (les ventes annulées ne comptent pas).
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
    // Sur place : 20 000 pas encore payés (impayé)
    { id: 's5', number: 's5', kind: 'order', channel: 'shop', phone: '', status: 'delivered', lines: [{ id: 'ls5', variantId: 'va', qty: 1, unitPrice: 20000, qtyKept: 1 }], payments: [], discount: 0, deliveryFee: 0, createdAt: at },
    // Sur place annulée par l'employé : ne compte ni dans les ventes ni dans les impayés
    { id: 's6', number: 's6', kind: 'order', channel: 'shop', phone: '', status: 'cancelled', lines: [{ id: 'ls6', variantId: 'va', qty: 1, unitPrice: 50000, qtyKept: 1 }], payments: [], discount: 0, deliveryFee: 0, createdAt: at },
    // Livraison : le livreur encaisse 18 000 (15 000 + 3 000 de frais), rapporte 15 000 le jour même
    { id: 's3', number: 's3', kind: 'order', channel: 'online', phone: '0340000000', status: 'delivered', courierId: 'c1', zoneId: 'z1', lines: line('s3', 1), deliveryFee: 3000, feeCharged: 3000, payments: [{ id: 'p3', at, amount: 18000, method: 'cash', receivedBy: 'courier', courierId: 'c1' }], discount: 0, createdAt: at, dispatchedAt: at, courierSettledAt: '2026-08-05T17:00:00+03:00' },
  ]);
  await t.save('cashMoves', [{ at: '2026-08-05T12:00:00+03:00', account: 'cash', amount: -5000, type: 'expense', label: 'Sakafo' }, { at: '2026-08-05T13:00:00+03:00', account: 'mvola', amount: -2000, type: 'expense', label: 'Crédit' }, { at: '2026-08-05T14:00:00+03:00', account: 'orange', amount: -1000, type: 'expense', label: 'Frais' }]);
});
await p.goto('http://localhost:5173/#/rapports/patron?p=day&a=2026-08-05'); await p.waitForTimeout(800);
const tx = N(await p.locator('main').innerText());
if (process.env.DBG) console.log(tx.slice(0, 1500));
// CA 90 000 (s6 annulée exclue) − Mobile Money 25 000 = 65 000 de ventes espèces ; − 5 000 de dépenses − 20 000 d'impayés = 40 000
ok(/Total à verser patron\s*45 000 Ar\s*Total à verser − dépenses espèces\s*40 000 Ar/.test(tx), 'cases espèces l’une sous l’autre : total 65 000 − 20 000 = 45 000, puis − 5 000 = 40 000');
ok(/MVola\s*13 000 Ar[\s\S]*?Total MVola 15 000 Ar − dépenses MVola 2 000 Ar/.test(tx), 'MVola : 15 000 − 2 000 = 13 000');
ok(/Orange Money\s*9 000 Ar[\s\S]*?Total Orange Money 10 000 Ar − dépenses Orange Money 1 000 Ar/.test(tx), 'Orange Money : 10 000 − 1 000 = 9 000');
ok(/Reste impayé \(1 semaine\)\s*20 000 Ar[\s\S]*?1 vente\(s\) du 30\/07 au 05\/08/.test(tx), 'reste impayé sur 1 semaine : 20 000 (la vente annulée ne compte pas)');
ok(tx.includes('*À verser au patron*') && tx.includes('Total à verser patron : 45 000 Ar') && tx.includes('Total à verser − dépenses espèces : 40 000 Ar') && tx.includes('MVola : 13 000 Ar') && tx.includes('Orange Money : 9 000 Ar') && tx.includes('Reste impayé (7 derniers jours) : 20 000 Ar'), 'lignes dans le message WhatsApp');
await b.close();
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); process.exit(fail ? 1 : 0);
