// RST SEM −1 (tableau du versement) = 2ème paiement des ventes du vendredi + 1er et 2ème paiement des ventes du samedi
// de la semaine −1. Les autres jours et le 1er paiement du vendredi (le samedi) ne comptent pas.
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
  const pay = (id, n, amount) => ({ id, at: d(n), amount, method: 'cash', receivedBy: 'shop' });
  const o = (id, amount, n, payments) => ({ id, number: id, kind: 'order', channel: 'facebook', phone: '0340000000', name: 'Client ' + id, status: 'delivered', lines: [{ id: 'l' + id, variantId: 'va', qty: 1, unitPrice: amount }], payments, discount: 0, deliveryFee: 0, createdAt: d(n), dispatchedAt: d(n) });
  await t.save('orders', [
    o('MER', 30000, -5, [pay('a', -2, 30000)]),                       // mercredi payé avant le compte : ne compte pas
    o('JEU', 20000, -4, [pay('f', -4, 8000), pay('g', 1, 12000)]),   // jeudi : reste 12 000 payé mardi → autres jours
    o('VEN', 50000, -3, [pay('b', -2, 20000), pay('c', 0, 30000)]),   // vendredi : 1er paiement samedi 20 000 (non), 2ème lundi 30 000 (oui)
    o('SAM', 40000, -2, [pay('d', 0, 15000), pay('e', 1, 25000)]),    // samedi : 1er lundi 15 000 + 2ème mardi 25 000
  ]);
});
await p.goto('http://localhost:5173/#/rapports/versement-semaine'); await p.waitForTimeout(900);
const row = N(await p.locator('.bw-table tr', { hasText: 'Reste semaine −1' }).innerText());
ok(/2ème paiement vendredi 30 000 Ar 1er paiement samedi 15 000 Ar 2ème paiement samedi 25 000 Ar autres jours de la semaine 12 000 Ar 82 000 Ar/.test(row), `RST SEM −1 = 30 000 + 15 000 + 25 000 + 12 000 = 82 000 (${row})`);
const card = N(await p.locator('.bw-top-prev').innerText());
ok(/total payé : 82 000 Ar/.test(card), `case rouge : total payé vert = RST SEM −1 82 000 (${card})`);
if (process.env.SHOT2) await p.locator('.bw-top-prev').screenshot({ path: process.env.SHOT2 });
if (process.env.SHOT) await p.locator('.bw-card').first().screenshot({ path: process.env.SHOT });
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); await b.close(); process.exit(fail ? 1 : 0);
