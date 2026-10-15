// Rapport du jour de chaque vendeur (ses pages) et vue « Rapports des vendeurs » du patron.
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
  await t.save('categories', [{ id: 'pg1', name: 'Pyjamas' }, { id: 'pg2', name: 'Chaussures' }]);
  await t.save('products', [{ id: 'p1', code: 'PJ', name: 'Pyjama', categoryId: 'pg1', priceRetail: 20000, active: true }, { id: 'p2', code: 'CH', name: 'Basket', categoryId: 'pg2', priceRetail: 50000, active: true }]);
  await t.save('variants', [{ id: 'v1', productId: 'p1', sku: 'PJ', size: 'L', active: true }, { id: 'v2', productId: 'p2', sku: 'CH', active: true }]);
  await t.save('stockMoves', [{ variantId: 'v1', qty: 20, type: 'initial', at: now }, { variantId: 'v2', qty: 5, type: 'initial', at: now }, { variantId: 'v1', qty: -3, type: 'sale', at: now }, { variantId: 'v2', qty: -1, type: 'sale', at: now }]);
  const me = t.all('users').find((u) => u.username === 'super-adm');
  await t.save('users', [{ id: me.id, pageIds: ['pg1'] }, { id: 'u2', username: 'rina', fullName: 'Rina', roleId: 'role-seller', active: true, passwordHash: 'x', pageIds: ['pg2'] }]);
  await t.save('orders', [
    { id: 'o1', number: 'V-1', kind: 'order', channel: 'shop', status: 'delivered', deliveredAt: now, lines: [{ id: 'l1', variantId: 'v1', qty: 3, unitPrice: 20000 }], payments: [{ id: 'a', at: now, amount: 40000, method: 'cash', receivedBy: 'shop' }, { id: 'b', at: now, amount: 20000, method: 'mvola', receivedBy: 'shop' }], discount: 0, createdAt: now },
    { id: 'o2', number: 'V-2', kind: 'order', channel: 'shop', status: 'delivered', deliveredAt: now, lines: [{ id: 'l2', variantId: 'v2', qty: 1, unitPrice: 50000 }], payments: [{ id: 'c', at: now, amount: 50000, method: 'cash', receivedBy: 'shop' }], discount: 0, createdAt: now },
    { id: 'o3', number: 'C-3', kind: 'order', channel: 'facebook', status: 'ready', phone: '0341112233', lines: [{ id: 'l3', variantId: 'v1', qty: 1, unitPrice: 20000 }], payments: [], discount: 0, createdAt: now },
  ]);
});
await p.goto('http://localhost:5173/#/mon-rapport'); await p.waitForTimeout(600);
let tx = N(await p.locator('main').innerText());
ok(tx.includes('Mon rapport du jour') && tx.includes('pages : Pyjamas'), 'page du rapport, limitée à mes pages');
ok(/Ventes\s*60 000 Ar/.test(tx) && !tx.includes('Basket'), 'ventes de ma page seulement (60 000 Ar), pas les autres pages');
ok(tx.includes('Pyjama (L)') && /En attente de livraison\s*1/.test(tx) && /Pyjamas\s*17 pcs/.test(tx), 'articles vendus, commandes en cours, stock restant');
await p.getByLabel(/Remarques/).fill('Client Fara à rappeler');
tx = N(await p.locator('pre.recap-text').innerText());
ok(tx.includes('*Ventes : 60 000 Ar*') && tx.includes('Espèces : 40 000 Ar') && tx.includes('MVola : 20 000 Ar') && tx.includes('Client Fara à rappeler'), 'texte WhatsApp complet avec remarques');
await p.getByRole('button', { name: 'Enregistrer sans WhatsApp' }).click(); await p.waitForTimeout(400);
tx = N(await p.locator('main').innerText());
ok(tx.includes('Rapport envoyé le'), 'rapport marqué envoyé');
await p.goto('http://localhost:5173/#/rapports/vendeurs-jour'); await p.waitForTimeout(600);
tx = N(await p.locator('main').innerText());
ok(tx.includes('1 rapport(s) envoyé(s) sur 2') && tx.includes('Pas encore envoyé') && tx.includes('Rina'), 'patron : qui a envoyé, qui ne l’a pas fait');
await p.getByRole('button', { name: /Rina/ }).click(); await p.waitForTimeout(300);
tx = N(await p.locator('main').innerText());
ok(tx.includes('Chiffres actuels') && tx.includes('Basket') && /Ventes\s*50 000 Ar/.test(tx), 'patron : chiffres actuels de Rina (pas encore envoyé)');
await p.getByRole('button', { name: /Super|super/ }).first().click(); await p.waitForTimeout(300);
tx = N(await p.locator('main').innerText());
ok(tx.includes('Client Fara à rappeler'), 'patron : texte du rapport envoyé');
await p.screenshot({ path: process.env.SHOT || '/tmp/dr.png', fullPage: true });
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); await b.close(); process.exit(fail ? 1 : 0);
