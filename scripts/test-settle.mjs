import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const W = Number(process.argv[2] || 1280);
const p = await (await b.newContext({ viewport: { width: W, height: 900 }, timezoneId: 'Indian/Antananarivo' })).newPage();
const N = (t) => t.replace(/[  ]/g, ' ');
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
await p.evaluate(async () => { const t = window.__tsena; const now = new Date().toISOString();
  await t.save('categories', [{ id: 'pg1', name: 'Pyjamas' }, { id: 'pg2', name: 'Lampes' }]);
  await t.save('products', [{ id: 'p1', code: 'PJ', name: 'Pyjama', categoryId: 'pg1', priceRetail: 20000, active: true }, { id: 'p2', code: 'LM', name: 'Lampe', categoryId: 'pg2', priceRetail: 30000, active: true }]);
  await t.save('variants', [{ id: 'v1', productId: 'p1', sku: 'PJ', active: true }, { id: 'v2', productId: 'p2', sku: 'LM', active: true }]);
  await t.save('stockMoves', [{ variantId: 'v1', qty: 20, type: 'initial', at: now }, { variantId: 'v2', qty: 20, type: 'initial', at: now }]);
  await t.save('couriers', [{ id: 'k1', name: 'Rado', active: true }, { id: 'k2', name: 'Soa', active: true }]);
  const o = (id, num, name, cid, vid, price, extra = {}) => ({ id, number: num, kind: 'order', channel: 'facebook', phone: '034111' + id.slice(1).padStart(4, '0'), name, zoneId: 'zone-centre', place: 'Analakely', courierId: cid, status: 'out', dispatchedAt: now, lines: [{ id: 'l' + id, variantId: vid, qty: 1, unitPrice: price }], payments: [], discount: 0, deliveryFee: 3000, createdAt: now, ...extra });
  await t.save('orders', [o('o1', 'C-1', 'Fara Un', 'k1', 'v1', 20000), o('o2', 'C-2', 'Fara Deux', 'k1', 'v2', 30000), o('o3', 'C-3', 'Fara Trois', 'k2', 'v1', 20000),
    o('o4', 'C-4', 'Fara Ancienne', undefined, 'v1', 20000, { status: 'delivered', returnedAt: now, courierSettledAt: now, lines: [{ id: 'l4', variantId: 'v1', qty: 1, unitPrice: 20000, qtyKept: 1, qtyReturned: 0 }] })]);
});
// recherche limitée à l'onglet
await p.goto('http://localhost:5173/#/commandes/livraison'); await p.waitForTimeout(400);
await p.getByLabel('Rechercher', { exact: true }).fill('fara'); await p.waitForTimeout(200);
let tx = N(await p.locator('main').innerText());
ok(tx.includes('Fara Un') && !tx.includes('Fara Ancienne'), 'recherche dans « En livraison » : pas les commandes terminées');
ok(/Aussi trouvé dans : Terminées \(1\)/.test(tx), 'indique « Aussi trouvé dans : Terminées (1) »');
await p.getByLabel('Rechercher', { exact: true }).fill('');
await p.getByLabel('Page', { exact: true }).selectOption('pg2'); await p.waitForTimeout(200);
tx = N(await p.locator('main').innerText());
ok(tx.includes('Fara Deux') && !tx.includes('Fara Un'), 'filtre par page');
await p.getByLabel('Page', { exact: true }).selectOption('');
await p.getByLabel('Livreur', { exact: true }).selectOption('k2'); await p.waitForTimeout(200);
tx = N(await p.locator('main').innerText());
ok(tx.includes('Fara Trois') && !tx.includes('Fara Un'), 'filtre par livreur');
// confirmer les retours (sans règlement)
for (const id of ['o1', 'o2', 'o3']) {
  await p.goto(`http://localhost:5173/#/commandes/${id}`); await p.waitForTimeout(350);
  await p.getByRole('button', { name: 'Confirmer le retour du livreur' }).click(); await p.waitForTimeout(200);
  await p.getByRole('dialog').getByRole('button', { name: 'Confirmer le retour' }).click(); await p.waitForTimeout(400);
}
ok((await p.evaluate(() => ['o1', 'o2', 'o3'].every((id) => !window.__tsena.get('orders', id).courierSettledAt))), 'retours confirmés, pas encore réglés');
await p.goto('http://localhost:5173/#/commandes/regler'); await p.waitForTimeout(400);
await p.getByRole('button', { name: 'Effacer les filtres' }).click(); await p.waitForTimeout(200); // le filtre livreur est gardé d’un écran à l’autre
tx = N(await p.locator('main').innerText());
ok(tx.includes('Fara Un') && tx.includes('Fara Trois') && !tx.includes('Fara Ancienne'), 'onglet « À régler » : les 3 commandes');
await p.getByLabel('Tout sélectionner').check(); await p.waitForTimeout(150);
ok(await p.getByRole('button', { name: 'Régler la sélection' }).isDisabled() && N(await p.locator('main').innerText()).includes('Plusieurs livreurs'), 'plusieurs livreurs : règlement bloqué');
await p.getByLabel('Livreur', { exact: true }).selectOption('k1'); await p.waitForTimeout(200);
await p.getByLabel('Tout sélectionner').check(); await p.waitForTimeout(150);
tx = N(await p.locator('main').innerText());
ok(tx.includes('Rado doit verser 56 000 Ar'), 'sélection : Rado doit verser 56 000 (50 000 + 2 × 3 000)');
await p.getByRole('button', { name: 'Régler la sélection' }).click(); await p.waitForTimeout(300);
const sd = p.getByRole('dialog');
ok(N(await sd.locator('.ml-expected').innerText()).includes('50 000'), 'règlement de 2 commandes : il remet 50 000 (frais gardés)');
await sd.getByRole('button', { name: /Valider le règlement/ }).click(); await p.waitForTimeout(700);
ok(await p.evaluate(() => !!window.__tsena.get('orders', 'o1').courierSettledAt && !!window.__tsena.get('orders', 'o2').courierSettledAt && !window.__tsena.get('orders', 'o3').courierSettledAt), 'les 2 commandes de Rado réglées, celle de Soa reste');
await p.getByLabel('Livreur', { exact: true }).selectOption(''); await p.waitForTimeout(200);
tx = N(await p.locator('main').innerText());
ok(tx.includes('Fara Trois') && !tx.includes('Fara Un'), 'À régler : il reste la commande de Soa');
await p.getByRole('tab', { name: /Terminées/ }).click(); await p.waitForTimeout(300);
ok(N(await p.locator('main').innerText()).includes('Fara Un'), 'commandes réglées dans « Terminées »');
const sw = await p.evaluate(() => document.documentElement.scrollWidth); ok(sw <= W + 1, `pas de débordement (${sw})`);
console.log(fail ? `${fail} ÉCHEC(S)` : 'TOUT EST BON'); await b.close();
