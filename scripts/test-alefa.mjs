// Liaison Alefa : la fiche livreur « Alefa » est créée seule ; une commande donnée à Alefa part chez Alefa ;
// l'avancement Alefa fait avancer la commande (en livraison → livrée, retour enregistré) ; une annulation boutique part chez Alefa.
// Alefa est simulé (aucun appel réseau réel).
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Indian/Antananarivo' })).newPage();
const N = (t) => t.replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });

// ---- faux serveur Alefa
const ALEFA = 'https://livraison.oasismdg3434.workers.dev';
const created = []; const step = {}; const cancels = [];
const LABEL = { scheduled: 'Programmé', picked_up: 'Récupéré', en_route: 'En route vers le destinataire', delivered: 'Livré', cancelled: 'Annulé' };
const ship = (b) => { const i = created.findIndex((c) => c.external_ref === b.external_ref); const st = step[b.external_ref] || 'scheduled';
  return { ref: 'ALTEST' + i, external_ref: b.external_ref, step: st, step_label: LABEL[st], fee: 3000, delivery_pin: '4821', track_token: 'abcdef0123456789abcdef0' + i,
    courier: { name: 'Santatra Vélo' }, accepted_at: Date.now(), departure_at: Date.now() + 3600e3, collected: st === 'delivered' ? b.declared_value + 3000 : 0 }; };
await p.route(`${ALEFA}/api/v1/**`, async (r) => {
  const req = r.request();
  if (req.headers()['x-api-key'] !== 'ak_test') return r.fulfill({ status: 401, json: { message: 'Clé API invalide' } });
  const u = new URL(req.url());
  if (req.method() === 'POST' && u.pathname.endsWith('/cancel')) { cancels.push(decodeURIComponent(u.pathname.split('/').at(-2))); return r.fulfill({ json: { ok: true } }); }
  if (req.method() === 'POST' && u.pathname.endsWith('/shipments')) { const body = JSON.parse(req.postData()); if (!created.some((c) => c.external_ref === body.external_ref)) created.push(body); return r.fulfill({ status: 201, json: { shipment: ship(body) } }); }
  if (req.method() === 'GET' && u.pathname.endsWith('/shipments')) return r.fulfill({ json: { shipments: created.map(ship) } });
  return r.fulfill({ json: { departures: [] } });
});
const tick = () => p.evaluate(() => window.__alefaTick?.()).then(() => p.waitForTimeout(500));

await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter'); await p.waitForTimeout(600);
const later = p.getByRole('button', { name: 'Plus tard' }); if (await later.count()) { await later.click(); await p.waitForTimeout(300); }
await p.evaluate(async () => {
  const t = window.__tsena; const at = new Date().toISOString();
  await t.save('categories', [{ id: 'pb', name: 'Powerbank' }]);
  await t.save('products', [{ id: 'a', code: 'PB10', name: 'Powerbank 10000', categoryId: 'pb', priceRetail: 50000, active: true }]);
  await t.save('variants', [{ id: 'vn', productId: 'a', sku: 'PB10-N', color: 'Noir', active: true }]);
  await t.save('stockMoves', [{ variantId: 'vn', qty: 5, type: 'initial', at }]);
  await t.save('couriers', [{ id: 'k1', name: 'Mbola', active: true }]);
  await t.save('settings', { id: 'company', alefaKey: 'ak_test', alefaPickup: 'Ampandrana' }, { force: true });
});
await p.waitForTimeout(800); await tick();
const courier = await p.evaluate(() => window.__tsena.get('couriers', 'courier-alefa'));
ok(courier?.active && /Alefa/.test(courier.name), `fiche livreur « Alefa » créée toute seule (${courier?.name})`);

await p.evaluate(async () => {
  const t = window.__tsena; const at = new Date().toISOString();
  const order = (id, number, extra) => ({ id, number, kind: 'order', channel: 'facebook', phone: '0341111111', name: 'Rasoa', status: 'confirmed', zoneId: 'zone-centre', place: 'Ankorondrano, devant la pharmacie',
    lines: [{ id: 'l' + id, variantId: 'vn', qty: 1, unitPrice: 50000 }], payments: [], discount: 0, deliveryFee: 3000, createdAt: at, ...extra });
  await t.save('orders', [order('O1', 'C-A0001', { courierId: 'courier-alefa' }), order('O2', 'C-A0002', { courierId: 'k1', status: 'ready' }), order('O3', 'C-A0003', { courierId: 'courier-alefa' })]);
});
await p.waitForTimeout(500); await tick();
ok(created.map((c) => c.external_ref).sort().join() === 'C-A0001,C-A0003', `envoi automatique : seules les commandes du livreur « Alefa » partent (${created.map((c) => c.external_ref).join(', ')})`);
ok(created[0]?.declared_value === 50000 && created[0]?.sender?.address === 'Ampandrana' && /Ankorondrano/.test(created[0]?.recipient?.address), 'valeur des articles, adresse de récupération et de livraison envoyées');
const o1 = await p.evaluate(() => window.__tsena.get('orders', 'O1'));
ok(o1.alefa?.ref === 'ALTEST0' && o1.alefa?.track, 'commande liée à Alefa (référence, code, suivi)');

// le livreur Alefa récupère le colis → la commande passe « En livraison » (articles sortis du stock)
step['C-A0001'] = 'picked_up'; await tick(); await tick();
let x = await p.evaluate(() => window.__tsena.get('orders', 'O1'));
ok(x.status === 'out' && x.courierId === 'courier-alefa' && x.dispatchedAt, `récupéré chez Alefa → « En livraison » (${x.status})`);
// livré : retour enregistré tout seul, argent chez Alefa à régler dans « Retour livreur »
step['C-A0001'] = 'delivered'; await tick(); await tick();
x = await p.evaluate(() => window.__tsena.get('orders', 'O1'));
const paidCourier = (x.payments || []).filter((y) => y.receivedBy === 'courier').reduce((s, y) => s + y.amount, 0);
ok(x.status === 'delivered' && x.returnedAt && x.feeCharged === 3000 && paidCourier === 53000, `livré chez Alefa → commande livrée, 53 000 Ar encaissés par Alefa (${x.status}, ${paidCourier})`);
ok(!x.courierSettledAt, 'reste à régler avec Alefa dans « Retour livreur »');

// annulée dans la boutique avant récupération → annulation envoyée à Alefa
await p.evaluate(async () => { await window.__tsena.save('orders', { id: 'O3', status: 'cancelled' }); });
await p.waitForTimeout(300); await tick();
ok(cancels.includes('ALTEST1'), `annulation boutique transmise à Alefa (${cancels.join(', ')})`);

await p.goto('http://localhost:5173/#/livraisons'); await p.waitForTimeout(900);
const t = N(await p.locator('body').innerText());
ok(/Alefa \(centre de livraison\)/.test(t), 'livreur « Alefa » visible dans Livraisons et livreurs');
if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT });
await p.waitForTimeout(800);
ok(created.length === 2, 'jamais envoyée deux fois');
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); await b.close(); process.exit(fail ? 1 : 0);
