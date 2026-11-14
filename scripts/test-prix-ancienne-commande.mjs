// Prix de l'article baissé (Powerbank 50 000 → 45 000) : une commande prise avant garde 50 000 même si on la modifie ; une nouvelle commande prend 45 000.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Indian/Antananarivo', deviceScaleFactor: Number(process.env.DPR || 1) })).newPage();
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter'); await p.waitForTimeout(600);
const later = p.getByRole('button', { name: 'Plus tard' }); if (await later.count()) { await later.click(); await p.waitForTimeout(300); }
await p.evaluate(async () => {
  const t = window.__tsena; const at = new Date(Date.now() - 864e5).toISOString();
  await t.save('categories', [{ id: 'pb', name: 'Powerbank' }]);
  await t.save('products', [{ id: 'a', code: 'PB', name: 'Powerbank 20000', categoryId: 'pb', priceRetail: 45000, active: true }]);
  await t.save('variants', [{ id: 'va', productId: 'a', sku: 'PB', costAvg: 30000, active: true }]);
  await t.save('stockMoves', [{ variantId: 'va', qty: 20, type: 'initial', at }]);
  await t.save('couriers', [{ id: 'k1', name: 'Patrick', active: true, zoneIds: ['zone-centre'] }]);
  await t.save('orders', [{ id: 'O1', number: 'C-P0010', kind: 'order', channel: 'facebook', phone: '0341111111', name: 'Client hier', status: 'confirmed', zoneId: 'zone-centre', place: 'Analakely', courierId: 'k1', deliveryFee: 3000,
    lines: [{ id: 'l1', variantId: 'va', qty: 2, unitPrice: 50000 }], payments: [], discount: 0, createdAt: at, statusDates: { confirmed: at } }]);
});
await p.goto('http://localhost:5173/#/commandes/O1'); await p.waitForTimeout(700);
await p.getByRole('button', { name: 'Modifier', exact: true }).click(); await p.waitForTimeout(400);
const dlg = p.getByRole('dialog');
const foot = (await dlg.innerText()).replace(/[\u00a0\u202f]/g, ' ');
ok(/Total à payer\s*103 000 Ar/.test(foot), 'formulaire : total 103 000 (2 × 50 000, ancien prix gardé)');
if (process.env.SHOT) await dlg.screenshot({ path: process.env.SHOT });
await dlg.getByLabel('Observations').fill('client rappelé'); await dlg.getByRole('button', { name: 'Enregistrer', exact: true }).click(); await p.waitForTimeout(700);
const o = await p.evaluate(() => window.__tsena.get('orders', 'O1')); const l = o.lines[0];
ok(o.notes === 'client rappelé' && l.unitPrice === 50000 && l.keptPrice === undefined, `enregistré : 50 000 / ligne, rien de plus stocké (${JSON.stringify(l)})`);
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); await b.close(); process.exit(fail ? 1 : 0);
