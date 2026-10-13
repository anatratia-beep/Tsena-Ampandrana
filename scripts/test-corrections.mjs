// Corrections : stock remis exactement après annulation / correction ; recherche exacte (PH6 ≠ PH60) ;
// « Parcourir le catalogue » : seuls les voisins du même modèle.
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
  await t.save('categories', [
    { id: 'lp', name: 'Lampe', code: 'LAMP', attrs: [{ id: 'mod', name: 'Modèle', values: [{ id: 'ph6', label: 'PH6', code: 'PH6' }, { id: 'ph60', label: 'PH60', code: 'PH60' }] }, { id: 'sz', name: 'Taille', values: [{ id: 's36', label: '36', code: '36' }, { id: 's37', label: '37', code: '37' }] }] },
    { id: 'ka', name: 'Kapa', code: 'KAPA', attrs: [{ id: 'km', name: 'Modèle', values: [{ id: 'k4', label: 'K4', code: 'K4' }, { id: 'k40', label: 'K40', code: 'K40' }] }] },
  ]);
  const prod = (id, code, name, cat, attrs) => ({ id, code, name, categoryId: cat, attrs, priceRetail: 10000, active: true });
  await t.save('products', [prod('a1', 'LAMP-PH6-36', 'PH6 36', 'lp', { mod: 'ph6', sz: 's36' }), prod('a2', 'LAMP-PH6-37', 'PH6 37', 'lp', { mod: 'ph6', sz: 's37' }), prod('a3', 'LAMP-PH60-36', 'PH60 36', 'lp', { mod: 'ph60', sz: 's36' }),
    prod('k1', 'KAPA-K4', 'K4', 'ka', { km: 'k4' }), prod('k2', 'KAPA-K40', 'K40', 'ka', { km: 'k40' })]);
  await t.save('variants', ['a1', 'a2', 'a3', 'k1', 'k2'].map((id) => ({ id: 'v' + id, productId: id, sku: id, costAvg: 4000, active: true })));
  await t.save('stockMoves', ['a1', 'a2', 'a3', 'k1', 'k2'].map((id) => ({ variantId: 'v' + id, qty: 10, type: 'initial', at: now })));
  // Vente sur place de 3 × PH6 36 (stock 10 → 7)
  await t.save('orders', { id: 'S1', number: 'V-1', kind: 'order', channel: 'shop', phone: '', status: 'delivered', lines: [{ id: 'l1', variantId: 'va1', qty: 3, unitPrice: 10000, qtyKept: 3, qtyReturned: 0 }], payments: [{ id: 'p1', at: now, amount: 30000, method: 'cash', receivedBy: 'shop' }], discount: 0, deliveryFee: 0, dispatchedAt: now, returnedAt: now, createdAt: now });
  await t.save('stockMoves', { variantId: 'va1', qty: -3, type: 'sale', refType: 'order', refId: 'S1', at: now });
  // Commande livrée en partie : 4 partis, 1 revenu (stock 10 → 7) ; vente sur place de 2 × K4 (10 → 8)
  await t.save('orders', { id: 'D1', number: 'C-1', kind: 'order', channel: 'facebook', phone: '0340000000', status: 'partial', lines: [{ id: 'l2', variantId: 'va2', qty: 4, unitPrice: 10000, qtyKept: 3, qtyReturned: 1 }], payments: [], discount: 0, deliveryFee: 0, dispatchedAt: now, returnedAt: now, createdAt: now });
  await t.save('stockMoves', [{ variantId: 'va2', qty: -4, type: 'dispatch', refType: 'order', refId: 'D1', at: now }, { variantId: 'va2', qty: 1, type: 'delivery_return', refType: 'order', refId: 'D1', at: now }]);
  await t.save('orders', { id: 'S2', number: 'V-2', kind: 'order', channel: 'shop', phone: '', status: 'delivered', lines: [{ id: 'l3', variantId: 'vk1', qty: 2, unitPrice: 10000, qtyKept: 2, qtyReturned: 0 }], payments: [{ id: 'p3', at: now, amount: 20000, method: 'cash', receivedBy: 'shop' }], discount: 0, deliveryFee: 0, dispatchedAt: now, returnedAt: now, createdAt: now });
  await t.save('stockMoves', { variantId: 'vk1', qty: -2, type: 'sale', refType: 'order', refId: 'S2', at: now });
});
const stock = (v) => p.evaluate((id) => window.__tsena.all('stockMoves').filter((m) => m.variantId === id).reduce((s, m) => s + m.qty, 0), v);
// 1. Annuler une vente sur place terminée
await p.goto('http://localhost:5173/#/commandes/S1'); await p.waitForTimeout(500);
await p.getByRole('button', { name: 'Annuler la vente (erreur)' }).click(); await p.waitForTimeout(200);
await p.getByRole('dialog').getByRole('button', { name: 'Annuler la vente' }).click(); await p.waitForTimeout(500);
ok(await stock('va1') === 10, 'vente sur place annulée : stock PH6 36 revenu à 10');
const s1 = await p.evaluate(() => window.__tsena.get('orders', 'S1'));
ok(s1.status === 'cancelled' && s1.payments.some((x) => x.amount === -30000), 'vente annulée et 30 000 Ar rendus enregistrés');
// 2. Annuler une commande livrée en partie
await p.goto('http://localhost:5173/#/commandes/D1'); await p.waitForTimeout(500);
await p.getByRole('button', { name: 'Annuler la vente (erreur)' }).click(); await p.waitForTimeout(200);
await p.getByRole('dialog').getByRole('button', { name: 'Annuler la vente' }).click(); await p.waitForTimeout(500);
ok(await stock('va2') === 10, 'commande livrée en partie annulée : stock PH6 37 revenu à 10 (pas 11)');
// 3. Corriger une vente : 2 → 1
await p.goto('http://localhost:5173/#/commandes/S2'); await p.waitForTimeout(500);
await p.getByRole('button', { name: 'Corriger la vente' }).click(); await p.waitForTimeout(200);
const dlg = p.getByRole('dialog');
await dlg.getByLabel('Quantité k1').fill('1');
await dlg.getByLabel('Raison de la correction').fill('mauvaise quantité');
ok(N(await dlg.innerText()).includes('à rendre 10 000 Ar'), 'correction : 10 000 Ar à rendre');
await dlg.getByRole('button', { name: 'Enregistrer la correction' }).click(); await p.waitForTimeout(500);
ok(await stock('vk1') === 9, 'vente corrigée 2 → 1 : stock K4 = 9');
const s2 = await p.evaluate(() => window.__tsena.get('orders', 'S2'));
ok(s2.lines[0].qty === 1 && s2.payments.some((x) => x.amount === -10000) && s2.events.some((e) => N(e.text).includes('2×10 000 → 1×10 000')), 'nouvelle quantité, argent rendu, ancienne et nouvelle version gardées');
// 4. Recherche exacte
await p.goto('http://localhost:5173/#/vente'); await p.waitForTimeout(500);
await p.getByLabel('Rechercher un article').fill('K4'); await p.waitForTimeout(300);
let res = N(await p.locator('.pos-results').innerText());
ok(res.includes('K4') && !/\bK40\b/.test(res) && res.includes('1 résultat(s) approchant(s)'), 'recherche « K4 » : K4 seul, K40 proposé à part');
await p.getByLabel('Rechercher un article').fill('PH6'); await p.waitForTimeout(300);
res = N(await p.locator('.pos-results').innerText());
ok(res.includes('PH6 36') && res.includes('PH6 37') && !res.includes('PH60'), 'recherche « PH6 » : PH6 36 et 37, pas PH60');
// 5. Parcourir le catalogue : voisins du même modèle seulement
await p.getByLabel('Rechercher un article').fill('');
await p.getByRole('button', { name: 'Parcourir le catalogue' }).click(); await p.waitForTimeout(300);
const pick = p.getByRole('dialog');
await pick.getByLabel('Rechercher un article').fill('PH6'); await p.waitForTimeout(200);
await pick.getByRole('button', { name: /PH6 36/ }).click(); await p.waitForTimeout(300);
let txt = N(await pick.innerText());
ok(txt.includes('PH6 36 (choisi)') && txt.includes('PH6 37') && !txt.includes('PH60'), 'choix proposés : PH6 36 et PH6 37 seulement');
await p.keyboard.press('Escape'); await p.waitForTimeout(200);
await p.getByRole('button', { name: 'Parcourir le catalogue' }).click(); await p.waitForTimeout(300);
await p.getByRole('dialog').getByLabel('Rechercher un article').fill('K4'); await p.waitForTimeout(200);
await p.getByRole('dialog').getByRole('button', { name: /^K4/ }).first().click(); await p.waitForTimeout(300);
txt = N(await p.getByRole('dialog').innerText());
ok(!txt.includes('K40'), 'article à un seul modèle (K4) : pas d’autres modèles proposés');
const sw = await p.evaluate(() => document.documentElement.scrollWidth); ok(sw <= W + 1, `pas de débordement (${sw})`);
console.log(fail ? `${fail} ÉCHEC(S)` : 'TOUT EST BON'); await b.close();
