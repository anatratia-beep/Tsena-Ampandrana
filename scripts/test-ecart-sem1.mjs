// « Impayé précédent à verser » : écart avec « Reste semaine −1 » (RST SEM −1) commande par commande (affichage seulement).
// Une vente du mercredi payée au livreur le samedi et versée par le livreur le lundi compte dans RST SEM −1 (jour du versement
// du livreur) mais pas dans « dont semaine −1 » (le client a payé avant le lundi).
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
  const o = (id, amount, n, pay, x = {}) => ({ id, number: id, kind: 'order', channel: 'facebook', phone: '0340000000', name: 'Client ' + id, status: 'delivered', lines: [{ id: 'l' + id, variantId: 'va', qty: 1, unitPrice: amount, qtyKept: 1 }], payments: [{ id: 'p' + id, at: d(pay), amount, method: 'cash', receivedBy: 'shop' }], discount: 0, deliveryFee: 0, createdAt: d(n), dispatchedAt: d(n), ...x });
  const liv = o('LIV', 20000, -5, -2, { courierId: 'c1', courierSettledAt: d(0) }); liv.payments[0].receivedBy = 'courier';
  await t.save('couriers', [{ id: 'c1', name: 'Livreur', active: true }]);
  await t.save('orders', [liv, o('LUN', 10000, -5, 0)]); // mercredi −1 : payée au livreur samedi (versée lundi) / payée lundi
  const p2 = (n) => String(n).padStart(2, '0'); return `${mon.getFullYear()}-${p2(mon.getMonth() + 1)}-${p2(mon.getDate())}`;
});
await p.goto(`http://localhost:5173/#/rapports/patron?p=week&a=${mon}`); await p.waitForTimeout(900);
const card = N(await p.locator('.boss-prevPaid').innerText());
ok(/dont semaine −1 : 10 000 Ar/.test(card) || /10 000 Ar/.test(card), `impayé précédent 10 000 (${card})`);
ok(/écart avec « Reste semaine −1 » \(30 000 Ar\) : 20 000 Ar → voir/.test(card), `écart 30 000 − 10 000 = 20 000 (${card})`);
if (process.env.SHOT) await p.locator('.boss-prevPaid').screenshot({ path: process.env.SHOT });
await p.locator('.boss-gap').click(); await p.waitForTimeout(300);
const list = N(await p.locator('.boss-gap-list').innerText());
ok(/LIV .* 20 000 Ar 0 Ar 20 000 Ar/.test(list) && !/LUN/.test(list) && /Total 30 000 Ar 10 000 Ar 20 000 Ar/.test(list), `liste : LIV payée au livreur samedi, écart 20 000 (${list})`);
if (process.env.SHOT2) await p.locator('.modal').screenshot({ path: process.env.SHOT2 });
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); await b.close(); process.exit(fail ? 1 : 0);
