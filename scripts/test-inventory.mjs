// Inventaire complet : photo, comptage gardé, validation → fiche d'historique, détail des mouvements, export Excel
// réimportable, filtre par page, annulation (stock remis).
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
  const t = window.__tsena; const now = new Date().toISOString(); const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  await t.save('categories', [{ id: 'lp', name: 'Lampe', code: 'LAMP' }, { id: 'ka', name: 'Kapa', code: 'KAPA' }]);
  await t.save('products', [{ id: 'a1', code: 'LAMP-PH6', name: 'PH6', categoryId: 'lp', priceRetail: 10000, active: true, photo: png }, { id: 'a2', code: 'LAMP-PH7', name: 'PH7', categoryId: 'lp', priceRetail: 10000, active: true }, { id: 'k1', code: 'KAPA-K4', name: 'K4', categoryId: 'ka', priceRetail: 10000, active: true }]);
  await t.save('variants', [{ id: 'va1', productId: 'a1', sku: 'LAMP-PH6', costAvg: 4000, active: true }, { id: 'va2', productId: 'a2', sku: 'LAMP-PH7', costAvg: 4000, active: true }, { id: 'vk1', productId: 'k1', sku: 'KAPA-K4', costAvg: 4000, active: true }]);
  await t.save('stockMoves', ['va1', 'va2', 'vk1'].map((v) => ({ variantId: v, qty: 10, type: 'initial', at: now })));
  await t.save('orders', { id: 'S1', number: 'V-1', kind: 'order', channel: 'shop', phone: '', status: 'delivered', lines: [{ id: 'l1', variantId: 'va1', qty: 2, unitPrice: 10000, qtyKept: 2 }], payments: [], discount: 0, deliveryFee: 0, createdAt: now });
  await t.save('stockMoves', { variantId: 'va1', qty: -2, type: 'sale', refType: 'order', refId: 'S1', at: now, reason: 'V-1 — vente sur place' });
});
const stock = (v) => p.evaluate((id) => window.__tsena.all('stockMoves').filter((m) => m.variantId === id).reduce((s, m) => s + m.qty, 0), v);
await p.goto('http://localhost:5173/#/stock/inventaire'); await p.waitForTimeout(600);
ok(await p.locator('.inv-table img').count() >= 1, 'colonne photo dans l’inventaire');
// Filtre page
await p.getByLabel('Page').first().selectOption('lp').catch(async () => { await p.getByLabel('Page').first().click(); await p.getByRole('option', { name: 'Lampe' }).click(); });
await p.waitForTimeout(300);
let tx = N(await p.locator('main').innerText());
ok(tx.includes('LAMP-PH6') && !tx.includes('KAPA-K4'), 'filtre par page : seulement la page Lampe');
await p.getByLabel('Compté LAMP-PH6').fill('7'); await p.getByLabel('Compté LAMP-PH7').fill('10'); await p.waitForTimeout(300);
// Le comptage reste après avoir quitté l'écran
await p.goto('http://localhost:5173/#/stock/etat'); await p.waitForTimeout(300); await p.goto('http://localhost:5173/#/stock/inventaire'); await p.waitForTimeout(500);
ok(await p.getByLabel('Compté LAMP-PH6').inputValue() === '7', 'comptage gardé après avoir quitté l’écran');
tx = N(await p.locator('main').innerText());
ok(tx.includes('2 ligne(s) comptée(s)') && tx.includes('1 écart(s)'), '2 lignes comptées, 1 écart');
// Détail de l'écart
await p.locator('tr', { hasText: 'LAMP-PH6' }).getByRole('button', { name: 'Détail' }).click(); await p.waitForTimeout(300);
tx = N(await p.getByRole('dialog').innerText());
ok(tx.includes('V-1') && tx.includes('jamais compté') && tx.includes('−2'), 'détail : la vente V-1 de 2 pièces apparaît');
await p.getByRole('dialog').getByRole('button', { name: 'Fermer' }).last().click(); await p.waitForTimeout(200);
// Valider
await p.getByRole('button', { name: 'Valider l’inventaire' }).click(); await p.waitForTimeout(200);
await p.getByRole('dialog').getByLabel('Note (facultatif)').fill('test mensuel');
await p.getByRole('dialog').getByRole('button', { name: 'Valider' }).click(); await p.waitForTimeout(600);
const inv = await p.evaluate(() => window.__tsena.all('inventories')[0]);
ok(inv && inv.counted === 2 && inv.gaps === 1 && inv.lines.find((l) => l.sku === 'LAMP-PH6').theo === 8 && inv.byName === 'Super-admin', 'fiche INV enregistrée : qui, lignes, théorique 8, compté 7');
ok(await stock('va1') === 7, 'stock corrigé à 7');
tx = N(await p.locator('main').innerText());
ok(tx.includes(inv.number) && tx.includes('Validé'), 'historique : inventaire affiché');
// Détail et export
await p.locator('tr.row-link', { hasText: inv.number }).click(); await p.waitForTimeout(300);
const [dl] = await Promise.all([p.waitForEvent('download'), p.getByRole('dialog').getByRole('button', { name: 'Exporter (Excel)' }).click()]);
const path = '/tmp/claude-0/t/inv-export.xlsx'; await dl.saveAs(path);
ok(dl.suggestedFilename().startsWith('INV'), 'export Excel de l’inventaire');
// Annuler
await p.getByRole('dialog').getByRole('button', { name: 'Annuler cet inventaire' }).click(); await p.waitForTimeout(200);
const dialogs = p.getByRole('dialog');
await dialogs.last().getByLabel('Raison').fill('erreur de comptage');
await dialogs.last().getByRole('button', { name: 'Annuler l’inventaire' }).click(); await p.waitForTimeout(600);
ok(await stock('va1') === 8, 'inventaire annulé : stock revenu à 8');
await p.keyboard.press('Escape'); await p.waitForTimeout(200);
// Réimporter l'export
await p.getByRole('button', { name: /^Compter$/ }).click(); await p.waitForTimeout(300);
await p.getByLabel('Fichier de comptage').setInputFiles(path); await p.waitForTimeout(600);
ok(await p.getByLabel('Compté LAMP-PH6').inputValue() === '7' && await p.getByLabel('Compté LAMP-PH7').inputValue() === '10', 'export réimporté : même comptage retrouvé');
const sw = await p.evaluate(() => document.documentElement.scrollWidth); ok(sw <= W + 1, `pas de débordement (${sw})`);
console.log(fail ? `${fail} ÉCHEC(S)` : 'TOUT EST BON'); await b.close();
