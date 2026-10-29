// Restes à payer : vente de 100 000 payée 20 000 le jour, 30 000 le lendemain (1er paiement du reste), reste 50 000.
// Les dépenses sont débitées de la caisse de la boutique, pas du versement du vendeur.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 1280, height: 1000 }, timezoneId: 'Indian/Antananarivo' })).newPage();
const N = (t) => t.replace(/[  ]/g, ' ');
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
await p.evaluate(async () => {
  const t = window.__tsena; const now = new Date(); const y = new Date(now.getTime() - 86400000); const Y = y.toISOString(), T = now.toISOString();
  const hash = t.get('users', 'user-superadmin').passwordHash;
  await t.save('users', [{ id: 'u1', username: 'aina', fullName: 'Aina', roleId: 'role-seller', active: true, passwordHash: hash, mustChangePassword: false, pageIds: ['pg1'] }]);
  await t.save('categories', [{ id: 'pg1', name: 'Hotel' }]);
  await t.save('products', [{ id: 'p1', code: 'SV', name: 'Savon', categoryId: 'pg1', priceRetail: 100000, active: true }]);
  await t.save('variants', [{ id: 'v1', productId: 'p1', sku: 'SV', active: true }]);
  await t.save('stockMoves', [{ variantId: 'v1', qty: 50, type: 'initial', at: Y }]);
  await t.save('orders', [{ id: 'R1', number: 'V-R1', kind: 'order', channel: 'shop', status: 'delivered', name: 'Grossiste', createdAt: Y, createdBy: 'u1', createdByName: 'Aina', discount: 0, lines: [{ id: 'l', variantId: 'v1', qty: 1, unitPrice: 100000 }], payments: [{ id: 'a', at: Y, amount: 20000, method: 'cash', receivedBy: 'shop' }, { id: 'b', at: T, amount: 30000, method: 'cash', receivedBy: 'shop' }] }]);
  await t.save('cashMoves', [{ id: 'e1', at: T, account: 'cash', amount: -5000, type: 'expense', label: 'Taxi', userName: 'Aina' }]);
});
// Situation d'hier
await p.goto('http://localhost:5173/#/'); await p.waitForTimeout(500);
await p.locator('.situation-card select').first().selectOption('yesterday'); await p.waitForTimeout(400);
let tx = N(await p.locator('.situation-card').innerText());
ok(/Espèces\s*20 000 Ar/.test(tx) && /1er paiement du reste\s*30 000 Ar/.test(tx) && /Reste à payer\s*50 000 Ar/.test(tx), 'situation d’hier : espèces 20 000, 1er paiement du reste 30 000, reste 50 000');
if (!/1er paiement du reste\s*30 000 Ar/.test(tx)) console.log(tx.slice(0, 900));
// Versements : restes à payer
await p.goto('http://localhost:5173/#/versements'); await p.waitForTimeout(600);
tx = N(await p.locator('main').innerText());
ok(tx.includes('Restes à payer') && tx.includes('Ventes d’hier') && tx.includes('V-R1') && /50 000 Ar/.test(tx), 'responsable : reste d’hier V-R1 50 000');
await p.getByRole('button', { name: /Restes payés ce jour/ }).click(); await p.waitForTimeout(300);
tx = N(await p.locator('main').innerText());
ok(tx.includes('V-R1') && tx.includes('30 000 Ar'), 'restes payés ce jour : 30 000 (1er paiement)');
// Feuille d'Aina : dépense non déduite
await p.getByRole('button', { name: 'Par vendeur' }).click(); await p.waitForTimeout(300);
await p.getByRole('button', { name: /Aina/ }).first().click().catch(() => {}); await p.waitForTimeout(300);
tx = N(await p.locator('main').innerText());
ok(tx.includes('débitées de la caisse de la boutique'), 'dépense : débitée de la caisse, pas du versement');
await p.goto('http://localhost:5173/#/commandes/R1'); await p.waitForTimeout(400);
ok(N(await p.locator('main').innerText()).includes('1er paiement du reste'), 'commande : paiement du lendemain marqué « 1er paiement du reste »');
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); await b.close(); process.exit(fail ? 1 : 0);
