// Liste « Reste impayés » de la semaine −1 : à côté de « Payé », « Annulé » annule la vente (sort de la liste, stock remis).
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
  await t.save('categories', [{ id: 'kp', name: 'Kapa PVC' }]);
  await t.save('products', [{ id: 'a', code: 'K', name: 'Kapa', categoryId: 'kp', priceRetail: 40000, active: true }]);
  await t.save('variants', [{ id: 'va', productId: 'a', sku: 'K', costAvg: 20000, active: true }]);
  await t.save('stockMoves', [{ variantId: 'va', qty: 10, type: 'initial', at: d(-20) }, { variantId: 'va', qty: -1, type: 'sale', refType: 'order', refId: 'K1', at: d(-3) }, { variantId: 'va', qty: -1, type: 'sale', refType: 'order', refId: 'K2', at: d(-3) }]);
  const o = (id, n) => ({ id, number: id === 'K1' ? 'C-K0270' : 'C-K0271', kind: 'order', channel: 'facebook', phone: '0340000000', name: id === 'K1' ? 'Chaina' : 'Appel', status: 'delivered', courierId: 'k1', zoneId: 'zone-centre',
    lines: [{ id: 'l' + id, variantId: 'va', qty: 1, unitPrice: 40000, qtyKept: 1, qtyReturned: 0 }], payments: [], discount: 0, deliveryFee: 0, feeCharged: 0, createdAt: d(n), dispatchedAt: d(n), returnedAt: d(n), statusDates: { delivered: d(n) } });
  await t.save('couriers', [{ id: 'k1', name: 'Patrick', active: true, zoneIds: ['zone-centre'] }]);
  const k3 = { ...o('K3', -2), number: 'C-L0166', name: 'Client livreur', payments: [{ id: 'pk', at: d(-2), amount: 40000, method: 'cash', receivedBy: 'courier', courierId: 'k1' }] };
  await t.save('orders', [o('K1', -3), o('K2', -3), k3]);
});
await p.goto('http://localhost:5173/#/rapports/versement-semaine'); await p.waitForTimeout(900);
await p.locator('.bw-top-prev').click(); await p.waitForTimeout(400);
const dlg = p.getByRole('dialog');
ok(/3 vente\(s\)/.test(N(await dlg.innerText())), 'liste : 3 ventes impayées (dont 1 argent chez le livreur)');
if (process.env.SHOT) await dlg.screenshot({ path: process.env.SHOT });
await dlg.locator('tr', { hasText: 'C-K0270' }).getByRole('button', { name: 'Annulé' }).click(); await p.waitForTimeout(300);
await p.waitForTimeout(900);
const r = await p.evaluate(() => { const t = window.__tsena; return { st: t.get('orders', 'K1').status, stock: t.all('stockMoves').filter((m) => m.variantId === 'va').reduce((s, m) => s + m.qty, 0) }; });
ok(r.st === 'cancelled' && r.stock === 9, `C-K0270 annulée, stock remis (9) — ${JSON.stringify(r)}`);
const t2 = N(await p.getByRole('dialog').first().innerText()), top2 = N(await p.getByRole('dialog').first().locator('.table-wrap').first().innerText());
ok(/2 vente\(s\)/.test(t2) && !/C-K0270/.test(top2) && /C-K0270 .*Annulé/.test(N(await p.locator('.bw-done').innerText())), `liste : il reste 1 vente (${t2.slice(0, 120)})`);
// Argent chez le livreur : un clic sur « Payé » règle directement la commande avec le livreur (argent déjà reçu).
await p.getByRole('dialog').first().locator('tr', { hasText: 'C-L0166' }).getByRole('button', { name: 'Payé' }).click(); await p.waitForTimeout(900);
ok(await p.getByRole('dialog').count() === 1, 'pas de fenêtre en plus');
const k3 = await p.evaluate(() => { const t = window.__tsena; return { settled: !!t.get('orders', 'K3').courierSettledAt, cash: t.all('cashMoves').filter((m) => m.type === 'courier_settlement').length }; });
ok(k3.settled && k3.cash === 0, `C-L0166 réglée avec le livreur, sans mouvement de caisse (${JSON.stringify(k3)})`);
// Reste client : un clic sur « Payé » note le reste payé en espèces.
await p.getByRole('dialog').first().locator('tr', { hasText: 'C-K0271' }).getByRole('button', { name: 'Payé' }).click(); await p.waitForTimeout(900);
const k2 = await p.evaluate(() => window.__tsena.get('orders', 'K2').payments);
ok(k2.length === 1 && k2[0].amount === 40000 && k2[0].method === 'cash', `C-K0271 : 40 000 payé en espèces (${JSON.stringify(k2)})`);
const t3 = N(await p.getByRole('dialog').first().innerText());
ok(/0 vente\(s\)/.test(t3), `liste vide (${t3.slice(0, 80)})`);
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); await b.close(); process.exit(fail ? 1 : 0);
