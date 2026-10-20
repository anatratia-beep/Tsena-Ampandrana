// Rapport au patron, « À verser au patron » : paiements repris de « Situation par page » (accueil) ; 1re case total = espèces payées le jour, 2e case = total − dépenses espèces + anciens impayés
// encaissés après le comptage (« Impayé précédent à verser ») ; MVola / Orange Money = total − dépenses ;
// reste impayé de la semaine précédente figé au comptage du lundi (un paiement ne le baisse pas, une annulation oui) et de la semaine en cours.
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
    // Semaine précédente (jeudi 30/07) : 12 000 pas encore payés
    { id: 's7', number: 's7', kind: 'order', channel: 'shop', phone: '', status: 'delivered', lines: [{ id: 'ls7', variantId: 'va', qty: 1, unitPrice: 12000, qtyKept: 1 }], payments: [], discount: 0, deliveryFee: 0, createdAt: '2026-07-30T10:00:00+03:00' },
    // Semaine précédente (mercredi 29/07) : 8 000 impayés au comptage du lundi 03/08, payés le 05/08
    { id: 's8', number: 's8', kind: 'order', channel: 'shop', phone: '', status: 'delivered', lines: [{ id: 'ls8', variantId: 'va', qty: 1, unitPrice: 8000, qtyKept: 1 }], payments: [{ id: 'p8', at: '2026-08-05T09:00:00+03:00', amount: 8000, method: 'cash', receivedBy: 'shop' }], discount: 0, deliveryFee: 0, createdAt: '2026-07-29T10:00:00+03:00' },
    // 05/08 : 10 000, 6 000 en espèces le jour, 4 000 en MVola le lendemain (1er paiement du reste à l'accueil, pas dans MVola du jour)
    { id: 's9', number: 's9', kind: 'order', channel: 'shop', phone: '', status: 'delivered', lines: [{ id: 'ls9', variantId: 'va', qty: 1, unitPrice: 10000, qtyKept: 1 }], payments: [{ id: 'p9a', at, amount: 6000, method: 'cash', receivedBy: 'shop' }, { id: 'p9b', at: '2026-08-06T10:00:00+03:00', amount: 4000, method: 'mvola', receivedBy: 'shop' }], discount: 0, deliveryFee: 0, createdAt: at },
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
// CA 90 000 (s6 annulée exclue) − Mobile Money 25 000 = 65 000 de ventes espèces − 20 000 d'impayés = 45 000
ok(/Total à verser\s*51 000 Ar[\s\S]*?Total à verser après dépenses et anciens impayés encaissés\s*54 000 Ar/.test(tx), '2 cases : espèces du jour 51 000 (comme l’accueil), puis − 5 000 de dépenses + 8 000 d’ancien impayé encaissé = 54 000');
ok(/Impayé précédent à verser\s*8 000 Ar/.test(tx), 'impayé précédent à verser : 8 000 (vente du 29/07 payée le 05/08)');
ok(/Total MVola\s*15 000 Ar\s*MVola − dépenses MVola\s*13 000 Ar/.test(tx), 'cases MVola : 15 000, puis − 2 000 = 13 000');
ok(/Total Orange Money\s*10 000 Ar\s*Orange Money − dépenses Orange Money\s*9 000 Ar/.test(tx), 'cases Orange Money : 10 000, puis − 1 000 = 9 000');
ok(/Reste impayé semaine précédente\s*20 000 Ar[\s\S]*?2 vente\(s\) du 27\/07 au 02\/08/.test(tx), 'reste impayé semaine précédente figé au comptage : 12 000 + 8 000 = 20 000 (le paiement du 05/08 ne le baisse pas)');
ok(/Reste impayé semaine en cours\s*20 000 Ar[\s\S]*?1 vente\(s\) du 03\/08 au 05\/08/.test(tx), 'reste impayé semaine en cours (lundi 03/08 → 05/08) : 20 000, la vente annulée ne compte pas');
ok(tx.includes('*À verser au patron*') && tx.includes('Total à verser : 51 000 Ar') && tx.includes('Impayé précédent à verser : 8 000 Ar') && tx.includes('Total à verser après dépenses et anciens impayés encaissés : 54 000 Ar') && tx.includes('Total MVola − dépenses MVola : 13 000 Ar') && tx.includes('Reste impayé semaine précédente : 20 000 Ar') && tx.includes('Reste impayé semaine en cours : 20 000 Ar'), 'lignes dans le message WhatsApp');
const bg = async (sel) => p.locator(sel).evaluate((e) => getComputedStyle(e).backgroundImage + getComputedStyle(e).backgroundColor);
ok(await bg('.boss-unpaidPrev') !== await bg('.boss-unpaidCur'), 'les 2 cases reste impayé n’ont pas la même couleur');
ok(await bg('.boss-net') !== await bg('.boss-total'), 'les 2 cases principales n’ont pas la même couleur');
const top = async (sel) => p.locator(sel).evaluate((e) => Math.round(e.getBoundingClientRect().top));
const hh = async (sel) => p.locator(sel).evaluate((e) => Math.round(e.getBoundingClientRect().height));
ok(await top('.boss-total') === await top('.boss-net') && await hh('.boss-total') === await hh('.boss-net'), '2 cases principales alignées, même hauteur');
ok(await top('.boss-prevPaid') === await top('.boss-unpaidCur') && await hh('.boss-prevPaid') === await hh('.boss-unpaidCur'), 'cases impayés alignées, même hauteur');
// Le vendeur marque s7 (ancien impayé de 12 000) « Payé » le 05/08 : il s'ajoute à la 2e case, le reste impayé semaine précédente ne bouge pas
await p.evaluate(async () => { const t = window.__tsena; const o = (await t.all('orders')).find((x) => x.id === 's7'); await t.save('orders', [{ ...o, payments: [{ id: 'p7', at: '2026-08-05T15:00:00+03:00', amount: 12000, method: 'cash', receivedBy: 'shop' }] }]); });
await p.waitForTimeout(800);
let t2 = N(await p.locator('main').innerText());
ok(/Impayé précédent à verser\s*20 000 Ar/.test(t2) && /Total à verser après dépenses et anciens impayés encaissés\s*66 000 Ar/.test(t2), 'après « Payé » : impayé précédent à verser 20 000, 2e case 51 000 − 5 000 + 20 000 = 66 000');
ok(/Reste impayé semaine précédente\s*20 000 Ar/.test(t2), 'après « Payé » : reste impayé semaine précédente inchangé (20 000)');
// Annulation d'une vente impayée de la semaine précédente : seul cas (avec le report) où le reste impayé semaine précédente baisse
await p.evaluate(async () => { const t = window.__tsena; const o = (await t.all('orders')).find((x) => x.id === 's7'); await t.save('orders', [{ ...o, status: 'cancelled', payments: [] }]); });
await p.waitForTimeout(800);
t2 = N(await p.locator('main').innerText());
ok(/Reste impayé semaine précédente\s*8 000 Ar/.test(t2) && /Total à verser après dépenses et anciens impayés encaissés\s*54 000 Ar/.test(t2), 'après annulation : reste impayé semaine précédente 8 000, 2e case 54 000');
await b.close();
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); process.exit(fail ? 1 : 0);
