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
await p.evaluate(async () => { const t = window.__tsena;
  await t.save('categories', { id: 'sand', name: 'Sandale', code: 'SAND', attrs: [
    { id: 'm', name: 'Modèle', required: true, active: true, values: [{ id: 'm5', label: 'S5', code: 'S5' }] },
    { id: 'c', name: 'Couleur', required: true, active: true, values: [{ id: 'cr', label: 'Rose', code: 'ROS' }] },
    { id: 'p', name: 'Pointure', required: true, active: true, values: [{ id: 'p37', label: '37', code: '37' }] }] });
});
await p.goto('http://localhost:5173/#/import'); await p.waitForTimeout(400);
await p.locator('input[type=file]').setInputFiles('/tmp/claude-0/t/sandale.xlsx'); await p.waitForTimeout(1200);
let tx = N(await p.locator('main').innerText()); if (process.env.DBG) console.log(tx.slice(0, 2500));
ok(tx.includes('Lire votre fichier avec les variantes de la page'), 'fichier reconnu : lecture avec les variantes de la page');
ok(tx.includes('SANDALE') && tx.includes('LAMPE'), 'groupes par catégorie');
const sel = async (label) => p.locator('main').getByLabel(label, { exact: true }).first().inputValue().catch((e) => 'x' + e.message.slice(0, 80));
ok(tx.includes('F · PT'), 'colonne PT devinée pour Pointure');
ok(tx.includes('H · STK THEO FINALE'), 'colonne STK THEO FINALE devinée pour Stock');
ok(tx.includes('Pointure : 38, 35, 36, 36-37') || /Pointure : .*36-37/.test(tx), 'valeurs nouvelles listées (pointures)');
ok(/Modèle : S6/.test(tx) && /Couleur : Noir/.test(tx), 'nouveau modèle S6 et couleur Noir');
ok(tx.includes('Contrôle : 5 ligne(s)'), '5 lignes Sandale contrôlées (LAMPE sans page)');
ok(tx.includes('ne seront pas importées') || tx.includes('ne seront pas import'), 'lignes LAMPE non importées (pas de page)');
await p.getByRole('button', { name: /Importer 5 article/ }).click(); await p.waitForTimeout(1200);
const res = await p.evaluate(() => { const t = window.__tsena; const ps = t.all('products').filter((x) => x.categoryId === 'sand'); const cat = t.get('categories', 'sand');
  const st = (pid) => t.all('stockMoves').filter((m) => m.variantId === 'v_' + pid).reduce((s, m) => s + m.qty, 0);
  return { n: ps.length, names: ps.map((x) => x.name).sort(), stocks: ps.map((x) => st(x.id)).sort((a, b) => a - b), vals: cat.attrs.map((a) => a.values.length), photo: ps.some((x) => x.photo) }; });
console.log(JSON.stringify(res));
ok(res.n === 5, '5 articles créés');
ok(res.vals.join() === '2,2,5', 'valeurs ajoutées à la page (Modèle 2, Couleur 2, Pointure 5)');
ok(res.stocks.join() === '0,5,6,8,9', 'stocks importés (−1 → 0)');
ok(res.photo, 'photo reprise');
const sw = await p.evaluate(() => document.documentElement.scrollWidth); ok(sw <= W + 1, `pas de débordement (${sw})`);
console.log(fail ? `${fail} ÉCHEC(S)` : 'TOUT EST BON'); await b.close();
