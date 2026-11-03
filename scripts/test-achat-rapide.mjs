// Achats : ajout rapide des articles (par modèle / taille, création automatique des combinaisons manquantes,
// quantités sur la ligne), et filtre « Nouveaux articles ».
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
  const t = window.__tsena; const old = '2026-08-01T08:00:00.000Z';
  await t.save('categories', [{ id: 'pg', name: 'Plateforme', code: 'PLA', order: 1, attrs: [
    { id: 'mod', name: 'Modèle', required: true, active: true, values: [{ id: 'm6', label: 'PH6', code: 'PH6' }, { id: 'm7', label: 'PH7', code: 'PH7' }] },
    { id: 'tai', name: 'Taille', required: true, active: true, values: [{ id: 'tM', label: 'M', code: 'M' }, { id: 'tL', label: 'L', code: 'L' }] }] }]);
  await t.save('products', [{ id: 'OLD', code: 'OLD1', name: 'Vieux article', categoryId: 'pg', priceRetail: 1000, active: true, createdAt: old }]);
  await t.save('variants', [{ id: 'vOLD', productId: 'OLD', sku: 'OLD1', active: true, createdAt: old }]);
});
await p.goto('http://localhost:5173/#/achats'); await p.waitForTimeout(600);
await p.getByRole('button', { name: 'Nouvelle commande' }).click(); await p.waitForTimeout(300);
await p.getByLabel('Taux : 1 ¥ = … Ar').fill('600');
await p.getByRole('button', { name: 'Ajouter un article' }).click(); await p.waitForTimeout(300);
const dlg = p.getByRole('dialog').last();
await dlg.getByRole('button', { name: 'Par modèle / taille' }).click(); await p.waitForTimeout(200);
await dlg.getByRole('button', { name: 'Toutes' }).first().click();
await dlg.getByRole('button', { name: 'Toutes' }).first().click();
await p.waitForTimeout(200);
let tx = N(await dlg.innerText());
ok((tx.match(/nouveau/g) || []).length >= 4, '4 combinaisons PH6/PH7 × M/L proposées, marquées « nouveau »');
await dlg.getByLabel(/Prix d’achat unitaire/).fill('25');
await dlg.getByLabel('Quantité pour toutes').fill('5');
await dlg.getByLabel('PV détail pour tous les nouveaux').fill('30000');
await dlg.getByRole('button', { name: 'Pour toutes' }).click(); await p.waitForTimeout(200);
await dlg.getByLabel('Quantité PH7 L').fill('2');
await dlg.getByRole('button', { name: /^Ajouter 17 pièce/ }).click(); await p.waitForTimeout(600);
const created = await p.evaluate(() => window.__tsena.all('products').filter((x) => x.attrs).map((x) => x.name + ':' + x.priceRetail).sort());
ok(created.join() === 'PH6 L:30000,PH6 M:30000,PH7 L:30000,PH7 M:30000', `les 4 articles créés en un clic avec leur PV (${created.join()})`);
const form = p.getByRole('dialog').first();
tx = N(await form.innerText());
ok(tx.includes('17 pièces') && tx.includes('425 ¥'), 'commande : 17 pièces à 25 ¥ = 425 ¥');
// Nouveaux articles : les 4 créés apparaissent, pas le vieux ; quantité sur la ligne
await p.getByRole('button', { name: 'Ajouter un article' }).click(); await p.waitForTimeout(300);
const d2 = p.getByRole('dialog').last();
await d2.getByRole('button', { name: /^Nouveaux articles/ }).click(); await p.waitForTimeout(200);
tx = N(await d2.innerText());
ok(tx.includes('Nouveaux articles (4)') && tx.includes('PH6 M') && !tx.includes('Vieux article'), 'filtre « Nouveaux articles » : les 4 récents, pas l’ancien');
await d2.getByLabel(/Quantité PLA-PH6-M/).fill('3');
await d2.getByRole('button', { name: /^Ajouter 3 pièce/ }).click(); await p.waitForTimeout(400);
tx = N(await form.innerText());
ok(tx.includes('20 pièces'), 'ajout depuis « Nouveaux articles » : 3 pièces de plus sur la même ligne (20 au total)');
// Recherche : quantité directe sur la ligne
await p.getByRole('button', { name: 'Ajouter un article' }).click(); await p.waitForTimeout(300);
const d3 = p.getByRole('dialog').last();
await d3.getByRole('button', { name: 'Rechercher' }).click();
await d3.getByLabel('Rechercher un article').fill('vieux'); await p.waitForTimeout(200);
await d3.getByLabel(/Quantité OLD1/).fill('4');
await d3.getByRole('button', { name: /^Ajouter 4 pièce/ }).click(); await p.waitForTimeout(400);
await form.getByRole('button', { name: 'Créer la commande' }).click(); await p.waitForTimeout(600);
const pur = await p.evaluate(() => window.__tsena.all('purchases')[0]);
ok(pur && pur.lines.length === 5 && pur.lines.reduce((t, l) => t + l.qtyOrdered, 0) === 24, `commande créée : 5 lignes, 24 pièces (${pur?.lines.length}, ${pur?.lines.reduce((t, l) => t + l.qtyOrdered, 0)})`);
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); await b.close(); process.exit(fail ? 1 : 0);
