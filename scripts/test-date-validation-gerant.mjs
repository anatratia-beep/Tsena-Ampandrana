// Date de validation : le gérant (rôle Admin / Gérant, droit « orders.moveDay ») peut la modifier comme le super-admin ;
// le vendeur ne le peut pas.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Indian/Antananarivo' })).newPage();
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
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const yest = ymd(new Date(Date.now() - 864e5));
await p.evaluate(async () => {
  const t = window.__tsena; const now = new Date().toISOString(); const hash = t.get('users', 'user-superadmin').passwordHash;
  await t.save('users', [{ id: 'g1', username: 'gerant', fullName: 'Mbola', roleId: 'role-admin', active: true, passwordHash: hash, mustChangePassword: false },
    { id: 'u1', username: 'aina', fullName: 'Aina', roleId: 'role-seller', active: true, passwordHash: hash, mustChangePassword: false }]);
  await t.save('categories', { id: 'pp', name: 'Pyjama', code: 'PYJ', attrs: [] });
  await t.save('products', { id: 'a', code: 'PYJ-A', name: 'Pyjama a', categoryId: 'pp', attrs: {}, priceRetail: 10000, active: true });
  await t.save('variants', { id: 'va', productId: 'a', sku: 'Sa', costAvg: 4000, active: true });
  await t.save('stockMoves', [{ variantId: 'va', qty: 10, type: 'initial', at: '2026-01-01T08:00:00.000Z' }, { variantId: 'va', qty: -1, type: 'dispatch', refType: 'order', refId: 'H38', at: now }]);
  await t.save('couriers', { id: 'k1', name: 'Daniel', active: true });
  await t.save('orders', { id: 'H38', number: 'C-H0038', kind: 'order', channel: 'facebook', phone: '0387042748', name: 'appel', zoneId: 'zone-centre', deliveryFee: 3000, discount: 0,
    lines: [{ id: 'l1', variantId: 'va', qty: 1, unitPrice: 10000, qtyKept: 1 }], payments: [{ id: 'p1', at: now, amount: 13000, method: 'cash', receivedBy: 'courier' }],
    status: 'delivered', courierId: 'k1', createdBy: 'u1', createdByName: 'Aina', dispatchedAt: now, returnedAt: now, createdAt: now, statusDates: { out: now, delivered: now } });
});
const perm = await p.evaluate(() => window.__tsena.get('roles', 'role-admin').permissions.includes('orders.moveDay'));
ok(perm, 'rôle Admin / Gérant : droit « Modifier la date de validation » donné');
await logout(); await login('aina');
await p.goto('http://localhost:5173/#/commandes/H38'); await p.waitForTimeout(600);
ok(await p.getByRole('button', { name: 'Modifier la date de validation' }).count() === 0, 'vendeur : pas de bouton');
await logout(); await login('gerant');
await p.goto('http://localhost:5173/#/commandes/H38'); await p.waitForTimeout(600);
await p.getByRole('button', { name: 'Modifier la date de validation' }).click(); await p.waitForTimeout(300);
const dlg = p.getByRole('dialog');
await dlg.getByLabel('Nouvelle date de validation').fill(yest);
await dlg.getByRole('button', { name: 'Changer la date' }).click(); await p.waitForTimeout(600);
const o = await p.evaluate(() => window.__tsena.get('orders', 'H38'));
const loc = (iso) => ymd(new Date(iso));
ok(loc(o.dispatchedAt) === yest && loc(o.payments[0].at) === yest, 'gérant : date de validation passée à hier');
ok(o.events.some((e) => N(e.text).includes('Date de validation modifiée par Mbola')), 'historique : modifiée par Mbola');
// Mise à jour unique : Anja (Responsable) passe Admin / Gérant au démarrage.
await p.evaluate(async () => { const t = window.__tsena; const hash = t.get('users', 'user-superadmin').passwordHash;
  await t.save('users', { id: 'an1', username: 'anja', fullName: 'Anja', roleId: 'role-manager', active: true, passwordHash: hash, mustChangePassword: false });
  await t.save('roles', { id: 'role-admin', migrations: (t.get('roles', 'role-admin').migrations || []).filter((m) => m !== 'anja-admin') }); });
await p.reload(); await p.waitForTimeout(1200);
ok(await p.evaluate(() => window.__tsena.get('users', 'an1').roleId) === 'role-admin', 'Anja : rôle Admin / Gérant après démarrage');
await p.evaluate(async () => { await window.__tsena.save('users', { id: 'an1', roleId: 'role-manager' }); });
await p.reload(); await p.waitForTimeout(1200);
ok(await p.evaluate(() => window.__tsena.get('users', 'an1').roleId) === 'role-manager', 'une seule fois : rôle changé ensuite pas remis');
console.log(fail ? `${fail} ÉCHEC(S)` : 'TOUT EST BON'); await b.close(); process.exit(fail ? 1 : 0);
