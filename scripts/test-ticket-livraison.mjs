// Ticket livraison : court, au nom (et logo) de la page ; client, contact, lieu, total articles, frais, total.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Indian/Antananarivo' })).newPage();
const N = (t) => t.replace(/[  ]/g, ' ');
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
await p.evaluate(async () => {
  const t = window.__tsena; const now = new Date().toISOString();
  const logo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDK+mmyAAAAABJRU5ErkJggg==';
  await t.save('settings', { id: 'company', name: 'TSENA SOCIETE', phone: '0320000000' });
  await t.save('categories', [{ id: 'bn', name: 'Bonnet', code: 'BN', logo, phone: '0341112233' }]);
  await t.save('products', [{ id: 'a', code: 'A', name: 'Bonnet laine', categoryId: 'bn', priceRetail: 15000, active: true }]);
  await t.save('variants', [{ id: 'va', productId: 'a', sku: 'A', costAvg: 5000, active: true }]);
  await t.save('zones', { id: 'z1', name: 'Analakely', fee: 4000, active: true });
  await t.save('orders', [{ id: 'L1', number: 'C-0042', kind: 'order', channel: 'facebook', name: 'Rasoa', phone: '0341234567', zoneId: 'z1', place: 'Pharmacie', status: 'confirmed',
    lines: [{ id: 'l1', variantId: 'va', qty: 2, unitPrice: 15000 }], payments: [], discount: 0, deliveryFee: 4000, createdAt: now }]);
});
await p.goto('http://localhost:5173/#/commandes/L1'); await p.waitForTimeout(500);
await p.locator('main').getByRole('button', { name: /Imprimer/ }).first().click(); await p.waitForTimeout(400);
await p.getByRole('dialog').getByText('Ticket livraison', { exact: true }).click(); await p.waitForTimeout(300);
const t = N(await p.locator('.ticket-preview').innerText()).replace(/\s+/g, ' ');
ok(t.includes('Bonnet') && t.includes('0341112233') && (await p.locator('.ticket-preview img').count()) === 1, `en-tête de la page avec logo (${t})`);
ok(/Client : Rasoa Contact : 034 ?12 ?345 ?67 Lieu : Analakely - Pharmacie/.test(t), 'client, contact, lieu');
ok(/Total articles 30 000 Ar Frais de livraison 4 000 Ar TOTAL 34 000 Ar/.test(t), 'total articles, frais, total');
ok(!t.includes('Bonnet laine') && !t.includes('Livreur'), 'pas de détail des articles');
if (process.env.SHOT) await p.locator('.ticket-preview').screenshot({ path: process.env.SHOT });
console.log(fail ? `${fail} ÉCHEC(S)` : 'TOUT EST BON'); await b.close(); process.exit(fail ? 1 : 0);
