// Corriger la date d'un paiement : Responsable (et super admin) seulement ; le Gérant ne voit pas le champ.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: Number(process.env.DPR || 1), timezoneId: 'Indian/Antananarivo' })).newPage();
const N = (t) => t.replace(/[  ]/g, ' ');
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
const login = async (u) => {
  await p.getByLabel("Nom d'utilisateur").fill(u); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter'); await p.waitForTimeout(600);
  const later = p.getByRole('button', { name: 'Plus tard' }); if (await later.count()) { await later.click(); await p.waitForTimeout(300); }
};
const logout = async () => { await p.goto('http://localhost:5173/#/compte'); await p.waitForTimeout(400); await p.locator('main').getByRole('button', { name: 'Se déconnecter' }).click(); await p.waitForTimeout(400); };
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await login('super-adm');
await p.evaluate(async () => {
  const t = window.__tsena; const hash = t.get('users', 'user-superadmin').passwordHash;
  await t.save('users', [
    { id: 'u3', username: 'resp', fullName: 'Rindra', roleId: 'role-manager', active: true, passwordHash: hash, mustChangePassword: false },
    { id: 'u4', username: 'gerant', fullName: 'Hery', roleId: 'role-admin', active: true, passwordHash: hash, mustChangePassword: false },
  ]);
  await t.save('categories', [{ id: 'pg1', name: 'Pyjamas' }]);
  await t.save('products', [{ id: 'p1', code: 'PJ', name: 'Pyjama', categoryId: 'pg1', priceRetail: 20000, active: true }]);
  await t.save('variants', [{ id: 'v1', productId: 'p1', sku: 'PJ', active: true }]);
  await t.save('orders', [{ id: 'o1', number: 'C-1', kind: 'order', channel: 'shop', phone: '0341110001', name: 'Fara', status: 'delivered', lines: [{ id: 'l1', variantId: 'v1', qty: 1, unitPrice: 20000 }], discount: 0, deliveryFee: 0, createdAt: '2026-11-11T07:00:00.000Z',
    payments: [{ id: 'py1', at: '2026-11-17T08:30:00.000Z', amount: 20000, method: 'cash', receivedBy: 'shop', userName: 'Vendeur' }] }]);
});
const openFix = async () => {
  await p.goto('http://localhost:5173/#/commandes/o1'); await p.waitForTimeout(500);
  await p.getByRole('button', { name: /Corriger ce paiement/ }).click(); await p.waitForTimeout(300);
};
// Gérant : pas de champ date
await logout(); await login('gerant'); await openFix();
ok(await p.getByRole('dialog').getByLabel('Date du paiement').count() === 0, 'Gérant : pas de champ « Date du paiement »');
await p.keyboard.press('Escape');
// Responsable : change la date 17/11 → 11/11
await logout(); await login('resp'); await openFix();
const f = p.getByRole('dialog').getByLabel('Date du paiement');
ok(await f.count() === 1 && await f.inputValue() === '2026-11-17', 'Responsable : champ date présent (17/11)');
await f.fill('2026-11-11');
if (process.env.SHOT) await p.getByRole('dialog').screenshot({ path: process.env.SHOT });
const reason = p.getByRole('dialog').getByLabel(/Raison|Motif/);
if (await reason.count()) await reason.first().fill('payé le 11/11');
await p.getByRole('dialog').getByRole('button', { name: 'Enregistrer la correction' }).click(); await p.waitForTimeout(500);
const pay = await p.evaluate(() => window.__tsena.get('orders', 'o1').payments[0]);
ok(pay.at === '2026-11-11T08:30:00.000Z', `paiement déplacé au 11/11, même heure (${pay.at})`);
const tx = N(await p.locator('main').innerText());
ok(tx.includes('17/11/2026 → 11/11/2026'), 'changement de date visible dans l’historique');
await b.close();
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); process.exit(fail ? 1 : 0);
