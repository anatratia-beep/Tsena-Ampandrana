// Commande livrée : l'article donné n'est pas celui saisi → « Changer l'article » (même prix seulement) ; le stock suit, le total ne bouge pas.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Indian/Antananarivo', deviceScaleFactor: Number(process.env.DPR || 1) })).newPage();
const N = (t) => t.replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter'); await p.waitForTimeout(600);
const later = p.getByRole('button', { name: 'Plus tard' }); if (await later.count()) { await later.click(); await p.waitForTimeout(300); }
await p.evaluate(async () => {
  const t = window.__tsena; const at = new Date(Date.now() - 864e5).toISOString();
  await t.save('categories', [{ id: 'pb', name: 'Powerbank' }]);
  await t.save('products', [{ id: 'a', code: 'PB10', name: 'Powerbank 10000', categoryId: 'pb', priceRetail: 50000, active: true }, { id: 'c', code: 'PB20', name: 'Powerbank 20000', categoryId: 'pb', priceRetail: 60000, active: true }]);
  await t.save('variants', [{ id: 'vn', productId: 'a', sku: 'PB10-N', color: 'Noir', active: true }, { id: 'vb', productId: 'a', sku: 'PB10-B', color: 'Blanc', active: true }, { id: 'vc', productId: 'c', sku: 'PB20', active: true }]);
  await t.save('stockMoves', [{ variantId: 'vn', qty: 5, type: 'initial', at }, { variantId: 'vb', qty: 5, type: 'initial', at }, { variantId: 'vc', qty: 5, type: 'initial', at },
    { variantId: 'vn', qty: -1, type: 'sale', refType: 'order', refId: 'O1', at }]);
  await t.save('orders', [{ id: 'O1', number: 'C-P0020', kind: 'order', channel: 'facebook', phone: '0341111111', name: 'Client', status: 'delivered', zoneId: 'zone-centre', courierId: 'k1',
    lines: [{ id: 'l1', variantId: 'vn', qty: 1, unitPrice: 50000, qtyKept: 1, qtyReturned: 0 }], payments: [{ id: 'p', at, amount: 50000, method: 'cash', receivedBy: 'courier', courierId: 'k1' }],
    discount: 0, deliveryFee: 0, feeCharged: 0, createdAt: at, dispatchedAt: at, returnedAt: at, statusDates: { delivered: at } }]);
});
await p.goto('http://localhost:5173/#/commandes/O1'); await p.waitForTimeout(700);
if (process.env.SHOT2) { const bt = p.getByRole('button', { name: 'Changer l’article' }); await bt.scrollIntoViewIfNeeded(); await bt.evaluate((e) => { e.style.outline = '3px solid red'; e.style.outlineOffset = '2px'; }); await p.screenshot({ path: process.env.SHOT2 }); }
await p.getByRole('button', { name: 'Changer l’article' }).click(); await p.waitForTimeout(300);
const dlg = p.getByRole('dialog'); const t = N(await dlg.innerText());
ok(/Powerbank 10000.*Blanc/.test(t) && !/PB20/.test(t), `même prix seulement : Blanc proposé, PB20 (60 000) non (${t.slice(0, 200)})`);
await dlg.getByText('Blanc').first().click(); await p.waitForTimeout(150);
if (process.env.SHOT) await dlg.screenshot({ path: process.env.SHOT });
await dlg.getByRole('button', { name: 'Enregistrer' }).click(); await p.waitForTimeout(700);
const r = await p.evaluate(() => { const t = window.__tsena; const st = (v) => t.all('stockMoves').filter((m) => m.variantId === v).reduce((s, m) => s + m.qty, 0); const o = t.get('orders', 'O1'); return { v: o.lines[0].variantId, price: o.lines[0].unitPrice, n: st('vn'), b: st('vb'), ev: o.events?.at(-1)?.text }; });
ok(r.v === 'vb' && r.price === 50000, 'ligne : Blanc, prix 50 000 inchangé');
ok(r.n === 5 && r.b === 4, `stock : Noir revient (5), Blanc sort (4) — ${r.n}/${r.b}`);
ok(/Article changé/.test(r.ev || ''), `historique : ${r.ev}`);
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); await b.close(); process.exit(fail ? 1 : 0);
