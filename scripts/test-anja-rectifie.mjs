// Le responsable (Anja) rectifie une annulation faite par un autre vendeur (Patrick), même semaine clôturée :
// bouton visible, rectification directe (sans demande), choix de la date.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Indian/Antananarivo', deviceScaleFactor: Number(process.env.DPR || 1) })).newPage();
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
const login = async (u) => {
  await p.getByLabel("Nom d'utilisateur").fill(u); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter'); await p.waitForTimeout(600);
  const later = p.getByRole('button', { name: 'Plus tard' }); if (await later.count()) { await later.click(); await p.waitForTimeout(300); }
};
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await login('super-adm');
await p.evaluate(async () => {
  const t = window.__tsena; const h = t.get('users', 'user-superadmin').passwordHash;
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const d = new Date(); const mon = new Date(d); mon.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7); mon.setHours(10, 0, 0, 0);
  const sat = new Date(mon); sat.setDate(mon.getDate() + 5); const at = mon.toISOString();
  await t.save('categories', [{ id: 'nv', name: 'NetVision' }]);
  await t.save('users', [
    { id: 'u-anja', username: 'anja', fullName: 'Anja', roleId: 'role-manager', active: true, passwordHash: h, mustChangePassword: false, pageIds: ['nv'] },
    { id: 'u-pat', username: 'patrick', fullName: 'Patrick', roleId: 'role-seller', active: true, passwordHash: h, mustChangePassword: false, pageIds: ['nv'] }]);
  await t.save('products', [{ id: 'a', code: 'A', name: 'Caméra ampoule', categoryId: 'nv', priceRetail: 35000, active: true }]);
  await t.save('variants', [{ id: 'va', productId: 'a', sku: 'A', costAvg: 15000, active: true }]);
  await t.save('stockMoves', [{ variantId: 'va', qty: 10, type: 'initial', at: '2026-01-01T08:00:00.000Z' }]);
  await t.save('orders', [{ id: 'R1', number: 'C-L0123', kind: 'order', channel: 'facebook', phone: '0330986006', name: 'Rajoelisoa', status: 'cancelled', lines: [{ id: 'l1', variantId: 'va', qty: 1, unitPrice: 45000 }], payments: [], discount: 0, deliveryFee: 3000, createdBy: 'u-pat', createdByName: 'Patrick', cancelledById: 'u-pat', cancelledByName: 'Patrick', createdAt: at, dispatchedAt: at, statusDates: { cancelled: at } }]);
  await t.save('payouts', { id: `po_${ymd(mon)}`, weekStart: ymd(mon), weekEnd: ymd(sat), sales: 0, expenses: 0, expected: 0, amount: 0, account: 'cash', gap: 0, perPage: [], expenseIds: [], at: sat.toISOString(), byName: 'Super-admin', status: 'paid' });
});
await p.goto('http://localhost:5173/#/compte'); await p.waitForTimeout(400); await p.locator('main').getByRole('button', { name: 'Se déconnecter' }).click(); await p.waitForTimeout(400);
await login('anja');
await p.goto('http://localhost:5173/#/commandes/R1'); await p.waitForTimeout(700);
ok(await p.getByRole('button', { name: 'Rectifier une annulation' }).count() === 1, 'Anja : bouton « Rectifier une annulation » (annulée par Patrick)');
await p.getByRole('button', { name: 'Rectifier une annulation' }).click(); await p.waitForTimeout(400);
const dlg = p.getByRole('dialog'); const tx = await dlg.innerText();
ok(!/Envoyer au super-admin/.test(tx) && /Date de comptabilisation/.test(tx), 'Anja : rectification directe avec choix de la date (semaine clôturée)');
await dlg.getByRole('button', { name: 'Tout livré' }).click(); await p.waitForTimeout(200);
if (process.env.SHOT) await dlg.screenshot({ path: process.env.SHOT });
await dlg.getByRole('button', { name: 'Rectifier', exact: true }).click(); await p.waitForTimeout(900);
const st = await p.evaluate(() => window.__tsena.get('orders', 'R1').status);
ok(st === 'delivered', `Anja : commande rouverte (${st})`);
if (process.env.SHOT2) await p.locator('main').screenshot({ path: process.env.SHOT2 });
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); await b.close(); process.exit(fail ? 1 : 0);
