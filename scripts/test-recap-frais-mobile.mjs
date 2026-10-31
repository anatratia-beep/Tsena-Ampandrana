// Récap livraison (frais des colis du jour) : « Frais MVola / Orange Money » = seulement la part des frais du jour payée
// sur les téléphones. Pas les frais payés en espèces au magasin, ni ceux d'un refus ; les colis d'un autre jour n'y sont pas.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Indian/Antananarivo' })).newPage();
const N = (t) => t.replace(/[  ]/g, ' ');
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
await p.evaluate(async () => { const t = window.__tsena;
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const day = ymd(new Date()), yday = ymd(new Date(Date.now() - 864e5));
  const at = `${day}T09:00:00+03:00`, back = `${day}T16:00:00+03:00`, yat = `${yday}T09:00:00+03:00`, yback = `${yday}T16:00:00+03:00`;
  await t.save('categories', [{ id: 'ind', name: 'Induction' }]);
  await t.save('products', [{ id: 'a', code: 'A', name: 'Plaque', categoryId: 'ind', priceRetail: 95000, active: true }]);
  await t.save('variants', [{ id: 'va', productId: 'a', sku: 'A', costAvg: 50000, active: true }]);
  await t.save('couriers', [{ id: 'c1', name: 'Mbola', active: true }]);
  const o = (id, fee, payments, status = 'delivered', when = at, ret = back) => ({ id, number: id, kind: 'order', channel: 'online', phone: '0340000000', status, courierId: 'c1', zoneId: 'z1',
    lines: [{ id: 'l' + id, variantId: 'va', qty: 1, unitPrice: 95000, qtyKept: status === 'refused' ? 0 : 1, qtyReturned: status === 'refused' ? 1 : 0 }], deliveryFee: fee, feeCharged: fee, payments, discount: 0, createdAt: when, dispatchedAt: when, returnedAt: ret });
  await t.save('orders', [
    o('m1', 5000, [{ id: 'p1', at, amount: 100000, method: 'mvola', receivedBy: 'shop' }]),                 // MVola aujourd'hui : 5 000
    o('m2', 4000, [{ id: 'p2', at, amount: 99000, method: 'orange', receivedBy: 'shop' }]),                // Orange aujourd'hui : 4 000
    o('m3', 3000, [{ id: 'p3', at, amount: 98000, method: 'cash', receivedBy: 'shop' }]),                  // espèces au magasin : pas MVola
    o('m4', 2000, [], 'refused'),                                                                          // refus : pas MVola
    o('m5', 3000, [{ id: 'p5', at: yat, amount: 98000, method: 'mvola', receivedBy: 'shop' }]),            // payé d'avance par MVola hier, parti aujourd'hui : 3 000
    o('m6', 6000, [{ id: 'p6', at, amount: 101000, method: 'mvola', receivedBy: 'shop' }], 'delivered', yat, yback), // parti hier : pas dans le récap d'aujourd'hui
  ]);
});
await p.goto('http://localhost:5173/#/livraisons/recap'); await p.waitForTimeout(900);
const tx = N(await p.locator('.fee-board').innerText());
if (process.env.DBG) console.log(tx);
ok(/Mbola\s+5\s+475 000 Ar\s+12 000 Ar\s+0 Ar\s+12 000 Ar\s+1/i.test(tx), `Mbola : 5 colis du jour, total frais = espèces 0 + MVola / Orange = 5 000 + 4 000 + 3 000 = 12 000 (sans espèces magasin ni refus) (${tx})`);
ok(/TOTAL\s+5\s+475 000 Ar\s+12 000 Ar\s+0 Ar\s+12 000 Ar\s+1/i.test(tx), 'TOTAL : MVola / Orange 12 000');
// Versements → Argent réellement reçu : les mêmes frais MVola / Orange que le Récap livraison du jour
await p.goto('http://localhost:5173/#/versements'); await p.waitForTimeout(900);
const mc = N(await p.locator('.card', { hasText: 'Argent réellement reçu ce jour' }).innerText()).replace(/\s+/g, ' ');
ok(/Total frais MVola \/ Orange Money \(livreurs\).*MVola 8 000 Ar · Orange 4 000 Ar 12 000 Ar/.test(mc), `argent reçu ce jour : frais MVola 8 000 + Orange 4 000 = 12 000, comme le Récap livraison (${mc})`);
const wk = N(await p.locator('.card', { hasText: 'Argent réellement reçu : la semaine' }).innerText()).replace(/\s+/g, ' ');
const dm = (d) => `${String(d.getDate()).padStart(2, '0')}\\/${String(d.getMonth() + 1).padStart(2, '0')}`;
ok(new RegExp(`${dm(new Date())} [^.]*12 000 Ar`).test(wk) && (new Date().getDay() === 1 || new RegExp(`${dm(new Date(Date.now() - 864e5))} [^.]* 6 000 Ar`).test(wk)), `semaine : frais MVola / Orange par jour comme le Récap livraison, aujourd’hui 12 000, hier 6 000 (m6) (${wk.slice(-300)})`);
await p.goto('http://localhost:5173/#/livraisons/recap'); await p.waitForTimeout(900);
await p.waitForTimeout(1500); await p.locator('.fee-board').screenshot({ path: process.env.SHOT || '/tmp/fee-board-jour.png' });
console.log(fail ? `${fail} ÉCHEC(S)` : 'TOUT EST BON'); await b.close(); process.exit(fail ? 1 : 0);
