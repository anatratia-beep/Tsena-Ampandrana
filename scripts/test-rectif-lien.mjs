// Super-admin : la notice « rectification(s) d’annulation à valider » donne un lien direct vers chaque commande,
// même ancienne (hors période, autre page) : on l’ouvre et on voit « Valider la rectification ».
// Le responsable (Anja) peut aussi valider : la commande est rouverte (1 livré, 1 annulé).
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Indian/Antananarivo', deviceScaleFactor: Number(process.env.DPR || 1) })).newPage();
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
await p.evaluate(async () => {
  const t = window.__tsena; const at = new Date(Date.now() - 5 * 864e5).toISOString();
  await t.save('categories', [{ id: 'bn', name: 'Bonnet' }]);
  await t.save('users', [{ id: 'u-anja', username: 'anja', fullName: 'Anja', roleId: 'role-manager', active: true, passwordHash: t.get('users', 'user-superadmin').passwordHash, mustChangePassword: false, pageIds: ['bn'] }]);
  await t.save('products', [{ id: 'a', code: 'A', name: 'Bonnet', categoryId: 'bn', priceRetail: 15000, active: true }]);
  await t.save('variants', [{ id: 'va', productId: 'a', sku: 'A', costAvg: 5000, active: true }]);
  await t.save('orders', [{ id: 'K206', number: 'C-K0206', kind: 'order', channel: 'facebook', phone: '0332145632', name: 'Appel', status: 'cancelled', lines: [{ id: 'l1', variantId: 'va', qty: 2, unitPrice: 15000 }], payments: [], discount: 0, deliveryFee: 0, createdBy: 'x', createdByName: 'Anja', createdAt: at, dispatchedAt: at,
    rectifyRequest: { at, byName: 'Anja', reason: 'Le client a pris 1', kept: { l1: 1 }, feeCharged: 0 } }]);
});
await p.goto('http://localhost:5173/#/commandes'); await p.waitForTimeout(800);
const notice = p.locator('.rectif-notice');
ok(await notice.count() === 1 && /1 rectification/.test(await notice.innerText()), 'notice affichée');
if (process.env.SHOT) await notice.screenshot({ path: process.env.SHOT });
await notice.getByRole('link', { name: /C-K0206/ }).click(); await p.waitForTimeout(700);
ok(p.url().endsWith('#/commandes/K206'), `lien ouvre la commande (${p.url()})`);
ok(await p.getByRole('button', { name: 'Valider la rectification' }).count() === 1, 'bouton Valider la rectification visible');
if (process.env.SHOT2) await p.locator('.notice', { hasText: 'Rectification demandée' }).screenshot({ path: process.env.SHOT2 });
// Responsable
await p.goto('http://localhost:5173/#/compte'); await p.waitForTimeout(400); await p.locator('main').getByRole('button', { name: 'Se déconnecter' }).click(); await p.waitForTimeout(400);
await p.getByLabel("Nom d'utilisateur").fill('anja'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter'); await p.waitForTimeout(600);
{ const later = p.getByRole('button', { name: 'Plus tard' }); if (await later.count()) { await later.click(); await p.waitForTimeout(300); } }
await p.goto('http://localhost:5173/#/commandes'); await p.waitForTimeout(800);
ok(await p.locator('.rectif-notice').count() === 1, 'responsable : notice affichée');
await p.locator('.rectif-notice').getByRole('link', { name: /C-K0206/ }).click(); await p.waitForTimeout(700);
if (process.env.SHOT3) await p.locator('.notice', { hasText: 'Rectification demandée' }).screenshot({ path: process.env.SHOT3 });
await p.getByRole('button', { name: 'Valider la rectification' }).click(); await p.waitForTimeout(400);
ok(/Date de comptabilisation/.test(await p.getByRole('dialog').innerText()), 'responsable : choix de la date de comptabilisation');
if (process.env.SHOT4) await p.getByRole('dialog').screenshot({ path: process.env.SHOT4 });
await p.getByRole('dialog').getByRole('button', { name: 'Valider la rectification' }).click(); await p.waitForTimeout(800);
const st = await p.evaluate(() => { const o = window.__tsena.get('orders', 'K206'); return `${o.status} ${o.lines[0].qtyKept} ${o.rectifyRequest ? 'req' : 'none'}`; });
ok(st === 'partial 1 none', `responsable : rectification validée (${st})`);
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); await b.close(); process.exit(fail ? 1 : 0);
