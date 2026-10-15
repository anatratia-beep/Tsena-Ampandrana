// Import sans doublons : même fichier réimporté (lignes identiques ignorées, fichier reconnu), stock remplacé,
// article déjà présent dans une autre page (non recréé), page ambiguë non devinée, catégorie rangée sous une autre
// retrouvée par son nom, commande Chine importée deux fois bloquée.
// Fichiers de test : python3 scripts/test-import-duplicates-files.py /tmp/claude-0/dup (ou un autre dossier, passé en argument).
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const DIR = process.argv[2] || '/tmp/claude-0/dup';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Indian/Antananarivo' })).newPage();
const N = (t) => t.replace(/[  ]/g, ' ');
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
await p.evaluate(async () => {
  const attrs = (pre) => [{ id: 'm', name: 'Modèle', required: true, active: true, values: [] }, { id: 't', name: 'Taille', required: true, active: true, values: [{ id: pre + 'l', label: 'L', code: 'L' }, { id: pre + 'xl', label: 'XL', code: 'XL' }] }];
  await window.__tsena.save('categories', [
    { id: 'pyj', name: 'Pyjamas homme', code: 'PYJ', attrs: attrs('p') }, { id: 'bxh', name: 'Boxer homme', code: 'BXH', attrs: attrs('b') }, { id: 'bxf', name: 'Boxer femme', code: 'BXF', attrs: attrs('f') },
    { id: 'enf', name: 'Enfant' }, { id: 'bgs', name: 'Boxer garçon', parentId: 'enf' },
  ]);
});
const products = () => p.evaluate(() => window.__tsena.all('products').map((x) => ({ name: x.name, cat: x.categoryId, attrs: !!x.attrs })));
const stockOf = (name) => p.evaluate((n) => { const pr = window.__tsena.all('products').find((x) => x.name === n); const vs = window.__tsena.all('variants').filter((v) => v.productId === pr.id).map((v) => v.id); return window.__tsena.all('stockMoves').filter((m) => vs.includes(m.variantId)).reduce((s, m) => s + m.qty, 0); }, name);
const open = async (f) => { await p.goto('http://localhost:5173/#/import'); await p.waitForTimeout(400); await p.locator('input[type=file]').setInputFiles(`${DIR}/${f}.xlsx`); await p.waitForTimeout(1200); return N(await p.locator('main').innerText()); };
const importBtn = () => p.getByRole('button', { name: /^Importer \d+ article/ });

// 1. Premier import
let tx = await open('stock');
ok(tx.includes('3 nouveau(x)') && !tx.includes('déjà été importé'), '1er import : 3 nouveaux, pas d’avertissement');
await importBtn().click(); await p.waitForTimeout(1500);
ok((await products()).length === 3, '3 articles créés');

// 2. Même fichier réimporté
tx = await open('stock');
ok(tx.includes('déjà été importé'), 'même fichier : reconnu comme déjà importé');
ok(tx.includes('3 identique(s) ignoré(s)') && tx.includes('Rien à importer'), 'même fichier : 3 lignes identiques, rien à importer');
ok(await p.getByRole('button', { name: 'Rien à importer' }).isDisabled(), 'bouton désactivé');
ok((await products()).length === 3, 'toujours 3 articles (aucun doublon)');

// 3. Fichier modifié : seul le changement passe, stock remplacé
tx = await open('stock_modif');
ok(!tx.includes('déjà été importé') && tx.includes('1 mise(s) à jour') && tx.includes('2 identique(s)'), 'fichier modifié : 1 mise à jour, 2 identiques');
await importBtn().click(); await p.waitForTimeout(1500);
ok(await stockOf('PH6 XL') === 8, 'stock remplacé (5 → 8), pas additionné');

// 4. Même articles lus dans une autre page
tx = await open('stock_autrepage');
ok(tx.includes('3 doublon(s) probable(s)') && tx.includes('existent déjà dans une autre page') && tx.includes('Rien à importer'), 'autre page : 3 doublons probables, rien créé par défaut');
ok(tx.includes('Pyjamas homme'), 'la page où l’article existe est indiquée');
await p.getByLabel(/les créer quand même/).check(); await p.waitForTimeout(300);
ok(await importBtn().isEnabled(), 'option « créer quand même » disponible');

// 5. Page ambiguë : « Boxer » n'est pas deviné
tx = await open('stock_ambigu');
ok(/sans page : elles ne seront pas importées/.test(tx), '« Boxer » (Boxer homme ou femme) : page non devinée');

// 6. Fichier simple : PH6 existe comme article de page ; catégorie rangée sous Enfant retrouvée
tx = await open('simple');
ok(tx.includes('1 article(s) existent déjà dans une autre page') && tx.includes('PH6 → « PH6'), 'fichier simple : PH6 reconnu comme article de page');
await p.getByRole('button', { name: /^Importer 1 article/ }).click(); await p.waitForTimeout(1500);
const all = await products();
ok(all.length === 4 && all.some((x) => x.name === 'Boxer KD9' && x.cat === 'bgs'), 'KD9 créé dans Enfant › Boxer garçon (pas de nouvelle catégorie)');
ok((await p.evaluate(() => window.__tsena.all('categories').filter((c) => c.name === 'Boxer garçon').length)) === 1, 'aucune catégorie « Boxer garçon » en plus');

// 7. Commande Chine importée deux fois
tx = await open('commande');
await p.getByLabel(/Taux/).fill('600');
await p.getByRole('button', { name: 'Importer la commande' }).click(); await p.waitForTimeout(1500);
tx = await open('commande');
ok(tx.includes('déjà été importé') && tx.includes('deuxième commande'), 'commande déjà importée : avertissement');
await p.getByLabel(/Taux/).fill('600');
ok(await p.getByRole('button', { name: 'Importer la commande' }).isDisabled(), 'commande : bouton bloqué');
await p.getByLabel(/autre commande/).check();
ok(await p.getByRole('button', { name: 'Importer la commande' }).isEnabled(), 'commande : débloqué si c’est une autre commande');

console.log(fail ? `${fail} ÉCHEC(S)` : 'TOUT EST BON'); await b.close();
process.exit(fail ? 1 : 0);
