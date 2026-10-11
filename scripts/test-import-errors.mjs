import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Indian/Antananarivo' })).newPage();
const N = (t) => t.replace(/[  ]/g, ' ');
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
await p.evaluate(async () => { await window.__tsena.save('categories', { id: 'pp', name: 'Poignet précieux', attrs: [
  { id: 't', name: 'Type', required: true, active: true, values: [{ id: 'enf', label: 'Enfant', code: 'ENF' }] }, { id: 'm', name: 'Modèle', required: true, active: true, values: [{ id: 'me1', label: 'ME1', code: 'ME1' }] }] }); });
await p.goto('http://localhost:5173/#/import'); await p.waitForTimeout(400);
for (const [f, re, m] of [['trunc', /incomplet ou abîmé/, 'fichier tronqué : message clair'], ['old', /ancien \(\.xls\) ou protégé/, 'ancien .xls / protégé : message clair'], ['empty', /vide \(0 octet\)/, 'fichier vide : message clair']]) {
  await p.locator('input[type=file]').setInputFiles(`/tmp/claude-0/t/${f}.xlsx`); await p.waitForTimeout(600);
  ok(re.test(N(await p.locator('main').innerText())), m);
}
await p.locator('input[type=file]').setInputFiles('/tmp/claude-0/t/montre.xlsx'); await p.waitForTimeout(1200);
const tx = N(await p.locator('main').innerText());
ok(tx.includes('POIGNET PRECIEUX') && tx.includes('Poignet précieux'), 'catégorie du fichier reliée à la page (sans accent / majuscules)');
ok(tx.includes('Contrôle : 4 ligne(s)') && !/en erreur/.test(tx), '4 lignes sans erreur (PV vide accepté)');
ok(tx.includes('à compléter'), 'PV détail vide signalé « à compléter »');
await p.getByRole('button', { name: /Importer 4 article/ }).click(); await p.waitForTimeout(1500);
const n = await p.evaluate(() => window.__tsena.all('products').filter((x) => x.categoryId === 'pp').length);
ok(n === 4, '4 articles importés');
console.log(fail ? `${fail} ÉCHEC(S)` : 'TOUT EST BON'); await b.close();
