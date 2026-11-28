// « Corriger le prix » d'un article d'une vente livrée (prix de gros coché par erreur) : Responsable seulement.
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
  const t = window.__tsena; const hash = t.get('users', 'user-superadmin').passwordHash; const now = new Date().toISOString();
  await t.save('users', [
    { id: 'u3', username: 'resp', fullName: 'Rindra', roleId: 'role-manager', active: true, passwordHash: hash, mustChangePassword: false },
    { id: 'u4', username: 'gerant', fullName: 'Hery', roleId: 'role-admin', active: true, passwordHash: hash, mustChangePassword: false },
  ]);
  await t.save('categories', [{ id: 'nv', name: 'Netvision' }]);
  await t.save('products', [{ id: 'p1', code: 'NETV-CAA', name: 'CAMERA AMPOULE', categoryId: 'nv', priceRetail: 35000, priceWholesale: 30000, active: true }]);
  await t.save('variants', [{ id: 'v1', productId: 'p1', sku: 'NETV-CAA', active: true }]);
  await t.save('couriers', [{ id: 'k1', name: 'Patrick', active: true }]);
  await t.save('orders', [{ id: 'o1', number: 'C-NV1', kind: 'order', channel: 'facebook', phone: '0341110001', name: 'Client', zoneId: 'zone-centre', place: 'Analakely', courierId: 'k1', dispatchedAt: now, returnedAt: now, courierSettledAt: now, status: 'delivered', lines: [{ id: 'l1', variantId: 'v1', qty: 1, qtyKept: 1, unitPrice: 30000, wholesale: true }], discount: 0, deliveryFee: 4000, feeCharged: 4000, createdAt: now,
    payments: [{ id: 'py1', at: now, amount: 39000, method: 'mvola', receivedBy: 'shop', ref: '11587786748', userName: 'Nandrianina' }] }]);
});
const open = async () => { await p.goto('http://localhost:5173/#/commandes/o1'); await p.waitForTimeout(500); };
await logout(); await login('gerant'); await open();
ok(await p.getByRole('button', { name: /Corriger le prix/ }).count() === 0, 'Gérant : pas de « Corriger le prix »');
await logout(); await login('resp'); await open();
let tx = N(await p.locator('main').innerText());
ok(/Trop perçu \/ à rendre\s*5 000 Ar/.test(tx), 'avant : trop perçu 5 000');
if (process.env.SHOT0) await p.locator('main .card').nth(1).screenshot({ path: process.env.SHOT0 });
await p.getByRole('button', { name: /Corriger le prix/ }).click(); await p.waitForTimeout(300);
const f = p.getByRole('dialog').getByLabel('Prix unitaire (Ar)');
ok(await f.inputValue() === '35000', `prix proposé : prix normal 35 000 (${await f.inputValue()})`);
await p.getByRole('dialog').getByLabel('Motif').fill('Prix de gros coché par erreur');
if (process.env.SHOT) await p.getByRole('dialog').screenshot({ path: process.env.SHOT });
await p.getByRole('dialog').getByRole('button', { name: 'Enregistrer' }).click(); await p.waitForTimeout(500);
const o = await p.evaluate(() => window.__tsena.get('orders', 'o1'));
ok(o.lines[0].unitPrice === 35000 && !o.lines[0].wholesale, 'prix 35 000, prix de gros retiré');
tx = N(await p.locator('main').innerText());
ok(/Total\s*39 000 Ar/.test(tx) && /Reste à encaisser\s*0 Ar/.test(tx), 'total 39 000 = payé, reste 0');
ok(tx.includes('Prix corrigé : CAMERA AMPOULE') && tx.includes('30 000 Ar → 35 000 Ar (prix de gros retiré)'), 'historique : prix corrigé');
if (process.env.SHOT2) await p.locator('main .card').nth(1).screenshot({ path: process.env.SHOT2 });
await b.close();
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); process.exit(fail ? 1 : 0);
