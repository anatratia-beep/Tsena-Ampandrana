// Articles en double : même nom mais couleur (valeur) différente dans la même page = pas un doublon.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
const N = (t) => t.replace(/[  ]/g, ' ');
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
await p.evaluate(async () => {
  const t = window.__tsena;
  await t.save('categories', [{ id: 'py', name: 'Pyjama', code: 'PYJA', attrs: [
    { id: 'm', name: 'Modèle', values: [{ id: 'sx', label: 'SEXY', code: 'SEXY' }] }, { id: 't', name: 'Taille', values: [{ id: 'M', label: 'M', code: 'M' }] },
    { id: 'c', name: 'Couleur', required: false, values: [{ id: 'no', label: 'Noir', code: 'NOI' }, { id: 'bl', label: 'Blanc', code: 'BLA' }] }] }, { id: 'ot', name: 'Autre page', code: 'AUT' }]);
  const P = (id, name, cat, attrs) => ({ id, code: id, name, categoryId: cat, attrs, active: true, priceRetail: 1 });
  await t.save('products', [P('A1', 'SEXY M', 'py', { m: 'sx', t: 'M', c: 'no' }), P('A2', 'SEXY M', 'py', { m: 'sx', t: 'M', c: 'bl' }),
    P('B1', 'Fleur L', 'py', { m: 'sx', t: 'M', c: 'no' }), P('B2', 'Fleur L', 'py', { m: 'sx', t: 'M', c: 'no' }),
    P('C1', 'Câble X', 'py', undefined), P('C2', 'Câble X', 'ot', undefined)]);
});
await p.goto('http://localhost:5173/#/articles'); await p.waitForTimeout(800);
const tx = N(await p.locator('main').innerText());
ok(tx.includes('2 groupe(s) d’articles en double'), `seuls les vrais doublons comptent (attendu 2) : ${(tx.match(/(\d+) groupe\(s\) d’articles en double/) || [])[1]}`);
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); await b.close(); process.exit(fail ? 1 : 0);
