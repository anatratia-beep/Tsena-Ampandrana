// Rectifier une annulation : commande de 3 articles annulée par erreur (le client en a gardé 2) → rouverte « livrée en
// partie », stock juste (une seule fois), reste à payer recalculé ; semaine clôturée → validation du super-admin.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const W = Number(process.argv[2] || 1280);
const p = await (await b.newContext({ viewport: { width: W, height: 900 }, timezoneId: 'Indian/Antananarivo' })).newPage();
const N = (t) => t.replace(/[\u00a0\u202f]/g, ' ');
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
  const t = window.__tsena; const now = new Date().toISOString(); const hash = t.get('users', 'user-superadmin').passwordHash;
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const d = new Date(); const mon = new Date(d); mon.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7); mon.setHours(10, 0, 0, 0);
  const sat = new Date(mon); sat.setDate(mon.getDate() + 5);
  await t.save('users', { id: 'u1', username: 'aina', fullName: 'Aina', roleId: 'role-seller', active: true, passwordHash: hash, mustChangePassword: false });
  await t.save('categories', { id: 'pp', name: 'Pyjama', code: 'PYJ', attrs: [] });
  await t.save('products', ['a', 'b', 'c', 'd'].map((id) => ({ id, code: 'PYJ-' + id.toUpperCase(), name: 'Pyjama ' + id, categoryId: 'pp', attrs: {}, priceRetail: 10000, active: true })));
  await t.save('variants', ['a', 'b', 'c', 'd'].map((id) => ({ id: 'v' + id, productId: id, sku: 'S' + id, costAvg: 4000, active: true })));
  await t.save('stockMoves', ['a', 'b', 'c', 'd'].map((id) => ({ variantId: 'v' + id, qty: 10, type: 'initial', at: '2026-01-01T08:00:00.000Z' })));
  await t.save('couriers', { id: 'k1', name: 'Koto', active: true });
  const line = (id, v, qty = 1) => ({ id, variantId: v, qty, unitPrice: 10000 });
  const base = { kind: 'order', channel: 'facebook', phone: '0341111111', name: 'Rasoa', zoneId: 'zone-centre', deliveryFee: 3000, discount: 0, payments: [], status: 'out', courierId: 'k1', createdBy: 'u1', createdByName: 'Aina' };
  await t.save('orders', { ...base, id: 'C1', number: 'C-1', lines: [line('l1', 'va'), line('l2', 'vb'), line('l3', 'vc')], dispatchedAt: now, createdAt: now, statusDates: { out: now } });
  await t.save('stockMoves', ['va', 'vb', 'vc'].map((v) => ({ variantId: v, qty: -1, type: 'dispatch', refType: 'order', refId: 'C1', at: now })));
  const old = mon.toISOString();
  await t.save('orders', { ...base, id: 'C2', number: 'C-2', lines: [line('l4', 'vd', 2)], dispatchedAt: old, createdAt: old, statusDates: { out: old } });
  await t.save('stockMoves', { variantId: 'vd', qty: -2, type: 'dispatch', refType: 'order', refId: 'C2', at: old });
  await t.save('payouts', { id: `po_${ymd(mon)}`, weekStart: ymd(mon), weekEnd: ymd(sat), sales: 0, expenses: 0, expected: 0, amount: 0, account: 'cash', gap: 0, perPage: [], expenseIds: [], at: sat.toISOString(), byName: 'Super-admin', status: 'paid' });
});
const stock = (v) => p.evaluate((id) => window.__tsena.all('stockMoves').filter((m) => m.variantId === id).reduce((s, m) => s + m.qty, 0), v);
const order = (id) => p.evaluate((x) => window.__tsena.get('orders', x), id);

await logout(); await login('aina');
// 1. Le vendeur annule toute la commande par erreur
await p.goto('http://localhost:5173/#/commandes/C1'); await p.waitForTimeout(500);
await p.getByRole('button', { name: 'Annuler / supprimer' }).click(); await p.waitForTimeout(200);
await p.getByRole('dialog').getByRole('button', { name: 'Annuler la commande' }).click(); await p.waitForTimeout(500);
let o = await order('C1');
ok(o.status === 'cancelled' && o.cancelledById === 'u1' && await stock('va') === 10 && await stock('vc') === 10, 'commande annulée par Aina : 3 pièces remises en stock');
// 2. Il rectifie : 2 articles livrés, 1 annulé
await p.getByRole('button', { name: 'Rectifier une annulation' }).click(); await p.waitForTimeout(300);
let dlg = p.getByRole('dialog');
await dlg.getByLabel('Livré Sc').fill('0');
await dlg.getByLabel('Motif de la rectification').fill('Annuler touché par erreur, le client a gardé 2 pyjamas');
let tx = N(await dlg.innerText());
ok(tx.includes('23 000 Ar') && tx.includes('Sc +') === false && tx.includes('Sa -1 (livré)'), 'aperçu : vente 20 000 + 3 000 de frais, Sa et Sb sortent du stock');
await dlg.getByRole('button', { name: 'Rectifier', exact: true }).click(); await p.waitForTimeout(600);
o = await order('C1');
ok(o.status === 'partial' && o.lines.map((l) => l.qtyKept).join() === '1,1,0' && o.feeCharged === 3000, 'commande rouverte « livrée en partie » : 2 livrés, 1 annulé');
ok(await stock('va') === 9 && await stock('vb') === 9 && await stock('vc') === 10, 'stock : Sa 9, Sb 9, Sc 10 (seul l’article annulé est en stock)');
ok(o.payments.length === 0 && (o.rectifications || []).length === 1 && !o.rectifyRequest, 'paiements inchangés, rectification gardée dans l’historique');
tx = N(await p.locator('main').innerText());
ok(tx.includes('Reste à encaisser') && tx.includes('23 000 Ar') && tx.includes('Rectifications d’annulation') && tx.includes('Annulation rectifiée'), 'reste à payer recalculé (23 000 Ar), historique affiché');
ok(!(await p.getByRole('button', { name: 'Rectifier une annulation' }).count()), 'plus de bouton « Rectifier » : pas de double rectification');
// 3. Semaine clôturée : demande au super-admin
await p.goto('http://localhost:5173/#/commandes/C2'); await p.waitForTimeout(500);
await p.getByRole('button', { name: 'Annuler / supprimer' }).click(); await p.waitForTimeout(200);
await p.getByRole('dialog').getByRole('button', { name: 'Annuler la commande' }).click(); await p.waitForTimeout(500);
ok(await stock('vd') === 10, 'C-2 annulée : 2 pièces remises');
await p.getByRole('button', { name: 'Rectifier une annulation' }).click(); await p.waitForTimeout(300);
dlg = p.getByRole('dialog');
ok(N(await dlg.innerText()).includes('clôturée'), 'semaine clôturée : validation du super-admin annoncée');
await dlg.getByLabel('Motif de la rectification').fill('livrée en entier');
await dlg.getByRole('button', { name: 'Envoyer au super-admin' }).click(); await p.waitForTimeout(500);
o = await order('C2');
ok(o.status === 'cancelled' && o.rectifyRequest && await stock('vd') === 10, 'demande enregistrée, rien ne bouge avant validation');
ok(!(await p.getByRole('button', { name: 'Valider la rectification' }).count()), 'le vendeur ne peut pas valider lui-même');
await logout(); await login('super-adm');
await p.goto('http://localhost:5173/#/commandes'); await p.waitForTimeout(500);
ok(N(await p.locator('main').innerText()).includes('1 rectification(s) d’annulation à valider'), 'super-admin : demande signalée dans Commandes');
await p.goto('http://localhost:5173/#/commandes/C2'); await p.waitForTimeout(500);
await p.getByRole('button', { name: 'Valider la rectification' }).click(); await p.waitForTimeout(600);
o = await order('C2');
ok(o.status === 'delivered' && await stock('vd') === 8 && o.rectifications[0].approvedBy === 'Super-admin' && o.rectifications[0].requestedBy === 'Aina', 'validée : livrée, stock 8, demandée par Aina, validée par le super-admin');
const moves = await p.evaluate(() => window.__tsena.all('stockMoves').filter((m) => m.id.startsWith('rect-')).length);
ok(moves === 3, `3 mouvements de rectification au total (${moves})`);
const sw = await p.evaluate(() => document.documentElement.scrollWidth); ok(sw <= W + 1, `pas de débordement (${sw})`);
console.log(fail ? `${fail} ÉCHEC(S)` : 'TOUT EST BON'); await b.close();
