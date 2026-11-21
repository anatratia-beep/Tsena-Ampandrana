// Dépenses : détail « Par compte » (caisse espèces, MVola, Orange, Airtel, banque) ; toucher un compte filtre la liste.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Indian/Antananarivo' })).newPage();
const N = (t) => t.replace(/[  ]/g, ' ');
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
await p.evaluate(async () => {
  const now = new Date().toISOString();
  await window.__tsena.save('cashMoves', [
    { id: 'e1', at: now, account: 'cash', amount: -15000, type: 'expense', label: 'Taxi', userName: 'Aina' },
    { id: 'e2', at: now, account: 'mvola', amount: -7000, type: 'expense', label: 'Crédit', userName: 'Aina' },
    { id: 'e3', at: now, account: 'orange', amount: -1000, type: 'expense', label: 'Forfait', userName: 'Aina' },
    { id: 'e4', at: now, account: 'bank', amount: -6000, type: 'expense', label: 'Frais banque', userName: 'Aina' },
  ]);
});
await p.goto('http://localhost:5173/#/depenses/liste'); await p.waitForTimeout(800);
const box = p.getByLabel('Dépenses par compte');
let tx = N(await box.innerText()).replace(/\s+/g, ' ');
ok(/Caisse espèces 15 000 Ar/.test(tx) && /MVola 7 000 Ar/.test(tx) && /Orange Money 1 000 Ar/.test(tx) && /Banque 6 000 Ar/.test(tx) && !tx.includes('Airtel'), `par compte : espèces 15 000, MVola 7 000, Orange 1 000, Banque 6 000 (${tx})`);
ok(N(await p.locator('main').innerText()).includes('Total des dépenses (4)'), 'total : 4 dépenses');
await box.getByRole('button', { name: /Banque/ }).click(); await p.waitForTimeout(300);
let list = N(await p.locator('main').innerText());
ok(/Liste des dépenses · Banque/.test(list) && list.includes('Frais banque') && !list.includes('Taxi'), 'toucher Banque : seulement les dépenses banque');
await p.waitForTimeout(4500); await p.locator('main .card').first().screenshot({ path: process.env.SHOT || '/tmp/depenses-par-compte.png' });
await box.getByRole('button', { name: /Banque/ }).click(); await p.waitForTimeout(300);
ok(N(await p.locator('main').innerText()).includes('Taxi'), 'toucher encore : toutes les dépenses');
console.log(fail ? `${fail} ÉCHEC(S)` : 'TOUT EST BON'); await b.close(); process.exit(fail ? 1 : 0);
