// Livraisons → Récap livraison → « Caisse frais Toky » : livreur dont les frais vont à la caisse. Les frais de ses livraisons
// terminées entrent tout seuls ; dépenses (carburant…), sorties et rectifications saisies à la main ; solde. Rien ne va en caisse.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Indian/Antananarivo' })).newPage();
const N = (t) => t.replace(/[  ]/g, ' ');
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
const cash0 = await p.evaluate(async () => { const t = window.__tsena;
  const d = new Date(); const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const at = `${day}T09:00:00+03:00`, back = `${day}T16:00:00+03:00`;
  await t.save('categories', [{ id: 'ind', name: 'Induction' }]);
  await t.save('products', [{ id: 'a', code: 'A', name: 'Plaque', categoryId: 'ind', priceRetail: 95000, active: true }]);
  await t.save('variants', [{ id: 'va', productId: 'a', sku: 'A', costAvg: 50000, active: true }]);
  await t.save('couriers', [{ id: 'ct', name: 'Toky', active: true, feeToShop: true }, { id: 'c1', name: 'Andry', active: true }]);
  const o = (id, courierId, fee, status = 'delivered') => ({ id, number: id, kind: 'order', channel: 'online', phone: '0340000000', status, courierId, zoneId: 'z1',
    lines: [{ id: 'l' + id, variantId: 'va', qty: 1, unitPrice: 95000, qtyKept: 1 }], deliveryFee: fee, feeCharged: fee, discount: 0, createdAt: at, dispatchedAt: at, returnedAt: back,
    payments: status === 'cancelled' ? [] : [{ id: 'p' + id, at: back, amount: 95000 + fee, method: 'cash', receivedBy: 'courier', courierId }] });
  await t.save('orders', [o('t1', 'ct', 4000), o('t2', 'ct', 5000), o('t3', 'ct', 4000, 'cancelled'), o('a1', 'c1', 3000)]);
  return (await t.all('cashMoves')).length;
});
await p.goto('http://localhost:5173/#/livraisons/recap'); await p.waitForTimeout(900);
let tx = N(await p.locator('main').innerText());
ok(/Récap livraison\s+Caisse frais Toky/.test(tx), 'onglet « Caisse frais Toky » juste après « Récap livraison »');
ok(!/Solde au début/.test(tx), 'la caisse frais n’est pas sous le récap livraison');
await p.getByRole('tab', { name: 'Caisse frais Toky' }).click(); await p.waitForTimeout(700);
tx = N(await p.locator('main').innerText());
ok(/Caisse frais Toky[\s\S]*Solde au début/.test(tx), 'onglet Caisse frais Toky : la caisse à part');
ok(/Aujourd’hui|Aujourd'hui/.test(tx) && /Hier/.test(tx), 'choix de période : Aujourd’hui, Hier…');
ok(!/Caisse frais Andry/.test(tx), 'pas de caisse frais pour Andry');
ok(/Frais de 2 livraison\(s\)\s+9 000 Ar/.test(tx), 'frais du jour entrés tout seuls : 4 000 + 5 000 = 9 000 (la commande annulée ne compte pas)');
ok(/Solde\s+9 000 Ar/.test(tx), 'solde 9 000');
const add = async (kind, amount, label, sign) => {
  await p.getByRole('button', { name: 'Dépense, sortie ou rectification' }).click();
  await p.getByLabel('Type').selectOption(kind);
  if (sign) await p.getByLabel('Rectification', { exact: true }).selectOption(sign);
  await p.getByLabel('Montant (Ar)').fill(amount);
  if (label) await p.getByLabel(/^Motif/).fill(label);
  await p.getByRole('button', { name: 'Enregistrer' }).click(); await p.waitForTimeout(500);
};
await add('expense', '3000', 'Carburant');
await add('fix', '1000', 'C-H0020 : frais 3 000 au lieu de 4 000', '-');
await add('out', '2000', 'Avance');
tx = N(await p.locator('main').innerText());
ok(/Dépense : Carburant[\s\S]*?3 000 Ar/.test(tx), 'ligne dépense carburant 3 000');
ok(/Rectification : C-H0020[\s\S]*?1 000 Ar/.test(tx), 'ligne rectification − 1 000');
ok(/Sortie d’argent : Avance[\s\S]*?2 000 Ar/.test(tx), 'ligne sortie 2 000');
ok(/Entrées \(frais, rectif\. \+\)\s+\+ 9 000 Ar\s+Dépenses et sorties\s+− 6 000 Ar\s+Solde\s+3 000 Ar/.test(tx), 'entrées 9 000, sorties 6 000, solde 3 000');
const cash1 = await p.evaluate(async () => (await window.__tsena.all('cashMoves')).length);
ok(cash0 === cash1, 'aucun mouvement de caisse / trésorerie créé');
await p.goto('http://localhost:5173/#/'); await p.waitForTimeout(900);
const acc = N(await p.locator('main').innerText());
if (process.env.DBG) console.log(acc.slice(0, 1500));
ok(/Total des ventes[\s\S]{0,40}?285 000 Ar/.test(acc), 'accueil : total des ventes 285 000 = 3 × 95 000, sans les frais de Toky (ni d’Andry)');
await p.goto('http://localhost:5173/#/livraisons/caisse-frais'); await p.waitForTimeout(4500); await p.locator('main').screenshot({ path: process.env.SHOT || '/tmp/caisse-toky.png' });
await b.close(); process.exit(fail ? 1 : 0);
