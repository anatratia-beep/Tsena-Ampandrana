// Corrections de paiement (moyen, référence ajoutée plus tard, reçu par) et paiement Mobile Money au retour du livreur.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Indian/Antananarivo' })).newPage();
const N = (t) => t.replace(/[\u00a0\u202f]/g, ' ');
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
await p.evaluate(async () => {
  const t = window.__tsena; const now = new Date().toISOString();
  await t.save('categories', [{ id: 'pg1', name: 'Pyjamas' }]);
  await t.save('products', [{ id: 'p1', code: 'PJ', name: 'Pyjama', categoryId: 'pg1', priceRetail: 20000, active: true }]);
  await t.save('variants', [{ id: 'v1', productId: 'p1', sku: 'PJ', active: true }]);
  await t.save('stockMoves', [{ variantId: 'v1', qty: 20, type: 'initial', at: now }]);
  await t.save('couriers', [{ id: 'k1', name: 'Rado', active: true }]);
  const o = (id, num, name, extra = {}) => ({ id, number: num, kind: 'order', channel: 'facebook', phone: '034111' + id.slice(1).padStart(4, '0'), name, zoneId: 'zone-centre', place: 'Analakely', courierId: 'k1', status: 'out', dispatchedAt: now, lines: [{ id: 'l' + id, variantId: 'v1', qty: 1, unitPrice: 20000 }], payments: [], discount: 0, deliveryFee: 3000, createdAt: now, ...extra });
  await t.save('orders', [
    o('o1', 'C-1', 'Fara Un', { status: 'confirmed', dispatchedAt: undefined, payments: [{ id: 'py1', at: now, amount: 23000, method: 'orange', receivedBy: 'shop', userName: 'Vendeur' }] }),
    o('o2', 'C-2', 'Fara Deux'),
    o('o3', 'C-3', 'Fara Trois'),
  ]);
});

// 1. Orange Money → MVola, puis référence ajoutée plus tard
await p.goto('http://localhost:5173/#/commandes/o1'); await p.waitForTimeout(400);
let tx = N(await p.locator('main').innerText());
ok(tx.includes('Référence de la transaction pas encore saisie'), 'paiement mobile sans référence signalé');
await p.getByRole('button', { name: /Corriger ce paiement/ }).click();
await p.getByRole('dialog').getByLabel('Moyen').selectOption('mvola');
await p.getByRole('dialog').getByRole('button', { name: 'Enregistrer la correction' }).click(); await p.waitForTimeout(400);
tx = N(await p.locator('main').innerText());
ok(/23 000 Ar · MVola/.test(tx) && tx.includes('(Orange Money) → 23 000 Ar (MVola)'), 'moyen corrigé Orange Money → MVola, historique visible');
if (!tx.includes('(Orange Money) → 23 000 Ar (MVola)')) console.log(tx.slice(tx.indexOf('Paiements'), tx.indexOf('Paiements') + 400));
await p.getByRole('button', { name: 'Ajouter la référence' }).click();
await p.getByRole('dialog').getByLabel('Référence de la transaction').fill('MV123456');
await p.getByRole('dialog').getByRole('button', { name: 'Enregistrer la référence' }).click(); await p.waitForTimeout(400);
tx = N(await p.locator('main').innerText());
ok(tx.includes('réf. MV123456') && tx.includes('référence ajoutée : MV123456') && !tx.includes('pas encore saisie'), 'référence ajoutée après coup');

// 2. Retour d'une commande : le client a payé par MVola sur le numéro de la boutique
await p.goto('http://localhost:5173/#/commandes/o2'); await p.waitForTimeout(400);
await p.getByRole('button', { name: 'Confirmer le retour du livreur' }).click(); await p.waitForTimeout(200);
const d = p.getByRole('dialog');
await d.getByLabel('Le client a payé en').selectOption('mvola'); await p.waitForTimeout(150);
await d.getByLabel('Référence de la transaction').fill('MV777');
tx = N(await d.innerText());
ok(tx.includes('le livreur ne doit pas cet argent') && tx.includes('reverse ses frais (3 000 Ar)'), 'retour : explication paiement boutique + frais à reverser');
if (!tx.includes('reverse ses frais')) console.log(tx.slice(-900));
await d.getByRole('button', { name: 'Confirmer le retour' }).click(); await p.waitForTimeout(400);
const o2 = await p.evaluate(() => window.__tsena.get('orders', 'o2'));
ok(o2.payments.length === 1 && o2.payments[0].receivedBy === 'shop' && o2.payments[0].method === 'mvola' && o2.payments[0].amount === 23000 && o2.payments[0].ref === 'MV777', 'retour : paiement MVola enregistré comme reçu par la boutique');

// 3. Retour livreur groupé : colis payé en MVola
await p.goto('http://localhost:5173/#/livraisons/retour'); await p.waitForTimeout(500);
tx = N(await p.locator('main').innerText());
if (!tx.includes('Payé en Mobile Money')) console.log(tx.slice(-1500), JSON.stringify(await p.evaluate(() => window.__tsena.get('orders', 'o3'))).slice(0, 400));
await p.getByRole('button', { name: 'Payé en Mobile Money…' }).first().click(); await p.waitForTimeout(150);
await p.getByRole('dialog').getByLabel('Référence de la transaction').fill('MV888');
await p.getByRole('dialog').getByRole('button', { name: 'Enregistrer' }).click(); await p.waitForTimeout(300);
tx = N(await p.locator('main').innerText());
ok(tx.includes('MVola au retour réf. MV888'), 'retour groupé : paiement MVola affiché sur le colis');
ok(/Attendu du livreur maintenant\s*0 Ar/.test(tx), `retour groupé : rien à verser par le livreur`);
await p.getByRole('button', { name: /Valider le retour de Rado/ }).click(); await p.waitForTimeout(200);
await p.getByRole('dialog').getByRole('button', { name: 'Valider' }).click(); await p.waitForTimeout(600);
const o3 = await p.evaluate(() => window.__tsena.get('orders', 'o3'));
ok(o3.status === 'delivered' && o3.payments.length === 1 && o3.payments[0].receivedBy === 'shop' && o3.payments[0].ref === 'MV888' && o3.payments[0].amount === 23000, 'retour groupé : paiement MVola reçu par la boutique');

// 4. Correction « reçu par » : un paiement saisi comme encaissé par le livreur passe à la boutique
await p.evaluate(async () => { const t = window.__tsena; const o = t.get('orders', 'o3'); await t.save('orders', { id: 'o3', payments: [...o.payments, { id: 'dup', at: new Date().toISOString(), amount: 23000, method: 'cash', receivedBy: 'courier', courierId: 'k1' }] }); });
await p.goto('http://localhost:5173/#/commandes/o3'); await p.waitForTimeout(400);
await p.getByRole('button', { name: /Corriger ce paiement/ }).nth(1).click();
await p.getByRole('dialog').getByLabel('Montant (Ar)').fill('0');
await p.getByRole('dialog').getByRole('button', { name: 'Enregistrer la correction' }).click(); await p.waitForTimeout(400);
tx = N(await p.locator('main').innerText());
ok(!/Trop perçu/.test(tx), 'doublon annulé (montant 0) : plus de trop perçu');

console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); await b.close(); process.exit(fail ? 1 : 0);
