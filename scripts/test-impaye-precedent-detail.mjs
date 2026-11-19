// « Impayé précédent à verser » : ventes de la semaine −1 seulement (une vente plus ancienne payée cette semaine ne compte pas).
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Indian/Antananarivo', deviceScaleFactor: Number(process.env.DPR || 1) })).newPage();
const N = (t) => t.replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
const mon = await p.evaluate(async () => {
  const t = window.__tsena;
  const now = new Date(); const mon = new Date(now); mon.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const d = (n) => { const x = new Date(mon); x.setDate(mon.getDate() + n); x.setHours(10, 0, 0, 0); return x.toISOString(); };
  await t.save('categories', [{ id: 'nv', name: 'Netvision' }]);
  await t.save('products', [{ id: 'a', code: 'A', name: 'Caméra', categoryId: 'nv', priceRetail: 10000, active: true }]);
  await t.save('variants', [{ id: 'va', productId: 'a', sku: 'A', costAvg: 5000, active: true }]);
  const o = (id, amount, n, pay) => ({ id, number: id, kind: 'order', channel: 'facebook', phone: '0340000000', name: 'Client ' + id, status: 'delivered', lines: [{ id: 'l' + id, variantId: 'va', qty: 1, unitPrice: amount, qtyKept: 1 }], payments: [{ id: 'p' + id, at: d(pay), amount, method: 'cash', receivedBy: 'shop' }], discount: 0, deliveryFee: 0, createdAt: d(n), dispatchedAt: d(n) });
  await t.save('orders', [o('S1', 20000, -5, 0), o('OLD', 15000, -12, 0)]); // semaine −1 et deux semaines avant, payées lundi
  const p2 = (n) => String(n).padStart(2, '0'); return `${mon.getFullYear()}-${p2(mon.getMonth() + 1)}-${p2(mon.getDate())}`;
});
await p.goto(`http://localhost:5173/#/rapports/patron?p=week&a=${mon}`); await p.waitForTimeout(900);
const card = N(await p.locator('.boss-prevPaid').innerText());
ok(/Impayé précédent à verser 20 000 Ar/.test(card) && /1 ancienne\(s\) vente\(s\)/.test(card) && /semaine −1 seulement/.test(card), `impayé précédent 20 000 : semaine −1 seulement, la vente plus ancienne (15 000) ne compte pas (${card})`);
if (process.env.SHOT) await p.locator('.boss-prevPaid').screenshot({ path: process.env.SHOT });
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); await b.close(); process.exit(fail ? 1 : 0);
