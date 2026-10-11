import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const W = Number(process.argv[2] || 1280);
const p = await (await b.newContext({ viewport: { width: W, height: 900 }, timezoneId: 'Indian/Antananarivo' })).newPage();
const N = (t) => t.replace(/[\u202f\u00a0]/g, ' ');
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
await p.evaluate(async () => { const t = window.__tsena; const now = new Date().toISOString();
  await t.save('products', [{ id: 'pj', code: 'PJ', name: 'Pyjama lapin', priceRetail: 20000, active: true, tiers: [{ qty: 3, price: 50000 }] }, { id: 'lm', code: 'LM', name: 'Lampe moto', priceRetail: 30000, active: true }, { id: 'pc', code: 'PC', name: 'Porte-clé', priceRetail: 3000, active: true }]);
  await t.save('variants', [{ id: 'pjr', productId: 'pj', sku: 'PJ R', color: 'Rose', costAvg: 8000, active: true }, { id: 'pjb', productId: 'pj', sku: 'PJ B', color: 'Bleu', costAvg: 8000, active: true }, { id: 'lmv', productId: 'lm', sku: 'LM', costAvg: 12000, active: true }, { id: 'pcv', productId: 'pc', sku: 'PC', costAvg: 800, active: true }]);
  await t.save('stockMoves', [{ variantId: 'pjr', qty: 10, type: 'initial', at: now }, { variantId: 'pjb', qty: 10, type: 'initial', at: now }, { variantId: 'lmv', qty: 5, type: 'initial', at: now }, { variantId: 'pcv', qty: 5, type: 'initial', at: now }]);
  await t.save('couriers', { id: 'k1', name: 'Rado', active: true, zoneIds: ['zone-centre'] });
});
const stock = (vid) => p.evaluate((v) => window.__tsena.all('stockMoves').filter((m) => m.variantId === v).reduce((s, m) => s + m.qty, 0), vid);

// 1. Créer un lot par l'interface
await p.goto('http://localhost:5173/#/articles'); await p.waitForTimeout(400);
await p.getByRole('button', { name: 'Nouvel article' }).click();
await p.getByRole('button', { name: /Lot ou promotion/ }).click();
const dlg = p.getByRole('dialog');
await dlg.getByLabel('Nom du lot').fill('Pack 3 pyjamas');
await dlg.getByLabel('Prix du lot (Ar)').fill('45000');
await dlg.getByLabel('Ajouter un article au lot').fill('pyjama'); await p.waitForTimeout(150);
await dlg.getByRole('button', { name: /Pyjama lapin/ }).click();
await dlg.getByLabel('Quantité Pyjama lapin').fill('3');
ok(N(await dlg.innerText()).includes('60 000') && N(await dlg.innerText()).includes('15 000'), 'résumé : séparément 60 000, le client gagne 15 000');
await dlg.getByRole('button', { name: 'Créer le lot' }).click(); await p.waitForTimeout(500);
ok((await p.locator('main').innerText()).includes('Contenu du lot'), 'fiche du lot ouverte');
ok(/Lots possibles \(stock\)\s*6/.test(await p.locator('main').innerText()), 'lots possibles = 6 (20 pyjamas / 3)');
// Promo lampe + porte-clé offert (données)
await p.evaluate(async () => { await window.__tsena.save('products', { id: 'promo', kind: 'lot', code: 'PROMO1', name: 'Lampe + porte-clé offert', priceRetail: 30000, active: true, lot: { items: [{ id: 'a', productId: 'lm', qty: 1 }, { id: 'b', productId: 'pc', qty: 1, gift: true }] } }); });

// 2. Vente sur place d'un lot avec couleurs au choix
await p.goto('http://localhost:5173/#/vente'); await p.waitForTimeout(400);
await p.getByLabel('Rechercher un article').fill('pack'); await p.waitForTimeout(200);
await p.locator('.pos-results').getByRole('button', { name: /Pack 3 pyjamas/ }).click(); await p.waitForTimeout(200);
const lp = p.getByRole('dialog');
ok(await lp.getByRole('button', { name: /Choisissez les couleurs/ }).isDisabled(), 'ajout bloqué tant que les couleurs ne sont pas choisies');
await lp.getByLabel('Pyjama lapin Rose').fill('2'); await lp.getByLabel('Pyjama lapin Bleu').fill('1');
await lp.getByRole('button', { name: /Ajouter le lot/ }).click(); await p.waitForTimeout(200);
const cart = N(await p.locator('#pos-cart').innerText());
ok(cart.includes('Prix du lot') && cart.includes('45 000'), 'panier : ligne « prix du lot », total 45 000');
await p.getByRole('button', { name: /Encaisser 45/ }).click(); await p.getByRole('button', { name: 'Valider la vente' }).click(); await p.waitForTimeout(500);
ok(await stock('pjr') === 8 && await stock('pjb') === 9, 'stock : 2 roses et 1 bleu sortis');

// 3. Prix par quantité
await p.getByLabel('Rechercher un article').fill('PJ'); await p.keyboard.press('Enter'); await p.waitForTimeout(200);
await p.locator('#pos-cart .qty-input').first().fill('3'); await p.waitForTimeout(200);
ok(N(await p.locator('#pos-cart').innerText()).includes('3 pour 50 000') && await p.getByRole('button', { name: /Encaisser 50 000/ }).count() === 1, 'prix par quantité : 3 pyjamas = 50 000');
const qi = p.locator('#pos-cart .qty-input').first(); await qi.fill('4'); await p.waitForTimeout(150);
ok(await p.getByRole('button', { name: /Encaisser 70 000/ }).count() === 1, '4 pyjamas = 50 000 + 20 000');
await p.getByRole('button', { name: 'Vider' }).click();

// 4. Commande avec la promo, retour partiel (porte-clé gardé, lampe rendue) → prix normal
await p.evaluate(async () => { const t = window.__tsena; const now = new Date().toISOString(); const key = 'K1';
  const lines = [{ id: 'x1', variantId: 'lmv', qty: 1, unitPrice: 30000, lotKey: key, lotProductId: 'promo', lotItem: 'a', lotPer: 1, lotN: 1, lotPrice: 30000 }, { id: 'x2', variantId: 'pcv', qty: 1, unitPrice: 3000, lotKey: key, lotProductId: 'promo', lotItem: 'b', lotPer: 1, lotN: 1, lotPrice: 30000, gift: true }];
  await t.save('orders', { id: 'oc', number: 'C-T1', kind: 'order', channel: 'facebook', phone: '0341234567', zoneId: 'zone-centre', place: 'Analakely', courierId: 'k1', deliveryFee: 3000, status: 'ready', lines, adjusts: [{ id: 'lot_K1', kind: 'lot', productId: 'promo', lotKey: key, qty: 1, unit: -3000, items: [{ id: 'a', qty: 1 }, { id: 'b', qty: 1 }], refVariantId: 'lmv' }], payments: [], discount: 0, createdAt: now });
});
await p.goto('http://localhost:5173/#/commandes/oc'); await p.waitForTimeout(400);
let main = N(await p.locator('main').innerText());
ok(main.includes('Prix du lot') && /Total\s*33 000/.test(main), 'commande : lot 30 000 + frais 3 000 = 33 000');
await p.getByRole('button', { name: /Remettre au livreur/ }).click(); await p.getByRole('dialog').getByRole('button', { name: 'Remettre' }).click(); await p.waitForTimeout(400);
ok(await stock('lmv') === 4 && await stock('pcv') === 4, 'remise au livreur : lampe et porte-clé sortis');
await p.getByRole('button', { name: /Confirmer le retour du livreur/ }).click(); await p.waitForTimeout(200);
const rd = p.getByRole('dialog');
await rd.getByLabel('Gardé').first().fill('0'); await p.waitForTimeout(200);
const rtxt = N(await rd.innerText());
ok(rtxt.includes('lot incomplet') && /À payer par le client \(a \+ b\)\s*6 000/.test(rtxt), 'retour : lampe rendue → porte-clé au prix normal 3 000 + frais 3 000');

await rd.getByRole('button', { name: 'Confirmer le retour' }).click(); await p.waitForTimeout(500);
main = N(await p.locator('main').innerText());
ok(/Articles\s*3 000/.test(main), 'commande terminée : articles 3 000 (prix normal)');
ok(await stock('lmv') === 5, 'lampe revenue en stock');

// 5. Lot proposé dans « Nouvelle commande » et masqué quand la promotion est finie
await p.evaluate(async () => { await window.__tsena.save('products', { id: 'promo', lot: { items: [{ id: 'a', productId: 'lm', qty: 1 }, { id: 'b', productId: 'pc', qty: 1, gift: true }], to: '2020-01-01' } }); });
await p.goto('http://localhost:5173/#/vente'); await p.waitForTimeout(300);
await p.getByLabel('Rechercher un article').fill('porte'); await p.waitForTimeout(200);
ok(!(await p.locator('.pos-results').innerText()).includes('Lampe + porte-clé offert'), 'promotion terminée : plus proposée à la vente');
await p.goto('http://localhost:5173/#/articles'); await p.waitForTimeout(300);
ok((await p.locator('main').innerText()).includes('Promotion terminée'), 'liste des articles : « Promotion terminée »');
console.log(fail ? `${fail} ÉCHEC(S)` : 'TOUT EST BON'); await b.close();
