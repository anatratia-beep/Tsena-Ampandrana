// Dépenses espèces du lundi (sauf frais de livraison) : comptées dans la semaine précédente (clôturée le samedi,
// versée au patron le mardi). MVola / Orange et frais de livraison restent le lundi.
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
}, o('s1', '2026-08-05', 30000, [['2026-08-05', 30000]]));
await p.evaluate(async () => { const t = window.__tsena; const e = (id, at, account, amount, label) => ({ id, at, account, amount: -amount, type: 'expense', label, userName: 'Super Admin' });
  await t.save('cashMoves', [
    e('e1', '2026-08-10T08:00:00+03:00', 'cash', 5000, 'Taxi'),
    e('e2', '2026-08-10T09:00:00+03:00', 'cash', 2000, 'Frais de livraison'),
    e('e3', '2026-08-10T09:30:00+03:00', 'mvola', 1000, 'Crédit'),
    e('e4', '2026-08-11T10:00:00+03:00', 'cash', 1500, 'Eau'),
    e('e5', '2026-08-03T10:00:00+03:00', 'cash', 700, 'Sachets'),
  ]); });
const read = async (a) => { await p.goto(`http://localhost:5173/#/rapports/patron?p=week&a=${a}`); await p.reload(); await p.waitForTimeout(1000); return N(await p.locator('main').innerText()); };
let tx = await read('2026-08-05');
ok(/30 000 Ar − dépenses 5 000 Ar/.test(tx), 'semaine du 03/08 : dépense espèces du lundi 10/08 (Taxi 5 000) comptée, celle du lundi 03/08 (700) passée à la semaine d’avant');
tx = await read('2026-08-12');
ok(/− dépenses 3 500 Ar/.test(tx), 'semaine du 10/08 : frais de livraison du lundi (2 000) + dépense du mardi (1 500) = 3 500');
ok(/MVola − dépenses MVola\s*[−-]?\s*1 000 Ar/.test(tx), 'dépense MVola du lundi reste dans sa semaine');
tx = await read('2026-07-29');
ok(/− dépenses 700 Ar/.test(tx), 'semaine du 27/07 : dépense espèces du lundi 03/08 (700)');
// Tableau de la semaine et versement au patron (Récapitulatifs → Semaine)
await p.goto('http://localhost:5173/#/recapitulatif'); await p.waitForTimeout(600);
await p.getByRole('button', { name: /Semaine/ }).first().click(); await p.waitForTimeout(300);
for (let i = 0; i < 30; i++) { const t = N(await p.locator('main').innerText()); if (/Du 03\/08\/2026/.test(t)) break; await p.getByRole('button', { name: 'Précédent' }).click(); await p.waitForTimeout(150); }
tx = N(await p.locator('main').innerText());
ok(/Total des dépenses \(1\)\s*−\s*5 000 Ar/.test(tx) && /Montant à verser\s*25 000 Ar/.test(tx), 'versement de la semaine du 03/08 : 30 000 − 5 000 = 25 000');
ok(/lun\. 10\/08/i.test(tx) && /lun\. 10\/08[\s\S]*dépenses espèces avant le versement du mardi/.test(tx), 'ligne « Lun. 10/08 » ajoutée sous le samedi dans le tableau de la semaine');
await b.close(); process.exit(fail ? 1 : 0);
