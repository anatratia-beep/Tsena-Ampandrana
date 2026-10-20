// 2ème paiement : vente de 100 000 payée 20 000 le jour, 30 000 le lendemain (1er paiement), puis 50 000 le même jour (2ème paiement) : plus de reste.
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
  await t.save('orders', [{ id: 'R1', number: 'V-R1', kind: 'order', channel: 'shop', status: 'delivered', name: 'Grossiste', createdAt: Y, createdBy: 'u1', createdByName: 'Aina', discount: 0, lines: [{ id: 'l', variantId: 'v1', qty: 1, unitPrice: 100000 }], payments: [{ id: 'a', at: Y, amount: 20000, method: 'cash', receivedBy: 'shop' }, { id: 'b', at: T, amount: 30000, method: 'cash', receivedBy: 'shop' }, { id: 'c', at: new Date(now.getTime() + 1000).toISOString(), amount: 50000, method: 'mvola', receivedBy: 'shop' }] }]);
  await t.save('cashMoves', [{ id: 'e1', at: T, account: 'cash', amount: -5000, type: 'expense', label: 'Taxi', userName: 'Aina' }]);
});
// Situation d'hier
await p.goto('http://localhost:5173/#/'); await p.waitForTimeout(500);
await p.locator('.situation-card select').first().selectOption('yesterday'); await p.waitForTimeout(400);
let tx = N(await p.locator('.situation-card').innerText());
ok(/Espèces\s*20 000 Ar/.test(tx) && /1er paiement du reste\s*30 000 Ar/.test(tx) && true, 'situation d’hier : espèces 20 000, 1er paiement du reste 30 000, reste 50 000');
if (!/1er paiement du reste\s*30 000 Ar/.test(tx)) console.log(tx.slice(0, 900));
ok(/2ème paiement du reste\s*50 000 Ar/.test(tx) && /Reste à payer\s*0 Ar/.test(tx), 'reste réglé après le 1er paiement (même jour) : 2ème paiement 50 000, reste 0');
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); await b.close(); process.exit(fail ? 1 : 0);
