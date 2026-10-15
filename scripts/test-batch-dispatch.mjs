// « En attente de livraison » : livreur choisi directement dans la liste (par commande ou pour toute une zone),
// puis une seule validation pour tout remettre, chaque commande à son livreur.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const W = Number(process.argv[2] || 1280);
const p = await (await b.newContext({ viewport: { width: W, height: 900 }, timezoneId: 'Indian/Antananarivo' })).newPage();
const N = (t) => t.replace(/[\s  ]+/g, ' ');
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
await p.evaluate(async () => {
  const t = window.__tsena; const now = new Date().toISOString();
  await t.save('categories', { id: 'lp', name: 'Lampe' });
  await t.save('products', { id: 'a1', code: 'L1', name: 'Lampe', categoryId: 'lp', priceRetail: 10000, active: true });
  await t.save('variants', { id: 'va', productId: 'a1', sku: 'L1', costAvg: 4000, active: true });
  await t.save('stockMoves', { variantId: 'va', qty: 20, type: 'initial', at: now });
  await t.save('couriers', [{ id: 'k1', name: 'Fara', active: true }, { id: 'k2', name: 'Soa', active: true }]);
  const o = (id, zone, name) => ({ id, number: id, kind: 'order', channel: 'facebook', phone: '0340000000', name, zoneId: zone, status: 'ready', lines: [{ id: id + 'l', variantId: 'va', qty: 1, unitPrice: 10000 }], payments: [], discount: 0, deliveryFee: 3000, createdAt: now });
  await t.save('orders', [o('C1', 'zone-centre', 'Rabe'), o('C2', 'zone-centre', 'Rasoa'), o('C3', 'zone-proche', 'Koto'), o('C4', 'zone-proche', 'Lova')]);
});
await p.goto('http://localhost:5173/#/livraisons/a-livrer'); await p.waitForTimeout(600);
await p.getByLabel(/Livreur pour toute la zone Tana centre-ville/).selectOption('k1'); await p.waitForTimeout(300);
await p.getByLabel('Livreur C3').selectOption('k2'); await p.waitForTimeout(300);
await p.getByLabel('Choisir C4').check(); await p.waitForTimeout(150);
let tx = N(await p.locator('main').innerText());
ok(tx.includes('Valider : remettre 4 commande(s)') && tx.includes('Fara : 2') && tx.includes('Soa : 1') && tx.includes('1 sans livreur'), 'livreurs choisis dans la liste, commandes cochées automatiquement');
await p.getByRole('button', { name: /Valider : remettre 4/ }).click(); await p.waitForTimeout(300);
const d = p.getByRole('dialog');
await d.getByLabel(/Livreur pour les 1 commande/).selectOption('k2');
await d.getByRole('button', { name: 'Valider tout' }).click(); await p.waitForTimeout(800);
const st = await p.evaluate(() => ['C1', 'C2', 'C3', 'C4'].map((id) => { const o = window.__tsena.get('orders', id); return `${id}:${o.status}:${o.courierId}`; }).join(' '));
ok(st === 'C1:out:k1 C2:out:k1 C3:out:k2 C4:out:k2', `une seule validation : chaque commande remise à son livreur (${st})`);
const stock = await p.evaluate(() => window.__tsena.all('stockMoves').filter((m) => m.variantId === 'va').reduce((s, m) => s + m.qty, 0));
ok(stock === 16, `stock sorti pour les 4 colis (${stock})`);
const sw = await p.evaluate(() => document.documentElement.scrollWidth); ok(sw <= W + 1, `pas de débordement (${sw})`);
console.log(fail ? `${fail} ÉCHEC(S)` : 'TOUT EST BON'); await b.close();
