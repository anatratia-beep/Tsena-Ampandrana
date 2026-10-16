// Commande partie hier, annulée ou rendue en partie ce matin : déduite des ventes d'hier, rien de négatif aujourd'hui.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 1280, height: 1000 }, timezoneId: 'Indian/Antananarivo' })).newPage();
const N = (t) => t.replace(/[  ]/g, ' ');
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
await p.evaluate(async () => {
  const t = window.__tsena; const now = new Date(); const y = new Date(now.getTime() - 86400000); const Y = y.toISOString(), T = now.toISOString();
  await t.save('categories', [{ id: 'pg1', name: 'Talon' }]);
  await t.save('products', [{ id: 'p1', code: 'TR38', name: 'Tresse 38', categoryId: 'pg1', priceRetail: 55000, active: true }, { id: 'p2', code: 'TR39', name: 'Tresse 39', categoryId: 'pg1', priceRetail: 55000, active: true }]);
  await t.save('variants', [{ id: 'v1', productId: 'p1', sku: 'TR38', active: true }, { id: 'v2', productId: 'p2', sku: 'TR39', active: true }]);
  await t.save('stockMoves', [{ variantId: 'v1', qty: 10, type: 'initial', at: Y }, { variantId: 'v2', qty: 10, type: 'initial', at: Y }]);
  await t.save('couriers', [{ id: 'k1', name: 'Solo', active: true }]);
  const o = (id, extra) => ({ id, number: id, kind: 'order', channel: 'facebook', phone: '0340000000', zoneId: 'zone-centre', courierId: 'k1', deliveryFee: 0, dispatchedAt: Y, createdAt: Y, payments: [], discount: 0, ...extra });
  await t.save('orders', [
    o('ANNUL', { status: 'cancelled', statusDates: { cancelled: T }, lines: [{ id: 'a', variantId: 'v1', qty: 1, unitPrice: 55000 }] }),
    o('PART', { status: 'partial', returnedAt: T, lines: [{ id: 'b', variantId: 'v1', qty: 1, unitPrice: 55000, qtyKept: 0, qtyReturned: 1 }, { id: 'c', variantId: 'v2', qty: 1, unitPrice: 55000, qtyKept: 1, qtyReturned: 0 }], payments: [{ id: 'p', at: T, amount: 55000, method: 'cash', receivedBy: 'courier', courierId: 'k1' }] }),
  ]);
});
const situ = async (label) => { await p.goto('http://localhost:5173/#/'); await p.waitForTimeout(500); const sel = p.locator('.situation-card select').first(); await sel.selectOption({ label }); await p.waitForTimeout(400); return N(await p.locator('.situation-card').innerText()); };
let tx = await situ('Hier');
ok(/= Ventes\s*55 000 Ar/.test(tx), 'hier : ventes 55 000 Ar (annulée et article revenu déduits)');
if (!/= Ventes\s*55 000 Ar/.test(tx)) console.log(tx.slice(0, 700));
tx = await situ("Aujourd'hui");
ok(!/−\s*\d/.test(tx.split('Total commandes')[1] || '') && !tx.includes('-55') && (tx.includes('Aucune activité') || /= Ventes\s*0 Ar/.test(tx)), 'aujourd’hui : rien de négatif');
if (tx.includes('-55')) console.log(tx.slice(0, 700));
await p.goto('http://localhost:5173/#/'); await p.waitForTimeout(500);
tx = N(await p.locator('main').innerText());
ok(!/-\s?55 000/.test(tx), 'meilleures ventes : pas de négatif');
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); await b.close(); process.exit(fail ? 1 : 0);
