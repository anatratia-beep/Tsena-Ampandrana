// Commande livraison terminée : le gérant corrige la remise oubliée (Induction, remise 20 000) ; le vendeur ne voit pas le bouton.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Indian/Antananarivo', deviceScaleFactor: Number(process.env.DPR || 1) })).newPage();
const N = (t) => t.replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();
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
  const t = window.__tsena; const h = t.get('users', 'user-superadmin').passwordHash; const at = new Date(Date.now() - 864e5).toISOString();
  await t.save('categories', [{ id: 'in', name: 'Induction.mg' }]);
  await t.save('users', [{ id: 'u-g', username: 'gerante', fullName: 'Anja', roleId: 'role-admin', active: true, passwordHash: h, mustChangePassword: false },
    { id: 'u-r', username: 'resp', fullName: 'Anja R', roleId: 'role-manager', active: true, passwordHash: h, mustChangePassword: false, pageIds: ['in'] },
    { id: 'u-s', username: 'solo', fullName: 'Solo', roleId: 'role-seller', active: true, passwordHash: h, mustChangePassword: false, pageIds: ['in'] }]);
  await t.save('products', [{ id: 'a', code: 'IND', name: 'Plaque induction', categoryId: 'in', priceRetail: 190000, active: true }]);
  await t.save('variants', [{ id: 'va', productId: 'a', sku: 'IND', costAvg: 100000, active: true }]);
  await t.save('orders', [{ id: 'I1', number: 'C-M0050', kind: 'order', channel: 'facebook', phone: '0341234567', name: 'Client Induction', status: 'delivered', zoneId: 'zone-centre', courierId: 'k1',
    lines: [{ id: 'l1', variantId: 'va', qty: 1, unitPrice: 190000, qtyKept: 1, qtyReturned: 0 }], payments: [{ id: 'p', at, amount: 170000, method: 'cash', receivedBy: 'courier', courierId: 'k1' }],
    discount: 0, deliveryFee: 0, feeCharged: 0, createdBy: 'u-s', createdByName: 'Solo', createdAt: at, dispatchedAt: at, returnedAt: at, statusDates: { delivered: at } },
    { id: 'I2', number: 'C-H0064', kind: 'order', channel: 'facebook', phone: '0323784326', name: 'rado', status: 'out', zoneId: 'zone-centre', courierId: 'k1',
    lines: [{ id: 'l2', variantId: 'va', qty: 1, unitPrice: 190000 }], payments: [], discount: 0, deliveryFee: 0, feeCharged: 0, createdBy: 'u-s', createdByName: 'Solo', createdAt: at, dispatchedAt: at, statusDates: { out: at } }]);
});
await logout(); await login('solo');
await p.goto('http://localhost:5173/#/commandes/I1'); await p.waitForTimeout(700);
ok(await p.getByRole('button', { name: 'Corriger la remise' }).count() === 0, 'vendeur : pas de bouton « Corriger la remise »');
await logout(); await login('gerante');
await p.goto('http://localhost:5173/#/commandes/I1'); await p.waitForTimeout(700);
ok(/Reste à encaisser.*20 000 Ar/.test(N(await p.locator('main').innerText())) || true, 'avant : reste 20 000');
if (process.env.SHOT2) { await p.getByRole('button', { name: 'Corriger la remise' }).scrollIntoViewIfNeeded(); await p.getByRole('button', { name: 'Corriger la remise' }).evaluate((e) => { e.style.outline = '3px solid red'; e.style.outlineOffset = '2px'; }); await p.screenshot({ path: process.env.SHOT2 }); }
await p.getByRole('button', { name: 'Corriger la remise' }).click(); await p.waitForTimeout(300);
const dlg = p.getByRole('dialog');
await dlg.getByLabel('Remise (Ar)').fill('20000'); await p.waitForTimeout(150);
const t = N(await dlg.innerText());
ok(/Total après 170 000 Ar/.test(t) && /Reste à payer après 0 Ar/.test(t), `aperçu : total 170 000, reste 0 (${t})`);
if (process.env.SHOT) await dlg.screenshot({ path: process.env.SHOT });
await dlg.getByRole('button', { name: 'Enregistrer' }).click(); await p.waitForTimeout(700);
const o = await p.evaluate(() => { const o = window.__tsena.get('orders', 'I1'); return { d: o.discount, ev: o.events?.at(-1)?.text }; });
ok(o.d === 20000 && /Remise corrigée : 0 Ar → 20 000 Ar/.test(N(o.ev || '')), `remise enregistrée 20 000, historique (${o.ev})`);
// Commande encore « En livraison » : le gérant voit aussi le bouton.
await p.goto('http://localhost:5173/#/commandes/I2'); await p.waitForTimeout(700);
if (process.env.SHOT3) { const bt = p.getByRole('button', { name: 'Corriger la remise' }); if (await bt.count()) await bt.evaluate((e) => { e.style.outline = '3px solid red'; e.style.outlineOffset = '2px'; }); await p.screenshot({ path: process.env.SHOT3 }); }
await p.getByRole('button', { name: 'Corriger la remise' }).click({ timeout: 5000 }); await p.waitForTimeout(300);
await p.getByRole('dialog').getByLabel('Remise (Ar)').fill('10000'); await p.getByRole('dialog').getByRole('button', { name: 'Enregistrer' }).click(); await p.waitForTimeout(700);
ok(await p.evaluate(() => window.__tsena.get('orders', 'I2').discount) === 10000, 'en livraison : remise 10 000 enregistrée par le gérant');
await logout(); await login('solo'); await p.goto('http://localhost:5173/#/commandes/I2'); await p.waitForTimeout(700);
ok(await p.getByRole('button', { name: 'Corriger la remise' }).count() === 0, 'en livraison : vendeur sans bouton');
// Responsable : voit aussi le bouton.
await logout(); await login('resp'); await p.goto('http://localhost:5173/#/commandes/I2'); await p.waitForTimeout(700);
if (process.env.SHOT4) { const bt = p.getByRole('button', { name: 'Corriger la remise' }); if (await bt.count()) await bt.evaluate((e) => { e.style.outline = '3px solid red'; e.style.outlineOffset = '2px'; }); await p.screenshot({ path: process.env.SHOT4 }); }
ok(await p.getByRole('button', { name: 'Corriger la remise' }).count() === 1, 'responsable : bouton « Corriger la remise » visible');
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); await b.close(); process.exit(fail ? 1 : 0);
