// Commandes : filtre « Date de paiement » séparé de la « Date de la commande ».
// Vente d'hier 100 000 : 50 000 payés hier, 50 000 aujourd'hui (1er paiement du reste).
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
  const t = window.__tsena; const now = new Date(); const Y = new Date(now.getTime() - 86400000).toISOString(), T = now.toISOString();
  await t.save('categories', [{ id: 'pg1', name: 'Hotel' }]);
  await t.save('products', [{ id: 'p1', code: 'SV', name: 'Savon', categoryId: 'pg1', priceRetail: 100000, active: true }]);
  await t.save('variants', [{ id: 'v1', productId: 'p1', sku: 'SV', active: true }]);
  await t.save('stockMoves', [{ variantId: 'v1', qty: 50, type: 'initial', at: Y }]);
  await t.save('orders', [
    { id: 'A', number: 'C-A', kind: 'order', channel: 'facebook', phone: '0341110000', name: 'Client A', status: 'delivered', pickedUp: true, zoneId: 'zone-boutique', dispatchedAt: Y, createdAt: Y, discount: 0, deliveryFee: 0, lines: [{ id: 'l', variantId: 'v1', qty: 1, unitPrice: 100000, qtyKept: 1 }], payments: [{ id: 'a', at: Y, amount: 50000, method: 'cash', receivedBy: 'shop' }, { id: 'b', at: T, amount: 50000, method: 'mvola', receivedBy: 'shop', ref: 'X' }] },
    { id: 'B', number: 'C-B', kind: 'order', channel: 'facebook', phone: '0341110001', name: 'Client B', status: 'delivered', pickedUp: true, zoneId: 'zone-boutique', dispatchedAt: T, createdAt: T, discount: 0, deliveryFee: 0, lines: [{ id: 'l2', variantId: 'v1', qty: 1, unitPrice: 100000, qtyKept: 1 }], payments: [{ id: 'c', at: T, amount: 100000, method: 'cash', receivedBy: 'shop' }] },
  ]);
});
await p.goto('http://localhost:5173/#/commandes/toutes'); await p.waitForTimeout(400);
await p.getByLabel('Date de la commande', { exact: true }).selectOption('all');
await p.getByLabel('Date de paiement', { exact: true }).selectOption('today'); await p.waitForTimeout(400);
let tx = N(await p.locator('main').innerText());
ok(tx.includes('C-A') && tx.includes('C-B') && tx.includes('50 000 Ar MVola (1er paiement du reste)'), 'payé aujourd’hui : C-A (reste d’hier 50 000 MVola) et C-B');
ok(/Reçu à la date de paiement[\s\S]*Espèces 100 000 Ar[\s\S]*MVola 50 000 Ar[\s\S]*Total 150 000 Ar/.test(tx), 'reçu aujourd’hui : espèces 100 000 + MVola 50 000 = 150 000');
if (!/Total 150 000 Ar/.test(tx)) console.log(tx.slice(0, 1500));
await p.getByLabel('Date de paiement', { exact: true }).selectOption('yesterday'); await p.waitForTimeout(400);
tx = N(await p.locator('main').innerText());
ok(tx.includes('C-A') && !tx.includes('C-B') && /Total 50 000 Ar/.test(tx.split('Reçu à la date de paiement')[1] || ''), 'payé hier : seulement C-A, 50 000');
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); await b.close(); process.exit(fail ? 1 : 0);
