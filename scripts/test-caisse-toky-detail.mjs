// Caisse frais Toky : sous « Frais de N livraison(s) », chaque commande avec le nom de qui l'a faite, et Payé / Modifier / Annuler.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Indian/Antananarivo', deviceScaleFactor: Number(process.env.DPR || 1) })).newPage();
const N = (t) => t.replace(/[  ]/g, ' ').replace(/\s+/g, ' ');
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
await p.evaluate(async () => { const t = window.__tsena;
  const d = new Date(); const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const at = `${day}T09:00:00+03:00`, back = `${day}T16:00:00+03:00`;
  await t.save('categories', [{ id: 'ind', name: 'Induction' }]);
  await t.save('products', [{ id: 'a', code: 'A', name: 'Plaque', categoryId: 'ind', priceRetail: 95000, active: true }]);
  await t.save('variants', [{ id: 'va', productId: 'a', sku: 'A', costAvg: 50000, active: true }]);
  await t.save('users', [{ id: 'u-anja', username: 'anja', fullName: 'Anja', roleId: 'role-manager', active: true, passwordHash: t.get('users', 'user-superadmin').passwordHash, mustChangePassword: false, pageIds: ['ind'] }]);
  await t.save('couriers', [{ id: 'ct', name: 'Toky', active: true, feeToShop: true }]);
  const o = (id, fee, who) => ({ id, number: id, name: 'Client ' + id, kind: 'order', channel: 'online', phone: '0340000000', status: 'delivered', courierId: 'ct', zoneId: 'z1', createdByName: who,
    lines: [{ id: 'l' + id, variantId: 'va', qty: 1, unitPrice: 95000, qtyKept: 1 }], deliveryFee: fee, feeCharged: fee, discount: 0, createdAt: at, dispatchedAt: at, returnedAt: back,
    payments: [{ id: 'p' + id, at: back, amount: 95000 + fee, method: 'cash', receivedBy: 'courier', courierId: 'ct' }] });
  await t.save('orders', [o('T1', 3000, 'Anja'), o('T2', 4000, 'Diary'), o('T3', 5000, 'Richel')]);
});
await p.goto('http://localhost:5173/#/livraisons/recap'); await p.waitForTimeout(800);
await p.getByRole('tab', { name: 'Caisse frais Toky' }).click(); await p.waitForTimeout(700);
const card = p.locator('.synth', { hasText: 'Caisse frais Toky' });
const row = (id) => card.locator('tr.fund-order', { hasText: id });
let tx = N(await card.innerText());
ok(/Frais de 3 livraison\(s\) 12 000 Ar/.test(tx), `ligne du jour 12 000 (${tx.slice(0, 400)})`);
ok(/T1 · Client T1 Commande de Anja 3 000 Ar En attente/.test(N(await row('T1').innerText())), `T1 : commande de Anja, 3 000, en attente (${N(await row('T1').innerText())})`);
await row('T1').getByRole('button', { name: 'Payé' }).click(); await p.waitForTimeout(400);
ok(/Payé/.test(N(await row('T1').innerText())), 'T1 payé');
await row('T2').getByRole('button', { name: 'Modifier' }).click(); await p.waitForTimeout(300);
await p.getByRole('dialog').getByLabel('Frais reçu (Ar)').fill('2000'); await p.getByRole('dialog').getByRole('button', { name: 'Enregistrer' }).click(); await p.waitForTimeout(400);
ok(/2 000 Ar/.test(N(await row('T2').innerText())) && /au départ 4 000/.test(N(await row('T2').innerText())), `T2 corrigé à 2 000 (${N(await row('T2').innerText())})`);
await row('T3').getByRole('button', { name: 'Annuler' }).click(); await p.waitForTimeout(400);
tx = N(await card.innerText());
ok(/Annulé/.test(N(await row('T3').innerText())) && /Frais de 2 livraison\(s\) 5 000 Ar/.test(tx), `T3 annulé : ligne du jour 3 000 + 2 000 = 5 000 (${tx.slice(0, 300)})`);
ok(/Solde 5 000 Ar/.test(tx), 'solde 5 000');
const st = await p.evaluate(() => window.__tsena.get('orders', 'T2').feeCharged);
ok(st === 4000, 'la commande T2 garde son frais (4 000) : seule la caisse frais change');
if (process.env.SHOT) await p.waitForTimeout(4500);
if (process.env.SHOT) await card.screenshot({ path: process.env.SHOT });
await row('T3').getByRole('button', { name: 'Remettre en attente' }).click(); await p.waitForTimeout(400);
ok(/Frais de 3 livraison\(s\) 10 000 Ar/.test(N(await card.innerText())), 'T3 remis en attente : 10 000');
// Responsable (Anja) : peut remettre en attente et marquer payé
await p.goto('http://localhost:5173/#/compte'); await p.waitForTimeout(400); await p.locator('main').getByRole('button', { name: 'Se déconnecter' }).click(); await p.waitForTimeout(400);
await p.getByLabel("Nom d'utilisateur").fill('anja'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter'); await p.waitForTimeout(600);
{ const later = p.getByRole('button', { name: 'Plus tard' }); if (await later.count()) { await later.click(); await p.waitForTimeout(300); } }
await p.goto('http://localhost:5173/#/livraisons/caisse-frais'); await p.waitForTimeout(800);
ok(await row('T1').count() === 1, 'responsable : voit la caisse frais Toky et les commandes');
await row('T1').getByRole('button', { name: 'Remettre en attente' }).click(); await p.waitForTimeout(400);
ok(/En attente/.test(N(await row('T1').innerText())), 'responsable : T1 remis en attente');
await row('T1').getByRole('button', { name: 'Payé' }).click(); await p.waitForTimeout(400);
ok(/Payé · Anja/.test(N(await row('T1').innerText())), `responsable : T1 payé par Anja (${N(await row('T1').innerText())})`);
if (process.env.SHOT2) { await p.waitForTimeout(4500); await card.screenshot({ path: process.env.SHOT2 }); }
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); await b.close(); process.exit(fail ? 1 : 0);
