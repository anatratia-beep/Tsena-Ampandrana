// Ventes sur place et commandes clients regroupées par page (catégorie principale des articles) ;
// menu « Livraisons et livreurs » visible pour le responsable (qui assigne les livreurs) et le vendeur (ses pages).
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Indian/Antananarivo' })).newPage();
const N = (t) => t.replace(/[\s\u00a0\u202f]+/g, ' ');
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
const login = async (u) => { await p.getByLabel("Nom d'utilisateur").fill(u); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter'); await p.waitForTimeout(700); await p.getByRole('button', { name: 'Plus tard' }).click({ timeout: 1500 }).catch(() => {}); };
const logout = async () => { await p.goto('http://localhost:5173/#/compte'); await p.waitForTimeout(400); await p.locator('main').getByRole('button', { name: 'Se déconnecter' }).click(); await p.waitForTimeout(400); };
const navText = async () => N(await p.locator('aside.sidebar').innerText());
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await login('super-adm');
await p.evaluate(async () => {
  const t = window.__tsena; const now = new Date().toISOString(); const hash = t.get('users', 'user-superadmin').passwordHash;
  await t.save('categories', [{ id: 'pj', name: 'Pyjamas' }, { id: 'bx', name: 'Boxer' }]);
  await t.save('products', [
    { id: 'a', code: 'BX1', name: 'Boxer coton', categoryId: 'bx', priceRetail: 10000, active: true },
    { id: 'b', code: 'PJ1', name: 'Pyjama coton', categoryId: 'pj', priceRetail: 40000, active: true },
    { id: 'c', code: 'BX2', name: 'Boxer soie coton', categoryId: 'bx', priceRetail: 12000, active: true },
  ]);
  await t.save('variants', [{ id: 'va', productId: 'a', sku: 'BX1', active: true }, { id: 'vb', productId: 'b', sku: 'PJ1', active: true }, { id: 'vc', productId: 'c', sku: 'BX2', active: true }]);
  await t.save('stockMoves', ['va', 'vb', 'vc'].map((v) => ({ variantId: v, qty: 5, type: 'initial', at: now })));
  await t.save('users', [
    { id: 'u1', username: 'aina', fullName: 'Aina', roleId: 'role-seller', active: true, passwordHash: hash, mustChangePassword: false },
    { id: 'u3', username: 'resp', fullName: 'Rindra', roleId: 'role-manager', active: true, passwordHash: hash, mustChangePassword: false, pageIds: ['bx'] },
  ]);
});
// Ventes et commandes : une page chacune, et une commande avec deux pages
await p.evaluate(async () => {
  const t = window.__tsena; const now = new Date().toISOString();
  const o = (id, kind, channel, status, lines) => ({ id, number: id, kind, channel, phone: '0340000000', status, zoneId: '', lines: lines.map(([v, q, pr], i) => ({ id: id + i, variantId: v, qty: q, unitPrice: pr, qtyKept: q })), payments: [], discount: 0, deliveryFee: 0, createdBy: 'user-superadmin', createdByName: 'Super-admin', createdAt: now });
  await t.save('orders', [
    o('V1', 'order', 'shop', 'delivered', [['va', 1, 10000]]), o('V2', 'order', 'shop', 'delivered', [['vb', 1, 40000]]), o('V3', 'order', 'shop', 'delivered', [['vc', 2, 12000]]),
    o('C1', 'order', 'facebook', 'new', [['va', 1, 10000]]), { ...o('R1', 'order', 'facebook', 'ready', [['va', 1, 10000]]), zoneId: 'zone-ville', name: 'Client Boxer' }, { ...o('R2', 'order', 'facebook', 'ready', [['vb', 1, 40000]]), zoneId: 'zone-ville', name: 'Client Pyjama' }, o('C2', 'order', 'facebook', 'new', [['vb', 1, 40000]]), o('C3', 'order', 'facebook', 'new', [['vc', 1, 12000], ['vb', 1, 40000]]),
  ]);
});
await p.goto('http://localhost:5173/#/vente'); await p.waitForTimeout(600);
await p.getByRole('button', { name: 'Toutes', exact: true }).click().catch(() => {}); await p.waitForTimeout(300);
let heads = (await p.locator('main .list-group-head').allInnerTexts()).map(N);
ok(heads.length === 2 && heads[0].startsWith('Boxer (2)') && heads[0].includes('34 000') && heads[1].startsWith('Pyjamas (1)'), `vente sur place : ventes regroupées par page (${heads.join(' | ')})`);
const searchHeads = await p.locator('.pos-results .list-group-head').count();
await p.getByLabel('Rechercher un article').fill('coton'); await p.waitForTimeout(300);
ok(searchHeads === 0 && (await p.locator('.pos-results .list-group-head').count()) === 0, 'recherche d’articles : pas regroupée');
await p.goto('http://localhost:5173/#/commandes/enregistrees'); await p.waitForTimeout(600);
heads = (await p.locator('main .list-group-head').allInnerTexts()).map(N);
ok(heads.length === 3 && heads[0].startsWith('Boxer (1)') && heads[1].startsWith('Pyjamas (1)') && heads[2].startsWith('Plusieurs pages (1)'), `commandes clients : regroupées par page (${heads.join(' | ')})`);
ok((await navText()).includes('Livraisons et livreurs'), 'admin : menu Livraisons visible');
await logout(); await login('aina');
ok((await navText()).includes('Livraisons et livreurs'), 'vendeur : menu Livraisons visible');
await p.goto('http://localhost:5173/#/commandes/R1'); await p.waitForTimeout(500);
ok(await p.getByRole('button', { name: 'Remettre au livreur (en livraison)' }).count() === 0 && N(await p.locator('main').innerText()).includes('Le responsable choisira le livreur'), 'vendeur : ne remet pas la commande au livreur');
const perms = await p.evaluate(() => window.__tsena.get('roles', 'role-seller').permissions);
ok(!perms.includes('orders.dispatch'), 'rôle Vendeur : droit « assigner les livreurs » retiré');
await logout(); await login('resp');
ok((await navText()).includes('Livraisons et livreurs'), 'responsable : menu Livraisons visible');
await p.goto('http://localhost:5173/#/livraisons/a-livrer'); await p.waitForTimeout(500);
let mt = N(await p.locator('main').innerText());
ok(mt.includes('En attente de livraison') && mt.includes('Client Boxer') && mt.includes('Client Pyjama'), 'responsable : Livraisons → toutes les commandes à remettre, toutes pages');
await p.goto('http://localhost:5173/#/commandes/attente'); await p.waitForTimeout(500);
mt = N(await p.locator('main').innerText());
ok(mt.includes('Client Boxer') && !mt.includes('Client Pyjama') && await p.locator('.scope-bar button').count() === 0, 'responsable : Commandes → seulement sa page (Boxer), sans « Tout »');
await p.goto('http://localhost:5173/#/commandes/R1'); await p.waitForTimeout(500);
ok(await p.getByRole('button', { name: 'Remettre au livreur (en livraison)' }).count() === 1, 'responsable : peut assigner le livreur');
if (process.env.SHOT) { await logout(); await login('super-adm'); await p.goto('http://localhost:5173/#/commandes/enregistrees'); await p.waitForTimeout(600); await p.screenshot({ path: process.env.SHOT }); }
console.log(fail ? `${fail} ÉCHEC(S)` : 'TOUT EST BON'); await b.close();
process.exit(fail ? 1 : 0);
