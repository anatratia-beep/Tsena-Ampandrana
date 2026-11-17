// Case rouge semaine −1 : figé au compte (une vente annulée depuis en est déjà retirée) = total payé + reste encore impayé.
// Les annulations d'avant le compte ne sont pas dans le chiffre figé (montrées à part : « annulé toute la semaine »).
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
const fr = num(/semaine −1 ([\d ]+) Ar/), pay = num(/total payé : ([\d ]+) Ar/), ann = num(/annulé après le compte \(déjà retiré\) : ([\d ]+) Ar/), still = num(/reste encore impayé : ([\d ]+) Ar/), all = num(/annulé toute la semaine : ([\d ]+) Ar/);
ok(pay === 50000 && ann === 40000 && still === 30000, `payé 50 000, annulé après 40 000, reste 30 000 (${card})`);
ok(fr === pay + still, `figé ${fr} (120 000 au compte − 40 000 annulé depuis) = payé + reste encore (${pay + still})`);
ok(all === 60000, `annulé toute la semaine 60 000 (dont 20 000 avant le compte) (${all})`);
if (process.env.SHOT) await p.locator('.bw-top').screenshot({ path: process.env.SHOT });
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); await b.close(); process.exit(fail ? 1 : 0);
