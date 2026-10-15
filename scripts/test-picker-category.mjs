// Nouvelle commande → Ajouter un article : filtre par catégorie, et plus aucun article caché par la limite d'affichage.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Indian/Antananarivo' })).newPage();
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter'); await p.waitForTimeout(700);
await p.getByRole('button', { name: 'Plus tard' }).click({ timeout: 1500 }).catch(() => {});
await p.evaluate(async () => {
  const t = window.__tsena;
  await t.save('categories', [{ id: 'bx', name: 'Boxer homme' }, { id: 'pj', name: 'Pyjamas homme' }]);
  const prods = [], vars = [];
  for (let i = 1; i <= 70; i++) { prods.push({ id: 'b' + i, code: 'A' + i, name: 'Boxer ' + i, categoryId: 'bx', priceRetail: 10000, active: true }); vars.push({ id: 'vb' + i, productId: 'b' + i, sku: 'A' + i, active: true }); }
  for (let i = 1; i <= 5; i++) { prods.push({ id: 'p' + i, code: 'Z' + i, name: 'Pyjama ' + i, categoryId: 'pj', priceRetail: 40000, active: true }); vars.push({ id: 'vp' + i, productId: 'p' + i, sku: 'Z' + i, active: true }); }
  await t.save('products', prods); await t.save('variants', vars);
});
await p.goto('http://localhost:5173/#/commandes/enregistrees'); await p.waitForTimeout(500);
await p.getByRole('button', { name: 'Nouvelle commande' }).click(); await p.waitForTimeout(400);
await p.getByRole('button', { name: 'Ajouter un article' }).click(); await p.waitForTimeout(400);
const dlg = p.getByRole('dialog').last();
const items = () => dlg.locator('li button.list-item').count();
let txt = await dlg.innerText();
ok(!/Pyjama 1\b/.test(txt) && /Afficher plus \(15\)/.test(txt), 'sans filtre : 60 articles + « Afficher plus (15) » (avant : les Pyjamas étaient cachés)');
await dlg.getByLabel('Catégorie').selectOption({ label: 'Pyjamas homme' }); await p.waitForTimeout(300);
ok(await items() === 5 && /Pyjama 1/.test(await dlg.innerText()), 'filtre Pyjamas homme : les 5 pyjamas');
await dlg.getByLabel('Catégorie').selectOption({ label: 'Toutes les catégories' }); await p.waitForTimeout(200);
await dlg.getByRole('button', { name: /Afficher plus/ }).click(); await p.waitForTimeout(300);
ok(await items() === 75, 'Afficher plus : les 75 articles');
console.log(fail ? `${fail} ÉCHEC(S)` : 'TOUT EST BON'); await b.close();
process.exit(fail ? 1 : 0);
