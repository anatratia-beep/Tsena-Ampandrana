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
await p.evaluate(async () => { await window.__tsena.save('categories', { id: 'sand', name: 'Sandale', code: 'SAND', attrs: [
  { id: 'm', name: 'Modèle', required: true, active: true, values: [] }, { id: 'c', name: 'Couleur', required: true, active: true, values: [] },
  { id: 'p', name: 'Pointure', required: true, active: true, values: [] }, { id: 'd', name: 'Doublure', required: false, active: true, values: [{ id: 'd1', label: 'Cuir', code: 'CUIR' }] }] }); });
await p.goto('http://localhost:5173/#/import'); await p.waitForTimeout(400);
await p.locator('input[type=file]').setInputFiles('/tmp/claude-0/t/cellimg.xlsx'); await p.waitForTimeout(1500);
const tx = N(await p.locator('main').innerText());
ok(tx.includes('2 photo(s)'), 'photos insérées dans la cellule trouvées (2)');
ok(tx.includes('Doublure (facultatif)'), 'variante facultative signalée');
ok(!/ligne\(s\) en erreur/.test(tx), 'aucune erreur : la variante facultative vide passe');
await p.getByRole('button', { name: /Importer 2 article/ }).click(); await p.waitForTimeout(2500);
const r = await p.evaluate(() => window.__tsena.all('products').filter((x) => x.categoryId === 'sand').map((x) => ({ n: x.name, len: (x.photo || '').length, attrs: Object.keys(x.attrs || {}).length, ph: (x.photo || '').slice(0, 40) })));
console.log(JSON.stringify(r.map(({ ph, ...x }) => x)));
ok(r.length === 2 && r.every((x) => x.len > 0 && x.len < 60000), 'photos importées et compressées (< 60 Ko)');
ok(r.every((x) => x.ph.startsWith('data:image/jpeg')), 'photos en JPEG léger');
ok(r.every((x) => x.attrs === 3), 'articles sans doublure (variante facultative vide)');
console.log(fail ? `${fail} ÉCHEC(S)` : 'TOUT EST BON'); await b.close();
