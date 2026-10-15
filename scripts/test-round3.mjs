// Série 3 : paiements multiples à la création d'une commande (montant « 20.000 »), articles en double (PH6 dans deux
// pages), tri par date d'ajout, heures du compte boost réglables, export de l'historique des inventaires, bandeau
// « Logiciel mis à jour », annulation d'un achat reçu.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const W = Number(process.argv[2] || 1280);
const p = await (await b.newContext({ viewport: { width: W, height: 900 }, timezoneId: 'Indian/Antananarivo', acceptDownloads: true })).newPage();
const N = (t) => t.replace(/[  ]/g, ' ');
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
await p.evaluate(async () => {
  const t = window.__tsena; const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  await t.save('categories', [{ id: 'pyj', name: 'PYJAMAS HOMME' }, { id: 'box', name: 'BOX HOMME' }]);
  const mk = (id, code, name, cat, d) => ({ id, code, name, categoryId: cat, priceRetail: 48000, active: true, photo: png, createdAt: d });
  await t.save('products', [mk('p1', 'PYJHOMME-PH6-ML-L', 'PH6 ML L', 'pyj', '2026-10-01T08:00:00Z'), mk('p2', 'PYJHOMME-PH6-ML-XL', 'PH6 ML XL', 'pyj', '2026-10-01T08:00:00Z'),
    mk('b1', 'BOXHOMME-PH6-L', 'PH6 L', 'box', '2026-10-05T08:00:00Z'), mk('b2', 'BOXHOMME-PH6-XL', 'PH6 XL', 'box', '2026-10-05T08:00:00Z')]);
  await t.save('variants', ['p1', 'p2', 'b1', 'b2'].map((id) => ({ id: 'v' + id, productId: id, sku: id.toUpperCase(), costAvg: 22842, active: true })));
  await t.save('stockMoves', ['p1', 'p2', 'b1', 'b2'].map((id) => ({ variantId: 'v' + id, qty: 9, type: 'initial', at: new Date().toISOString() })));
});
const stock = (v) => p.evaluate((id) => window.__tsena.all('stockMoves').filter((m) => m.variantId === id).reduce((s, m) => s + m.qty, 0), v);
// 1. Bandeau de mise à jour + version
ok(await p.locator('.version-line').count() > 0 && N(await p.locator('.version-line').first().innerText()).includes('Version du'), 'version affichée en bas du menu');
await p.evaluate(async () => { const r = indexedDB.open('tsena'); await new Promise((ok) => { r.onsuccess = () => { const tx = r.result.transaction('_meta', 'readwrite'); tx.objectStore('_meta').put('2026-10-12T10:00:00.000Z', 'seenBuild'); tx.oncomplete = ok; }; }); });
await p.reload(); await p.waitForTimeout(1200);
ok(N(await p.locator('body').innerText()).includes('Logiciel mis à jour'), 'bandeau « Logiciel mis à jour » avec les nouveautés');
await p.getByRole('button', { name: 'Compris' }).click(); await p.waitForTimeout(300);
ok(!N(await p.locator('body').innerText()).includes('Logiciel mis à jour'), 'bandeau fermé après « Compris »');
// 2. Doublons
await p.goto('http://localhost:5173/#/articles'); await p.waitForTimeout(600);
let tx = N(await p.locator('main').innerText());
ok(tx.includes('Articles en double (2)'), 'doublons repérés : 2 groupes (L et XL)');
await p.getByRole('button', { name: 'Articles en double (2)' }).click(); await p.waitForTimeout(300);
await p.getByRole('dialog').getByRole('button', { name: 'PYJAMAS HOMME' }).click();
await p.getByRole('dialog').getByRole('button', { name: /Archiver les doublons \(2/ }).click(); await p.waitForTimeout(800);
const st = await p.evaluate(() => ({ b1: window.__tsena.get('products', 'b1').active, p1: window.__tsena.get('products', 'p1').active }));
ok(st.b1 === false && st.p1 !== false && await stock('vb1') === 0 && await stock('vp1') === 9, 'doublons BOX archivés (stock 0), PYJAMAS gardés (stock 9)');
await p.keyboard.press('Escape'); await p.waitForTimeout(200);
await p.goto('http://localhost:5173/#/vente'); await p.waitForTimeout(500);
await p.getByLabel('Rechercher un article').fill('PH6'); await p.waitForTimeout(300);
tx = N(await p.locator('.pos-results').innerText());
ok(tx.includes('PH6 ML L') && !tx.includes('BOXHOMME') && !/PH6 L\b/.test(tx), 'recherche PH6 : seulement les vrais articles');
// 3. (Tri des articles retiré à la demande : les articles sont regroupés par catégorie.)
// 4. Commande avec deux paiements dont « 20.000 »
await p.goto('http://localhost:5173/#/commandes'); await p.waitForTimeout(500);
await p.getByRole('button', { name: 'Nouvelle commande' }).click(); await p.waitForTimeout(300);
const f = p.getByRole('dialog');
await f.getByLabel('Contact du client').fill('0341234567');
await f.getByLabel('Zone de livraison').selectOption('zone-retrait');
await f.getByRole('button', { name: 'Ajouter un article' }).click(); await p.waitForTimeout(300);
const pick = p.getByRole('dialog').last();
await pick.getByLabel('Rechercher un article').fill('PH6 ML L'); await p.waitForTimeout(200);
await pick.getByRole('button', { name: /PH6 ML L/ }).first().click(); await p.waitForTimeout(200);
await pick.getByLabel('Vendu').first().fill('1');
await pick.getByRole('button', { name: 'Ajouter', exact: true }).click(); await p.waitForTimeout(300);
await f.getByLabel('Montant (Ar)').fill('20.000');
await f.getByLabel('Moyen').first().selectOption('cash');
await f.getByRole('button', { name: 'Ajouter un autre moyen de paiement' }).click();
await f.getByLabel('Montant 2 (Ar)').fill('28 000 Ar');
await f.getByLabel('Moyen').nth(1).selectOption('mvola');
await f.getByRole('button', { name: /Enregistrer/ }).last().click(); await p.waitForTimeout(800);
const o = await p.evaluate(() => window.__tsena.all('orders').find((x) => x.phone === '0341234567'));
ok(o && o.payments.length === 2 && o.payments[0].amount === 20000 && o.payments[1].amount === 28000 && o.payments[1].method === 'mvola', 'commande : 2 paiements enregistrés (20 000 espèces + 28 000 MVola)');
await p.goto(`http://localhost:5173/#/commandes/${o.id}`); await p.waitForTimeout(500);
tx = N(await p.locator('main').innerText());
ok(tx.includes('Paiements') && tx.includes('20 000 Ar') && tx.includes('28 000 Ar'), 'paiements visibles dans la commande');
// 5. Heures du compte boost
await p.goto('http://localhost:5173/#/parametres/societe'); await p.waitForTimeout(500);
await p.getByLabel('Heure limite compte boost lundi').fill('16:30');
await p.getByRole('button', { name: /Enregistrer/ }).first().click(); await p.waitForTimeout(500);
const c = await p.evaluate(() => window.__tsena.get('settings', 'company'));
ok(c.boostDeadlines?.['1'] === '16:30', 'heure limite du lundi réglée à 16:30');
// 6. Historique des inventaires : export
await p.evaluate(async () => { const t = window.__tsena; await t.save('inventories', { id: 'i1', number: 'INV-0001', at: new Date().toISOString(), byName: 'Super-admin', pageIds: [], lines: [{ variantId: 'vp1', sku: 'P1', name: 'PH6 ML L', pageId: 'pyj', theo: 9, counted: 8, delta: -1, unitCost: 22842 }], counted: 1, gaps: 1, pcsGap: -1, valueGap: -22842, status: 'done' }); });
await p.goto('http://localhost:5173/#/stock/inventaire'); await p.waitForTimeout(500);
await p.getByRole('button', { name: /Historique des inventaires/ }).click(); await p.waitForTimeout(300);
const [dl] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'Excel' }).click()]);
ok(dl.suggestedFilename().includes('inventaires'), 'historique des inventaires exporté en Excel');
ok(await p.getByRole('button', { name: 'PDF A4' }).count() === 1, 'export PDF A4 proposé');
const sw = await p.evaluate(() => document.documentElement.scrollWidth); ok(sw <= W + 1, `pas de débordement (${sw})`);
console.log(fail ? `${fail} ÉCHEC(S)` : 'TOUT EST BON'); await b.close();
