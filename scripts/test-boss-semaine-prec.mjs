// « À verser au patron » : les 1er / 2ème paiements des ventes de la semaine précédente (2ème paiement du vendredi,
// 1er et 2ème paiements du samedi) ne vont pas dans « Total à verser » (bleu) mais dans « Impayé précédent à verser » (jaune).
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Indian/Antananarivo' })).newPage();
const N = (t) => t.replace(/[  ]/g, ' ');
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
const o = (id, day, price, pays) => ({ id, number: id, kind: 'order', channel: 'shop', phone: '', status: 'delivered', lines: [{ id: 'l' + id, variantId: 'va', qty: 1, unitPrice: price, qtyKept: 1 }],
  payments: pays.map(([d, a], i) => ({ id: `p${id}${i}`, at: `${d}T10:00:00+03:00`, amount: a, method: 'cash', receivedBy: 'shop' })), discount: 0, deliveryFee: 0, createdAt: `${day}T09:00:00+03:00` });
await p.evaluate(async (s1) => { const t = window.__tsena;
  await t.save('categories', [{ id: 'pp', name: 'Poignet précieux' }]);
  await t.save('products', [{ id: 'a', code: 'A', name: 'Montre', categoryId: 'pp', priceRetail: 15000, active: true }]);
  await t.save('variants', [{ id: 'va', productId: 'a', sku: 'A', costAvg: 5000, active: true }]);
  await t.save('stockMoves', [{ variantId: 'va', qty: 100, type: 'initial', at: '2026-07-20T08:00:00+03:00' }]);
  await t.save('orders', [s1]);
}, o('s1', '2026-08-05', 30000, [['2026-08-05', 20000], ['2026-08-06', 4000], ['2026-08-07', 6000]]));
const read = async () => { await p.goto('http://localhost:5173/#/rapports/patron?p=week&a=2026-08-05'); await p.waitForTimeout(800); return N(await p.locator('main').innerText()); };
let tx = await read();
ok(/Total à verser\s*30 000 Ar/.test(tx), 'semaine du 03/08 : 20 000 jour de la vente + 4 000 1er + 6 000 2ème paiement espèces = 30 000');
// Vendredi 31/07 : 10 000, 2 000 le jour, 3 000 samedi (1er), 5 000 le mercredi 05/08 (2ème paiement du vendredi).
// Samedi 01/08 : 12 000, 4 000 le lundi 03/08 (1er paiement du samedi) et 3 000 le mardi 04/08 (2ème paiement du samedi).
await p.evaluate(async (os) => { await window.__tsena.save('orders', os); }, [o('s2', '2026-07-31', 10000, [['2026-07-31', 2000], ['2026-08-01', 3000], ['2026-08-05', 5000]]), o('s3', '2026-08-01', 12000, [['2026-08-03', 4000], ['2026-08-04', 3000]])]);
tx = await read();
ok(/Total à verser\s*30 000 Ar/.test(tx), 'Total à verser (bleu) ne bouge pas : les paiements des ventes du vendredi / samedi précédents n’y entrent pas');
ok(/Impayé précédent à verser\s*12 000 Ar/.test(tx), 'Impayé précédent à verser (jaune) = 5 000 + 4 000 + 3 000 = 12 000');
ok(/Reste impayé semaine précédente\s*17 000 Ar/.test(tx), 'Reste impayé semaine précédente (rose) figé : 5 000 + 12 000 = 17 000, les paiements ne le baissent pas');
await b.close(); process.exit(fail ? 1 : 0);
