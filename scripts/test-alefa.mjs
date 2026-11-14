// Liaison Alefa : une commande à livrer part toute seule chez Alefa (clé API), l'étape, le livreur et la carte de suivi s'affichent dans Livraisons.
// Alefa est simulé (aucun appel réseau réel).
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Indian/Antananarivo' })).newPage();
const N = (t) => t.replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });

// ---- faux serveur Alefa
const ALEFA = 'https://livraison.oasismdg3434.workers.dev';
const created = []; let step = 'scheduled';
const ship = (b) => ({ ref: 'ALTEST' + Math.max(0, created.findIndex((c) => c.external_ref === b.external_ref)), external_ref: b.external_ref, step, step_label: { scheduled: 'Programmé', en_route: 'En route vers le destinataire' }[step], fee: 3000,
  delivery_pin: '4821', track_token: 'abcdef0123456789abcdef01', courier: { name: 'Santatra Vélo' }, accepted_at: step === 'en_route' ? Date.now() : null, departure_at: Date.now() + 3600e3 });
await p.route(`${ALEFA}/api/v1/**`, async (r) => {
  const req = r.request();
  if (req.headers()['x-api-key'] !== 'ak_test') return r.fulfill({ status: 401, json: { message: 'Clé API invalide' } });
  if (req.method() === 'POST' && req.url().endsWith('/shipments')) { const body = JSON.parse(req.postData()); created.push(body); return r.fulfill({ status: 201, json: { shipment: ship(body) } }); }
  if (req.method() === 'GET' && req.url().includes('/shipments')) return r.fulfill({ json: { shipments: created.map(ship) } });
  return r.fulfill({ json: { departures: [] } });
});

await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter'); await p.waitForTimeout(600);
const later = p.getByRole('button', { name: 'Plus tard' }); if (await later.count()) { await later.click(); await p.waitForTimeout(300); }
await p.evaluate(async () => {
  const t = window.__tsena; const at = new Date().toISOString();
  await t.save('categories', [{ id: 'pb', name: 'Powerbank' }]);
  await t.save('products', [{ id: 'a', code: 'PB10', name: 'Powerbank 10000', categoryId: 'pb', priceRetail: 50000, active: true }]);
  await t.save('variants', [{ id: 'vn', productId: 'a', sku: 'PB10-N', color: 'Noir', active: true }]);
  await t.save('stockMoves', [{ variantId: 'vn', qty: 5, type: 'initial', at }]);
  const order = (id, number, extra) => ({ id, number, kind: 'order', channel: 'facebook', phone: '0341111111', name: 'Rasoa', status: 'ready', zoneId: 'zone-centre', place: 'Ankorondrano',
    lines: [{ id: 'l' + id, variantId: 'vn', qty: 1, unitPrice: 50000 }], payments: [], discount: 0, deliveryFee: 3000, createdAt: at, ...extra });
  await t.save('orders', [order('O1', 'C-A0001', {}), order('O2', 'C-A0002', { courierId: 'k1' })]);
  await t.save('settings', { id: 'company', alefaKey: 'ak_test', alefaAuto: 'free', alefaPickup: 'Ampandrana' }, { force: true });
});
await p.waitForTimeout(2500);
ok(created.length === 1 && created[0].external_ref === 'C-A0001', `envoi automatique : seule la commande sans livreur part (${created.map((c) => c.external_ref).join(', ')})`);
ok(created[0]?.declared_value === 50000 && created[0]?.sender?.address === 'Ampandrana' && created[0]?.recipient?.address.includes('Ankorondrano'), 'valeur des articles, adresse de récupération et de livraison envoyées');
await p.waitForTimeout(800);
const sent = await p.evaluate(() => window.__tsena.get('orders', 'O1').alefa);
ok(sent?.ref === 'ALTEST0' && sent?.pin === '4821' && sent?.track, `commande liée à Alefa (${JSON.stringify(sent)})`);

await p.goto('http://localhost:5173/#/livraisons'); await p.waitForTimeout(800);
await p.getByText('En attente de livraison', { exact: true }).first().click(); await p.waitForTimeout(600);
await p.screenshot({ path: '/tmp/alefa-liv.png' });
let t = N(await p.locator('body').innerText());
ok(/Programmé \(à accepter\) · 🚲 Santatra Vélo/.test(t), 'étape + livreur visibles dans Livraisons');
// le livreur part : l'étape change chez Alefa, Tsena la suit
step = 'en_route';
await p.getByRole('button', { name: /Où sont les livraisons/ }).click(); await p.waitForTimeout(1200);
t = N(await p.getByRole('dialog').innerText());
ok(/C-A0001/.test(t) && /En route vers le destinataire · 🚲 Santatra Vélo/.test(t), `tableau « où sont les livraisons » à jour (${t.slice(0, 160)})`);
const href = await p.getByRole('dialog').getByRole('link', { name: '📍 Carte' }).first().getAttribute('href');
ok(href === `${ALEFA}/suivi/abcdef0123456789abcdef01`, `lien carte de suivi : ${href}`);
if (process.env.SHOT) await p.getByRole('dialog').screenshot({ path: process.env.SHOT });
await p.waitForTimeout(1500);
ok(created.length === 1, 'jamais envoyée deux fois');
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); await b.close(); process.exit(fail ? 1 : 0);
