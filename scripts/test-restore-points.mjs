// Points de restauration : création, actions faites depuis (par utilisateur), retour au point (données remises,
// journal gardé, photos gardées).
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const W = Number(process.argv[2] || 1280);
const p = await (await b.newContext({ viewport: { width: W, height: 900 }, timezoneId: 'Indian/Antananarivo', acceptDownloads: true })).newPage();
const N = (t) => t.replace(/[  ]/g, ' ');
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
await p.evaluate(async () => {
  const t = window.__tsena; const now = new Date().toISOString();
  await t.save('categories', { id: 'lp', name: 'Lampe' });
  await t.save('products', { id: 'a1', code: 'LAMP-PH6', name: 'PH6', categoryId: 'lp', priceRetail: 10000, active: true, photo: 'data:image/png;base64,AAAA' });
  await t.save('variants', { id: 'va1', productId: 'a1', sku: 'LAMP-PH6', costAvg: 4000, active: true });
  await t.save('stockMoves', { variantId: 'va1', qty: 10, type: 'initial', at: now });
  await t.save('orders', { id: 'S1', number: 'V-1', kind: 'order', channel: 'shop', phone: '', status: 'delivered', lines: [{ id: 'l1', variantId: 'va1', qty: 2, unitPrice: 10000, qtyKept: 2 }], payments: [], discount: 0, deliveryFee: 0, createdAt: now, dispatchedAt: now });
  await t.save('stockMoves', { variantId: 'va1', qty: -2, type: 'sale', refType: 'order', refId: 'S1', at: now });
});
const stock = () => p.evaluate(() => window.__tsena.all('stockMoves').filter((m) => m.variantId === 'va1').reduce((s, m) => s + m.qty, 0));
await p.goto('http://localhost:5173/#/parametres/sauvegarde'); await p.waitForTimeout(600);
await p.getByRole('button', { name: 'Créer un point maintenant' }).click(); await p.waitForTimeout(600);
ok(N(await p.locator('main').innerText()).includes('Manuel'), 'point de restauration créé');
// Erreur : la vente est annulée, puis 3 pièces retirées à la main
await p.goto('http://localhost:5173/#/commandes/S1'); await p.waitForTimeout(500);
await p.getByRole('button', { name: 'Annuler / supprimer la vente' }).click(); await p.waitForTimeout(200);
await p.getByRole('dialog').getByRole('button', { name: 'Annuler la vente' }).click(); await p.waitForTimeout(500);
ok(await stock() === 10, 'après l’erreur : stock 10, vente annulée');
await p.goto('http://localhost:5173/#/parametres/sauvegarde'); await p.waitForTimeout(600);
await p.locator('li', { hasText: 'Manuel' }).getByRole('button', { name: /Voir/ }).click(); await p.waitForTimeout(300);
let tx = N(await p.getByRole('dialog').innerText());
ok(tx.includes('Super-admin') && tx.includes('Vente annulée'), 'liste des actions faites depuis, par utilisateur');
await p.getByRole('dialog').getByRole('button', { name: 'Revenir à ce point' }).click(); await p.waitForTimeout(200);
const d = p.getByRole('dialog').last();
await d.getByLabel(/tapez RESTAURER/).fill('RESTAURER');
await d.getByRole('button', { name: 'Revenir à ce point' }).click(); await p.waitForTimeout(1200);
const st = await p.evaluate(() => ({ o: window.__tsena.get('orders', 'S1'), photo: window.__tsena.get('products', 'a1').photo, audit: window.__tsena.all('audit').map((a) => a.action) }));
ok(await stock() === 8 && st.o.status === 'delivered', 'retour au point : vente rétablie, stock 8');
ok(st.photo === 'data:image/png;base64,AAAA', 'photo de l’article gardée');
ok(st.audit.includes('Vente annulée') && st.audit.includes('Restauration'), 'journal gardé : l’erreur et la restauration y figurent');
const sw = await p.evaluate(() => document.documentElement.scrollWidth); ok(sw <= W + 1, `pas de débordement (${sw})`);
console.log(fail ? `${fail} ÉCHEC(S)` : 'TOUT EST BON'); await b.close();
