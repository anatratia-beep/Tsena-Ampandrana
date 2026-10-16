// Commandes : onglet « Toutes », filtre « Paiement » (impayés, chez le livreur, Mobile Money…) et totaux de la liste.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Indian/Antananarivo' })).newPage();
const N = (t) => t.replace(/[  ]/g, ' ');
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
await p.evaluate(async () => {
  const t = window.__tsena; const now = new Date().toISOString();
  await t.save('categories', [{ id: 'pg1', name: 'Pyjama' }]);
  await t.save('products', [{ id: 'p1', code: 'PJ', name: 'Pyjama', categoryId: 'pg1', priceRetail: 20000, active: true }]);
  await t.save('variants', [{ id: 'v1', productId: 'p1', sku: 'PJ', active: true }]);
  await t.save('stockMoves', [{ variantId: 'v1', qty: 20, type: 'initial', at: now }]);
  await t.save('couriers', [{ id: 'k1', name: 'Solo', active: true }]);
  const o = (id, name, extra) => ({ id, number: 'C-' + id, kind: 'order', channel: 'facebook', phone: '03411100' + id.slice(1), name, zoneId: 'zone-centre', place: 'X', courierId: 'k1', lines: [{ id: 'l' + id, variantId: 'v1', qty: 1, unitPrice: 20000, qtyKept: 1 }], discount: 0, deliveryFee: 0, createdAt: now, ...extra });
  await t.save('orders', [
    o('o1', 'Payé livreur', { status: 'delivered', dispatchedAt: now, returnedAt: now, payments: [{ id: 'a', at: now, amount: 20000, method: 'cash', receivedBy: 'courier', courierId: 'k1' }] }),
    o('o2', 'Impayé', { status: 'delivered', dispatchedAt: now, returnedAt: now, payments: [{ id: 'b', at: now, amount: 5000, method: 'cash', receivedBy: 'courier', courierId: 'k1' }] }),
    o('o3', 'MVola', { status: 'delivered', dispatchedAt: now, returnedAt: now, courierSettledAt: now, payments: [{ id: 'c', at: now, amount: 20000, method: 'mvola', receivedBy: 'shop' }] }),
    o('o4', 'Enregistrée', { status: 'confirmed', payments: [] }),
  ]);
});
const view = async (pay) => { await p.goto('http://localhost:5173/#/commandes/toutes'); await p.waitForTimeout(400); await p.getByLabel('Paiement').selectOption(pay); await p.waitForTimeout(300); return N(await p.locator('main').innerText()); };
let tx = await view('');
ok(tx.includes('Toutes') && /4 commande\(s\)/.test(tx) && /Reste à payer 35 000 Ar/.test(tx), 'onglet Toutes + totaux (4 commandes, reste 35 000)');
if (!/Reste à payer 35 000 Ar/.test(tx)) console.log(tx.slice(0, 1500));
tx = await view('rest');
ok(tx.includes('Impayé') && tx.includes('Enregistrée') && !tx.includes('Payé livreur') && !tx.includes('C-o3'), 'filtre reste à payer');
tx = await view('courier');
ok(tx.includes('Payé livreur') && tx.includes('Impayé') && !tx.includes('C-o3') && /Chez les livreurs 25 000 Ar/.test(tx), 'filtre argent chez le livreur (25 000)');
tx = await view('mobile');
ok(tx.includes('C-o3') && /1 commande\(s\)/.test(tx), 'filtre Mobile Money');
await p.getByLabel('Paiement').selectOption(''); await p.goto('http://localhost:5173/#/commandes/regler'); await p.waitForTimeout(400);
ok(N(await p.locator('main').innerText()).includes('Régler la sélection'), 'admin : bouton Régler la sélection');
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); await b.close(); process.exit(fail ? 1 : 0);
