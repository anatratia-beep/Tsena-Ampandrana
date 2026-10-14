// Paiement en deux tranches : article à 10 000 Ar payé 5 000 Ar en espèces + 5 000 Ar en mobile money
// (vente sur place, paiement reçu sur une commande, paiement à la création d'une commande).
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
  const t = window.__tsena; const now = new Date().toISOString();
  await t.save('categories', { id: 'lp', name: 'Lampe' });
  await t.save('products', { id: 'a1', code: 'LAMPX', name: 'Lampe X', categoryId: 'lp', priceRetail: 10000, active: true });
  await t.save('variants', { id: 'va1', productId: 'a1', sku: 'LAMPX', costAvg: 4000, active: true });
  await t.save('stockMoves', { variantId: 'va1', qty: 10, type: 'initial', at: now });
  await t.save('orders', { id: 'O1', number: 'C-1', kind: 'order', channel: 'facebook', phone: '0340000000', status: 'new', lines: [{ id: 'l1', variantId: 'va1', qty: 1, unitPrice: 10000 }], payments: [], discount: 0, deliveryFee: 0, createdAt: now });
});
// 1. Vente sur place
await p.goto('http://localhost:5173/#/vente'); await p.waitForTimeout(500);
await p.getByLabel('Rechercher un article').fill('LAMPX'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
await p.getByRole('button', { name: /^Encaisser 10 000/ }).first().click(); await p.waitForTimeout(300);
const d = p.getByRole('dialog');
await d.getByRole('button', { name: 'Payer en 2 tranches (espèces + mobile money)' }).click(); await p.waitForTimeout(200);
ok(await d.getByLabel('Tranche 1 (Ar)').inputValue() === '5000' && await d.getByLabel('Tranche 2 (Ar)').inputValue() === '5000', 'vente : 2 tranches proposées, 5 000 + 5 000');
await d.getByLabel('Tranche 1 (Ar)').fill('3000'); await p.waitForTimeout(150);
ok(await d.getByLabel('Tranche 2 (Ar)').inputValue() === '7000', 'tranche 1 = 3 000 → tranche 2 complétée à 7 000');
await d.getByLabel('Tranche 1 (Ar)').fill('5000'); await p.waitForTimeout(150);
ok(N(await d.innerText()).includes('5 000 Ar Espèces + 5 000 Ar MVola') && N(await d.innerText()).includes('complet'), 'résumé : 5 000 Ar Espèces + 5 000 Ar MVola, complet');
await d.getByRole('button', { name: 'Valider la vente' }).click(); await p.waitForTimeout(600);
const s = await p.evaluate(() => window.__tsena.all('orders').find((o) => o.channel === 'shop'));
ok(s && s.payments.length === 2 && s.payments.some((x) => x.method === 'cash' && x.amount === 5000) && s.payments.some((x) => x.method === 'mvola' && x.amount === 5000), 'vente enregistrée avec 2 paiements (espèces 5 000 + MVola 5 000)');
// 2. Paiement reçu sur une commande
await p.goto('http://localhost:5173/#/commandes/O1'); await p.waitForTimeout(500);
await p.getByRole('button', { name: 'Paiement reçu' }).click(); await p.waitForTimeout(200);
const m = p.getByRole('dialog');
await m.getByRole('button', { name: 'Payer en 2 tranches (espèces + mobile money)' }).click(); await p.waitForTimeout(150);
await m.getByLabel('Moyen tranche 2').selectOption('orange');
await m.getByRole('button', { name: 'Enregistrer' }).click(); await p.waitForTimeout(600);
const o = await p.evaluate(() => window.__tsena.get('orders', 'O1'));
ok(o.payments.length === 2 && o.payments.some((x) => x.method === 'cash' && x.amount === 5000) && o.payments.some((x) => x.method === 'orange' && x.amount === 5000), 'commande : 5 000 espèces + 5 000 Orange Money enregistrés');
ok(N(await p.locator('main').innerText()).includes('Paiements'), 'paiements visibles dans la commande');
const sw = await p.evaluate(() => document.documentElement.scrollWidth); ok(sw <= W + 1, `pas de débordement (${sw})`);
console.log(fail ? `${fail} ÉCHEC(S)` : 'TOUT EST BON'); await b.close();
