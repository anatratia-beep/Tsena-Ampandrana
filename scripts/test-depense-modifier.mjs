// Dépenses : bouton « Modifier le montant » à côté de « Supprimer » ; le montant et la description sont corrigés,
// le solde suit, l'ancien montant reste dans le journal.
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
  await window.__tsena.save('cashMoves', [{ id: 'e1', at: now, account: 'cash', amount: -15000, type: 'expense', label: 'Taxi', userName: 'Aina' }]);
});
await p.goto('http://localhost:5173/#/depenses/liste'); await p.waitForTimeout(800);
const row = p.locator('tr', { hasText: 'Taxi' });
ok(await row.getByRole('button', { name: 'Modifier le montant' }).count() === 1 && await row.getByRole('button', { name: 'Supprimer' }).count() === 1, 'bouton modifier à côté de supprimer');
await row.getByRole('button', { name: 'Modifier le montant' }).click();
const dlg = p.getByRole('dialog');
ok(N(await dlg.innerText()).includes('Ancien montant : 15 000 Ar'), 'ancien montant affiché');
await dlg.getByLabel(/Montant/).fill('1500'); await dlg.getByLabel('Description').fill('Taxi moto');
await dlg.getByRole('button', { name: 'Enregistrer' }).click(); await p.waitForTimeout(500);
const m = await p.evaluate(() => window.__tsena.get('cashMoves', 'e1'));
ok(m.amount === -1500 && m.label === 'Taxi moto' && m.type === 'expense', 'montant 1 500 et description corrigés');
ok(N(await p.locator('main').innerText()).includes('1 500 Ar'), 'liste à jour');
const au = await p.evaluate(() => window.__tsena.all('audit').find((a) => a.action === 'Dépense corrigée'));
ok(au && /15000 Ar → 1500 Ar/.test(au.details), 'ancien montant gardé dans le journal');
console.log(fail ? `${fail} ÉCHEC(S)` : 'TOUT EST BON'); await b.close(); process.exit(fail ? 1 : 0);
