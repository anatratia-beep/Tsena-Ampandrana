// Logo et nom de chaque page sur les tickets : saisie dans « Pages et variantes », ticket au nom de la page,
// commande mélangée → page principale, page sans réglage → société.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const W = Number(process.argv[2] || 1280);
const p = await (await b.newContext({ viewport: { width: W, height: 900 }, timezoneId: 'Indian/Antananarivo' })).newPage();
const N = (t) => t.replace(/[  ]/g, ' ');
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
// Petit logo PNG rouge 2×2.
const dir = '/tmp/claude-0/t'; mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/logo-page.png`, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDK+mmyAAAAABJRU5ErkJggg==', 'base64'));
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
await p.evaluate(async () => {
  const t = window.__tsena; const now = new Date().toISOString();
  await t.save('settings', { id: 'company', name: 'TSENA SOCIETE', phone: '0320000000' });
  await t.save('categories', [{ id: 'pp', name: 'Poignet précieux', code: 'PP' }, { id: 'is', name: 'Intimity style', code: 'IS' }]);
  await t.save('products', [{ id: 'a', code: 'A', name: 'Montre', categoryId: 'pp', priceRetail: 15000, active: true }, { id: 'bx', code: 'B', name: 'Boxer', categoryId: 'is', priceRetail: 5000, active: true }]);
  await t.save('variants', [{ id: 'va', productId: 'a', sku: 'A', costAvg: 5000, active: true }, { id: 'vb', productId: 'bx', sku: 'B', costAvg: 2000, active: true }]);
  const sale = (id, lines) => ({ id, number: id, kind: 'order', channel: 'shop', phone: '', status: 'delivered', lines, payments: [], discount: 0, deliveryFee: 0, createdAt: now });
  await t.save('orders', [
    sale('V-PP', [{ id: 'l1', variantId: 'va', qty: 1, unitPrice: 15000, qtyKept: 1 }]),
    sale('V-MIX', [{ id: 'l2', variantId: 'vb', qty: 1, unitPrice: 5000, qtyKept: 1 }, { id: 'l3', variantId: 'va', qty: 2, unitPrice: 15000, qtyKept: 2 }]),
    sale('V-IS', [{ id: 'l4', variantId: 'vb', qty: 1, unitPrice: 5000, qtyKept: 1 }]),
  ]);
});
// Réglage de la page
await p.goto('http://localhost:5173/#/pages'); await p.waitForTimeout(500);
await p.locator('.cat-card', { hasText: 'Poignet précieux' }).getByRole('button', { name: /Modifier la page/ }).click(); await p.waitForTimeout(300);
const dlg = p.getByRole('dialog');
ok(N(await dlg.innerText()).includes('Logo et ticket de la page'), 'section « Logo et ticket de la page » dans la page');
await dlg.getByLabel('Logo de la page').setInputFiles(`${dir}/logo-page.png`); await p.waitForTimeout(400);
await dlg.getByLabel('Nom sur le ticket').fill('POIGNET PRÉCIEUX MG');
await dlg.getByLabel('Téléphone de la page').fill('0341112233');
await dlg.getByLabel('Message en bas du ticket').fill('Merci de suivre notre page !');
await dlg.getByRole('button', { name: 'Enregistrer' }).click(); await p.waitForTimeout(500);
const pg = await p.evaluate(() => window.__tsena.get('categories', 'pp'));
ok(pg.logo?.startsWith('data:image/') && pg.ticketName === 'POIGNET PRÉCIEUX MG' && pg.phone === '0341112233', 'logo, nom du ticket et téléphone enregistrés');
ok(await p.locator('.cat-card', { hasText: 'Poignet précieux' }).locator('.page-logo img').count() === 1, 'logo affiché dans la liste des pages');
// Tickets
const preview = async (id) => {
  await p.goto(`http://localhost:5173/#/commandes/${id}`); await p.waitForTimeout(500);
  await p.locator('main').getByRole('button', { name: /Imprimer/ }).first().click(); await p.waitForTimeout(400);
  const t = N(await p.locator('.ticket-preview').innerText()).replace(/\s+/g, ' ');
  const src = await p.locator('.ticket-preview img').first().getAttribute('src').catch(() => null);
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  return { t, src };
};
let r = await preview('V-PP');
ok(r.t.includes('POIGNET PRÉCIEUX MG') && !r.t.includes('TSENA SOCIETE'), 'ticket au nom de la page, pas de la société');
ok(r.t.includes('0341112233') && r.t.includes('Merci de suivre notre page'), 'téléphone et message de la page');
ok(r.src === pg.logo, 'logo de la page sur le ticket');
r = await preview('V-MIX');
ok(r.t.includes('POIGNET PRÉCIEUX MG'), 'commande mélangée : page principale (Poignet précieux, 30 000 contre 5 000)');
r = await preview('V-IS');
ok(r.t.includes('Intimity style') && r.t.includes('0320000000'), 'page sans réglage : son nom, le téléphone de la société');
const sw = await p.evaluate(() => document.documentElement.scrollWidth); ok(sw <= W + 1, `pas de débordement (${sw})`);
console.log(fail ? `${fail} ÉCHEC(S)` : 'TOUT EST BON'); await b.close();
