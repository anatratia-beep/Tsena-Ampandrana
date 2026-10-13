// Supprimer une page sans rien perdre : page et articles rangés de côté, ventes et stock gardés, restauration possible ;
// refus tant que des commandes en cours contiennent ses articles.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const W = Number(process.argv[2] || 1280);
const p = await (await b.newContext({ viewport: { width: W, height: 900 }, timezoneId: 'Indian/Antananarivo' })).newPage();
const N = (t) => t.replace(/[  ]/g, ' ');
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
await p.evaluate(async () => {
  const t = window.__tsena; const now = new Date().toISOString();
  await t.save('categories', [{ id: 'pp', name: 'Poignet précieux', code: 'PP' }, { id: 'pps', name: 'Montres hommes', parentId: 'pp' }, { id: 'is', name: 'Intimity style', code: 'IS' }]);
  await t.save('products', [{ id: 'a', code: 'A', name: 'Montre', categoryId: 'pps', priceRetail: 15000, active: true }, { id: 'bx', code: 'B', name: 'Boxer', categoryId: 'is', priceRetail: 5000, active: true }]);
  await t.save('variants', [{ id: 'va', productId: 'a', sku: 'A', costAvg: 5000, active: true }, { id: 'vb', productId: 'bx', sku: 'B', costAvg: 2000, active: true }]);
  await t.save('stockMoves', [{ variantId: 'va', qty: 6, type: 'initial', at: now }, { variantId: 'vb', qty: 6, type: 'initial', at: now }]);
  await t.save('orders', [
    { id: 'S1', number: 'V-1', kind: 'order', channel: 'shop', phone: '', status: 'delivered', lines: [{ id: 'l1', variantId: 'va', qty: 1, unitPrice: 15000, qtyKept: 1 }], payments: [], discount: 0, deliveryFee: 0, createdAt: now },
    { id: 'C2', number: 'C-2', kind: 'order', channel: 'facebook', phone: '0340000000', status: 'ready', lines: [{ id: 'l2', variantId: 'vb', qty: 1, unitPrice: 5000 }], payments: [], discount: 0, deliveryFee: 0, createdAt: now },
  ]);
});
await p.goto('http://localhost:5173/#/pages'); await p.waitForTimeout(500);
// Page avec une commande en cours : refus
await p.getByRole('button', { name: 'Supprimer la page Intimity style' }).click(); await p.waitForTimeout(200);
let dlg = N(await p.getByRole('dialog').innerText());
ok(dlg.includes('Impossible') && dlg.includes('C-2'), 'page avec une commande en cours : suppression refusée (C-2)');
await p.getByRole('dialog').getByRole('button', { name: 'Compris' }).click();
// Page avec articles et stock : rangée de côté
await p.getByRole('button', { name: 'Supprimer la page Poignet précieux' }).click(); await p.waitForTimeout(200);
dlg = N(await p.getByRole('dialog').innerText());
ok(dlg.includes('1 article(s)') && dlg.includes('Rien n’est effacé') && dlg.includes('6 pièce(s)'), 'avertit : 1 article, rien effacé, 6 pièces en stock');
await p.getByRole('dialog').getByLabel(/tapez SUPPRIMER/).fill('SUPPRIMER');
await p.getByRole('dialog').getByRole('button', { name: 'Supprimer la page' }).click(); await p.waitForTimeout(500);
let st = await p.evaluate(() => ({ c: window.__tsena.getRaw('categories', 'pp'), s: window.__tsena.getRaw('categories', 'pps'), pr: window.__tsena.get('products', 'a'), o: window.__tsena.get('orders', 'S1'), m: window.__tsena.all('stockMoves').length }));
ok(st.c.removed && !st.c.deleted && st.s.removed && !st.pr.active && st.pr.removedWithPage === 'pp', 'page, sous-catégorie et article rangés de côté (pas effacés)');
ok(st.o && st.m === 2, 'ventes et mouvements de stock intacts');
let main = N(await p.locator('main').innerText());
ok(main.includes('Pages supprimées (1)'), 'section « Pages supprimées » affichée');
await p.goto('http://localhost:5173/#/rapports/global'); await p.waitForTimeout(700);
main = N(await p.locator('main').innerText());
ok(main.includes('Poignet précieux') && main.includes('15 000 Ar'), 'le récap garde la vente de la page supprimée');
// Restaurer
await p.goto('http://localhost:5173/#/pages'); await p.waitForTimeout(500);
await p.getByText('Pages supprimées (1)').click(); await p.waitForTimeout(200);
await p.getByRole('button', { name: 'Restaurer' }).click(); await p.waitForTimeout(500);
st = await p.evaluate(() => ({ c: window.__tsena.get('categories', 'pp'), s: window.__tsena.get('categories', 'pps'), pr: window.__tsena.get('products', 'a') }));
ok(!st.c.removed && !st.s.removed && st.pr.active && !st.pr.removedWithPage, 'restaurée : page et article de retour en vente');
const sw = await p.evaluate(() => document.documentElement.scrollWidth); ok(sw <= W + 1, `pas de débordement (${sw})`);
console.log(fail ? `${fail} ÉCHEC(S)` : 'TOUT EST BON'); await b.close();
