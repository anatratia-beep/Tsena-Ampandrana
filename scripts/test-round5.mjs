// Série 5 : plus de « tri habituel » (seulement période d'ajout + plus récent / plus ancien) ; en revenant d'une fiche,
// la liste garde sa recherche, ses filtres et sa position dans la page.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const W = Number(process.argv[2] || 1280);
const p = await (await b.newContext({ viewport: { width: W, height: 800 }, timezoneId: 'Indian/Antananarivo' })).newPage();
const N = (t) => t.replace(/[  ]/g, ' ');
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
await p.evaluate(async () => {
  const t = window.__tsena; const now = Date.now();
  await t.save('categories', [{ id: 'lp', name: 'Lampe' }, { id: 'ka', name: 'Kapa' }]);
  await t.save('products', Array.from({ length: 80 }, (_, i) => ({ id: 'a' + i, code: (i % 2 ? 'KAPA-' : 'LAMP-') + String(i).padStart(2, '0'), name: (i % 2 ? 'Kapa ' : 'Lampe ') + i, categoryId: i % 2 ? 'ka' : 'lp', priceRetail: 10000, active: true, createdAt: new Date(now - i * 3600_000).toISOString() })));
  await t.save('variants', Array.from({ length: 80 }, (_, i) => ({ id: 'v' + i, productId: 'a' + i, sku: 'SKU-' + i, costAvg: 4000, active: true })));
  await t.save('stockMoves', Array.from({ length: 80 }, (_, i) => ({ variantId: 'v' + i, qty: 5, type: 'initial', at: new Date().toISOString() })));
  await t.save('orders', Array.from({ length: 30 }, (_, i) => ({ id: 'O' + i, number: 'C-' + i, kind: 'order', channel: 'facebook', phone: '03400000' + String(i).padStart(2, '0'), name: i === 7 ? 'Rasoa' : 'Client ' + i, status: 'new', lines: [{ id: 'l', variantId: 'v1', qty: 1, unitPrice: 10000 }], payments: [], discount: 0, deliveryFee: 0, createdAt: new Date().toISOString() })));
});
// 1. Plus de tri habituel
for (const [path, name] of [['/commandes', 'commandes'], ['/achats', 'achats'], ['/clients', 'clients'], ['/depenses/liste', 'dépenses']]) {
  await p.goto('http://localhost:5173/#' + path); await p.waitForTimeout(450);
  const t = N(await p.locator('main').innerText());
  const sel = (await p.locator('main select').evaluateAll((els) => els.map((e) => e.innerText))).join(' ');
  ok(!sel.includes('Tri habituel') && !sel.includes('Trier par code') && await p.getByLabel('Ordre').count() >= 1, `${name} : plus de « tri habituel », seulement période + ordre`);
}
// 2. Articles : filtre + clic + retour → mêmes résultats, même position
await p.goto('http://localhost:5173/#/articles'); await p.waitForTimeout(500);
await p.getByLabel('Catégorie').first().selectOption('lp'); await p.waitForTimeout(300);
const first = N(await p.locator('main .list-item-title').first().innerText());
ok(first.includes('Lampe'), `articles : catégorie Lampe (${first})`);
await p.evaluate(() => window.scrollTo(0, 900)); await p.waitForTimeout(300);
const y0 = await p.evaluate(() => window.scrollY);
const item = p.locator('main a.list-link, main .list-item').filter({ hasText: 'Lampe 40' }).first();
await item.evaluate((el) => el.click()); await p.waitForTimeout(500);
ok(p.url().includes('/articles/'), 'fiche de l’article ouverte');
await p.goBack(); await p.waitForTimeout(700);
ok(await p.getByLabel('Catégorie').first().inputValue() === 'lp', 'retour : catégorie gardée');
ok(N(await p.locator('main .list-item-title').first().innerText()) === first, 'retour : mêmes résultats');
const y1 = await p.evaluate(() => window.scrollY);
ok(Math.abs(y1 - y0) < 60, `retour : même position dans la liste (${y0} → ${y1})`);
// 3. Commandes : recherche gardée
await p.goto('http://localhost:5173/#/commandes'); await p.waitForTimeout(500);
await p.getByLabel('Rechercher').fill('Rasoa'); await p.waitForTimeout(300);
await p.locator('main').getByText('Rasoa').first().click(); await p.waitForTimeout(500);
ok(/commandes\/O7/.test(p.url()), 'commande ouverte depuis la recherche');
await p.goBack(); await p.waitForTimeout(600);
ok(await p.getByLabel('Rechercher').inputValue() === 'Rasoa' && N(await p.locator('main').innerText()).includes('Rasoa'), 'retour : recherche « Rasoa » et résultat gardés');
// 4. Le filtre est oublié à la déconnexion
const sw = await p.evaluate(() => document.documentElement.scrollWidth); ok(sw <= W + 1, `pas de débordement (${sw})`);
console.log(fail ? `${fail} ÉCHEC(S)` : 'TOUT EST BON'); await b.close();
