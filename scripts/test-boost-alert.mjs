// Compte boost quotidien : délai (17 h en semaine), rappel, alerte au gérant avec le nom du responsable, trace dans
// le journal, heure de saisie affichée.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const W = Number(process.argv[2] || 1280);
const ctx = await b.newContext({ viewport: { width: W, height: 900 }, timezoneId: 'Indian/Antananarivo' });
const p = await ctx.newPage();
await p.clock.install({ time: new Date('2026-10-14T18:10:00+03:00') }); // mercredi 18 h 10 : après 17 h
const N = (t) => t.replace(/[  ]/g, ' ');
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
await p.goto('http://localhost:5173/'); await p.waitForTimeout(800);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
await p.evaluate(async () => {
  const t = window.__tsena; const hash = t.get('users', 'user-superadmin').passwordHash;
  await t.save('categories', [{ id: 'lp', name: 'Lampe' }]);
  await t.save('users', { id: 'u3', username: 'resp', fullName: 'Rindra', roleId: 'role-manager', active: true, passwordHash: hash, mustChangePassword: false });
  await t.save('boosts', { id: 'b1', pageId: 'lp', slot: 1, label: 'Promo', startDate: '2026-10-12', status: 'active' });
  await t.save('boostReadings', [{ id: 'br_b1_2026-10-12', boostId: 'b1', pageId: 'lp', date: '2026-10-12', spend: 2, messages: 20 }, { id: 'br_b1_2026-10-13', boostId: 'b1', pageId: 'lp', date: '2026-10-13', spend: 4, messages: 30 }]);
});
await p.reload(); await p.waitForTimeout(1500);
await p.locator('.bell').first().evaluate((el) => el.click()); await p.waitForTimeout(300);
let body = N(await p.locator('body').innerText());
await p.keyboard.press('Escape');
ok(body.includes('Compte boost pas fait à l’heure') && body.includes('Rindra'), 'alerte au gérant / super-admin avec le nom du responsable');
const log = await p.evaluate(() => window.__tsena.all('audit').filter((a) => a.action === 'Compte boost non fait').map((a) => a.details));
ok(log.some((d) => d.includes('Lampe') && d.includes('mercredi') && d.includes('Rindra')), 'trace dans le journal : page, jour, responsable');
ok(log.filter((d) => d.includes('mercredi')).length === 1, 'une seule trace par page et par jour');
await p.goto('http://localhost:5173/#/boosts/suivi'); await p.waitForTimeout(600);
await p.getByLabel('Page').first().selectOption('lp').catch(() => {}); await p.waitForTimeout(400);
let main = N(await p.locator('main').innerText());
ok(main.includes('Compte boost du jour en retard'), 'écran boosts : compte du jour en retard');
const cell = p.getByLabel(/Conversations boost 1 14\//);
await cell.fill('45'); await cell.press('Enter'); await p.waitForTimeout(500);
main = N(await p.locator('main').innerText());
ok(main.includes('Compte saisi le') && /14\/10 18:1\d/.test(main) && !main.includes('Compte boost du jour en retard'), 'heure de saisie affichée, plus de retard');
await p.goto('http://localhost:5173/#/'); await p.waitForTimeout(600);
body = N(await p.locator('body').innerText());
ok(!body.includes('Compte boost pas fait'), 'alerte disparue une fois le compte fait');
console.log(fail ? `${fail} ÉCHEC(S)` : 'TOUT EST BON'); await b.close();
