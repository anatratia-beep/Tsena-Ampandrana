// Tableau du versement : Sommes = reçu (espèces, MVola, Orange) + reste semaine −1 (sans le reste à payer de la semaine en cours).
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Indian/Antananarivo', deviceScaleFactor: Number(process.env.DPR || 1) })).newPage();
const N = (t) => t.replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();
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
  const o = (id, amount, n, payments) => ({ id, number: id, kind: 'order', channel: 'shop', phone: '', status: 'delivered', lines: [{ id: 'l' + id, variantId: 'va', qty: 1, unitPrice: amount, qtyKept: 1 }], payments, discount: 0, deliveryFee: 0, createdAt: d(n) });
  await t.save('orders', [o('PAY', 50000, 0, [{ id: 'p', at: d(0), amount: 50000, method: 'cash', receivedBy: 'shop' }]), o('RES', 30000, 0, [])]);
});
await p.goto('http://localhost:5173/#/rapports/versement-semaine'); await p.waitForTimeout(900);
const foot = N(await p.locator('.bw-table tfoot').first().innerText());
ok(/Sommes 0 Ar/.test(foot), `sommes = reçu 0 + reste semaine −1 0, sans le reste à payer 30 000 (${foot})`);
if (process.env.SHOT) await p.locator('.bw-table').first().screenshot({ path: process.env.SHOT });
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); await b.close(); process.exit(fail ? 1 : 0);
