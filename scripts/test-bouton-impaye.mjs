// Bouton « Impayé » sur un paiement (Responsable seulement) : « payé » cliqué mais argent pas reçu → paiement à 0, vente impayée.
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
const open = async () => { await p.goto('http://localhost:5173/#/commandes/o1'); await p.waitForTimeout(500); };
await logout(); await login('gerant'); await open();
ok(await p.getByRole('button', { name: /^Impayé/ }).count() === 0, 'Gérant : pas de bouton « Impayé »');
await logout(); await login('resp'); await open();
if (process.env.SHOT0) await p.locator('main .card').first().screenshot({ path: process.env.SHOT0 });
await p.getByRole('button', { name: /^Impayé/ }).click(); await p.waitForTimeout(300);
if (process.env.SHOT) await p.getByRole('dialog').screenshot({ path: process.env.SHOT });
await p.getByRole('dialog').getByRole('button', { name: 'Mettre en impayé' }).click(); await p.waitForTimeout(500);
const o = await p.evaluate(() => window.__tsena.get('orders', 'o1'));
ok(o.payments[0].amount === 0, `paiement passé à 0 (${o.payments[0].amount})`);
const tx = N(await p.locator('main').innerText());
ok(tx.includes('Argent pas reçu (impayé)') && tx.includes('20 000 Ar (Espèces) → 0 Ar (Espèces)'), 'correction visible sous le paiement');
ok(await p.getByRole('button', { name: /^Impayé/ }).count() === 0, 'plus de bouton Impayé sur un paiement à 0');
if (process.env.SHOT2) await p.locator('.card', { hasText: 'Paiements' }).last().screenshot({ path: process.env.SHOT2 });
await b.close();
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); process.exit(fail ? 1 : 0);
