// Case rouge semaine −1 : figé au compte = total payé + annulé après le compte + reste encore impayé.
// Les annulations d'avant le compte ne sont pas dans le chiffre figé ni dans « annulé ».
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Indian/Antananarivo', deviceScaleFactor: Number(process.env.DPR || 1) })).newPage();
const N = (t) => t.replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
await p.evaluate(async () => {
  const t = window.__tsena;
  const now = new Date(); const mon = new Date(now); mon.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const d = (n) => { const x = new Date(mon); x.setDate(mon.getDate() + n); x.setHours(10, 0, 0, 0); return x.toISOString(); };
  await t.save('categories', [{ id: 'nv', name: 'Netvision' }]);
  await t.save('products', [{ id: 'a', code: 'A', name: 'Caméra', categoryId: 'nv', priceRetail: 10000, active: true }]);
  await t.save('variants', [{ id: 'va', productId: 'a', sku: 'A', costAvg: 5000, active: true }]);
  const o = (id, amount, n, extra = {}) => ({ id, number: id, kind: 'order', channel: 'facebook', phone: '0340000000', name: 'Client ' + id, status: 'delivered', lines: [{ id: 'l' + id, variantId: 'va', qty: 1, unitPrice: amount, qtyKept: 1 }], payments: [], discount: 0, deliveryFee: 0, createdAt: d(n), dispatchedAt: d(n), ...extra });
  await t.save('orders', [
    o('PAY', 50000, -5, { payments: [{ id: 'p', at: d(0), amount: 50000, method: 'cash', receivedBy: 'shop' }] }), // payée lundi (après le compte)
    o('ANA', 40000, -4, { status: 'cancelled', statusDates: { cancelled: d(0) } }),                              // annulée lundi (après le compte)
    o('RES', 30000, -3),                                                                                           // toujours impayée
    o('ANB', 20000, -4, { status: 'cancelled', statusDates: { cancelled: d(-3) } }),                             // annulée vendredi (avant le compte)
  ]);
});
await p.goto('http://localhost:5173/#/rapports/versement-semaine'); await p.waitForTimeout(900);
const card = N(await p.locator('.bw-top-prev').innerText());
const num = (re) => Number((card.match(re)?.[1] ?? '').replace(/ /g, ''));
const fr = num(/semaine −1 ([\d ]+) Ar/), pay = num(/total payé : ([\d ]+) Ar/), ann = num(/annulé : ([\d ]+) Ar/), still = num(/reste impayé : ([\d ]+) Ar/);
ok(pay === 50000 && ann === 40000 && still === 30000, `payé 50 000, annulé après 40 000, reste 30 000 (${card})`);
ok(fr === 120000 && fr === pay + ann + still, `figé ${fr} = 120 000 = payé + annulé après + reste encore (${pay + ann + still})`);
ok(!/60 000/.test(card), `l'annulation d'avant le compte (20 000) n'est pas comptée`);
if (process.env.SHOT) await p.locator('.bw-top').screenshot({ path: process.env.SHOT });
// Liste « Voir les ventes » : en bas, les ventes du chiffre figé déjà payées ou annulées depuis le compte.
await p.locator('.bw-top-prev').click(); await p.waitForTimeout(400);
const done = N(await p.locator('.bw-done').innerText());
ok(/PAY .*Payé 50 000 Ar/.test(done) && /ANA .*Annulé 40 000 Ar/.test(done) && !/ANB/.test(done), `liste : PAY payé 50 000, ANA annulé 40 000, pas ANB (${done})`);
ok(/Total payé \+ annulé 90 000 Ar/.test(done) && /Figé au compte = reste impayé \+ payé \+ annulé 120 000 Ar/.test(done), `liste : totaux 90 000 et figé 120 000`);
if (process.env.SHOT2) await p.locator('.modal').screenshot({ path: process.env.SHOT2 });
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); await b.close(); process.exit(fail ? 1 : 0);
