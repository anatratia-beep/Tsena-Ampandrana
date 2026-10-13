// Suppression d'un vendeur (compte) et d'un livreur : confirmation, historique gardé, blocages si de l'argent est en jeu.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const W = Number(process.argv[2] || 1280);
const p = await (await b.newContext({ viewport: { width: W, height: 900 }, timezoneId: 'Indian/Antananarivo' })).newPage();
const N = (t) => t.replace(/[  ]/g, ' ');
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
await p.evaluate(async () => {
  const t = window.__tsena; const now = new Date().toISOString(); const hash = t.get('users', 'user-superadmin').passwordHash;
  await t.save('categories', { id: 'pp', name: 'Poignet précieux' });
  await t.save('products', { id: 'a', code: 'A', name: 'Montre', categoryId: 'pp', priceRetail: 15000, active: true });
  await t.save('variants', { id: 'va', productId: 'a', sku: 'A', costAvg: 5000, active: true });
  await t.save('couriers', [{ id: 'c1', name: 'Faly', active: true }, { id: 'c2', name: 'Toky', active: true }]);
  await t.save('users', [
    { id: 'u1', username: 'aina', fullName: 'Aina', roleId: 'role-seller', active: true, passwordHash: hash, mustChangePassword: false },
    { id: 'u4', username: 'faly', fullName: 'Faly', roleId: 'role-courier', courierId: 'c1', active: true, passwordHash: hash, mustChangePassword: false },
  ]);
  await t.save('orders', [
    { id: 'S1', number: 'S1', kind: 'order', channel: 'shop', phone: '', status: 'delivered', lines: [{ id: 'l1', variantId: 'va', qty: 1, unitPrice: 15000, qtyKept: 1 }], payments: [{ id: 'p1', at: now, amount: 15000, method: 'cash', receivedBy: 'shop' }], discount: 0, deliveryFee: 0, createdBy: 'u1', createdByName: 'Aina', createdAt: now },
    { id: 'D2', number: 'D2', kind: 'order', channel: 'facebook', phone: '0340000000', courierId: 'c2', status: 'out', lines: [{ id: 'l2', variantId: 'va', qty: 1, unitPrice: 15000 }], payments: [], discount: 0, deliveryFee: 3000, dispatchedAt: now, createdAt: now },
  ]);
});
// Vendeur
await p.goto('http://localhost:5173/#/utilisateurs'); await p.waitForTimeout(500);
ok(await p.getByRole('button', { name: 'Supprimer Super-admin' }).count() === 0, 'pas de bouton supprimer pour le super-admin / soi-même');
await p.getByRole('button', { name: 'Supprimer Aina' }).click(); await p.waitForTimeout(200);
let dlg = N(await p.getByRole('dialog').innerText());
ok(dlg.includes('15 000 Ar') && dlg.includes('ventes'), 'avertit que le vendeur doit encore remettre 15 000 Ar');
ok(await p.getByRole('dialog').getByRole('button', { name: 'Supprimer le compte' }).isDisabled(), 'il faut taper SUPPRIMER pour confirmer');
await p.getByRole('dialog').getByLabel(/tapez SUPPRIMER/).fill('SUPPRIMER');
await p.getByRole('dialog').getByRole('button', { name: 'Supprimer le compte' }).click(); await p.waitForTimeout(400);
const u1 = await p.evaluate(() => window.__tsena.get('users', 'u1'));
ok(u1.removed && !u1.active && u1.username !== 'aina', 'compte supprimé, identifiant libéré');
ok(!N(await p.locator('main').innerText()).includes('Aina'), 'n’apparaît plus dans la liste');
ok(await p.evaluate(() => window.__tsena.get('orders', 'S1').createdByName) === 'Aina', 'ses ventes gardent son nom');
await p.goto('http://localhost:5173/#/versements'); await p.waitForTimeout(500);
ok(N(await p.locator('main').innerText()).includes('Aina'), 'ses versements du jour restent visibles pour le responsable');
// Livreurs
await p.goto('http://localhost:5173/#/livraisons/livreurs'); await p.waitForTimeout(500);
await p.getByRole('button', { name: 'Supprimer le livreur Toky' }).click(); await p.waitForTimeout(200);
dlg = N(await p.getByRole('dialog').innerText());
ok(dlg.includes('Impossible') && dlg.includes('1 colis encore en livraison'), 'livreur avec un colis en cours : suppression bloquée');
await p.getByRole('dialog').getByRole('button', { name: 'Compris' }).click();
await p.getByRole('button', { name: 'Supprimer le livreur Faly' }).click(); await p.waitForTimeout(200);
dlg = N(await p.getByRole('dialog').innerText());
ok(dlg.includes('faly') && dlg.includes('sera supprimé aussi'), 'prévient que son accès à l’application est supprimé aussi');
await p.getByRole('dialog').getByLabel(/tapez SUPPRIMER/).fill('SUPPRIMER');
await p.getByRole('dialog').getByRole('button', { name: 'Supprimer le livreur' }).click(); await p.waitForTimeout(400);
const r = await p.evaluate(() => ({ c: window.__tsena.get('couriers', 'c1'), u: window.__tsena.get('users', 'u4') }));
ok(r.c.removed && !r.c.active && r.u.removed && !r.u.active, 'livreur et son accès supprimés');
const main = N(await p.locator('main').innerText());
ok(!main.includes('Faly') && main.includes('Toky'), 'Faly n’apparaît plus, Toky reste');
const sw = await p.evaluate(() => document.documentElement.scrollWidth); ok(sw <= W + 1, `pas de débordement (${sw})`);
// Connexion refusée
await p.goto('http://localhost:5173/#/compte'); await p.waitForTimeout(300);
await p.locator('main').getByRole('button', { name: 'Se déconnecter' }).click(); await p.waitForTimeout(400);
await p.getByLabel("Nom d'utilisateur").fill('aina'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter'); await p.waitForTimeout(500);
ok(N(await p.locator('body').innerText()).includes('incorrect'), 'le vendeur supprimé ne peut plus se connecter');
console.log(fail ? `${fail} ÉCHEC(S)` : 'TOUT EST BON'); await b.close();
