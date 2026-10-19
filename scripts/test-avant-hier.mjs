// Filtre « Avant-hier » (date de la commande et date de paiement).
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
  const t = window.__tsena; const now = Date.now(); const D = (n) => new Date(now - n * 86400000).toISOString();
  await t.save('categories', [{ id: 'pg1', name: 'Hotel' }]);
  await t.save('products', [{ id: 'p1', code: 'SV', name: 'Savon', categoryId: 'pg1', priceRetail: 10000, active: true }]);
  await t.save('variants', [{ id: 'v1', productId: 'p1', sku: 'SV', active: true }]);
  const o = (id, n, pay) => ({ id, number: id, kind: 'order', channel: 'facebook', phone: '03411100' + n, name: 'Client ' + id, status: 'confirmed', createdAt: D(n), discount: 0, deliveryFee: 0, lines: [{ id: 'l' + id, variantId: 'v1', qty: 1, unitPrice: 10000 }], payments: pay });
  await t.save('orders', [o('AH-1', 2, [{ id: 'x', at: D(1), amount: 10000, method: 'cash', receivedBy: 'shop' }]), o('H-1', 1, []), o('J-1', 0, [])]);
});
await p.goto('http://localhost:5173/#/commandes/enregistrees'); await p.waitForTimeout(400);
await p.getByLabel('Date de la commande', { exact: true }).selectOption('beforeYesterday'); await p.waitForTimeout(300);
let tx = N(await p.locator('main').innerText());
ok(tx.includes('AH-1') && !/(^|[^A])H-1/.test(tx) && !tx.includes('J-1'), 'date de la commande : avant-hier'); if (!tx.includes('AH-1')) console.log(tx.slice(0, 800));
await p.getByLabel('Date de la commande', { exact: true }).selectOption('all');
await p.getByLabel('Date de paiement', { exact: true }).selectOption('yesterday'); await p.waitForTimeout(300);
tx = N(await p.locator('main').innerText());
ok(tx.includes('AH-1') && /Total 10 000 Ar/.test(tx.split('Reçu à la date de paiement')[1] || ''), 'commande d’avant-hier payée hier');
// Il y a 3 jours (ex. lundi → vendredi)
await p.evaluate(async () => { const t = window.__tsena; await t.save('orders', [{ id: 'V3', number: 'V3-J', kind: 'order', channel: 'facebook', phone: '0341119999', name: 'Client V', status: 'confirmed', createdAt: new Date(Date.now() - 3 * 86400000).toISOString(), discount: 0, deliveryFee: 0, lines: [{ id: 'lv', variantId: 'v1', qty: 1, unitPrice: 10000 }], payments: [] }]); });
await p.getByLabel('Date de paiement', { exact: true }).selectOption('all');
await p.getByLabel('Date de la commande', { exact: true }).selectOption('d3'); await p.waitForTimeout(300);
tx = N(await p.locator('main').innerText());
ok(tx.includes('V3-J') && !tx.includes('AH-1'), 'il y a 3 jours');
const labels = await p.getByLabel('Date de la commande', { exact: true }).locator('option').allInnerTexts();
ok(labels[0].startsWith('Il y a 7 jours (') && labels.includes('La semaine dernière'), 'choix : 7 jours en arrière avec le nom du jour, semaine dernière');
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); await b.close(); process.exit(fail ? 1 : 0);
