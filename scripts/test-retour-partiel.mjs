// Accueil : commande de 2 articles, le client en garde 1 et rend 1 au livreur. Le retour va dans « Annulé » :
// total commandes 190 000 − annulé 95 000 = ventes 95 000. Un refus complet va aussi en entier dans « Annulé ».
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Indian/Antananarivo' })).newPage();
const N = (t) => t.replace(/[  ]/g, ' ');
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
const seed = async (orders) => p.evaluate(async (os) => { const t = window.__tsena;
  const d = new Date(); const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  await t.save('categories', [{ id: 'ind', name: 'Induction' }]);
  await t.save('products', [{ id: 'a', code: 'A', name: 'Plaque', categoryId: 'ind', priceRetail: 95000, active: true }]);
  await t.save('variants', [{ id: 'va', productId: 'a', sku: 'A', costAvg: 50000, active: true }]);
  await t.save('couriers', [{ id: 'c1', name: 'Andry', active: true }]);
  const at = `${day}T09:00:00+03:00`, back = `${day}T16:00:00+03:00`;
  await t.save('orders', os.map((o) => ({ kind: 'order', channel: 'online', phone: '0340000000', courierId: 'c1', zoneId: 'z1', discount: 0, deliveryFee: 4000, feeCharged: 4000, createdAt: at, dispatchedAt: at, returnedAt: back, number: o.id, ...o,
    payments: o.paid ? [{ id: 'p' + o.id, at: back, amount: o.paid, method: 'cash', receivedBy: 'courier', courierId: 'c1' }] : [] })));
}, orders);
const read = async () => { await p.goto('http://localhost:5173/#/'); await p.waitForTimeout(900); return N(await p.locator('main').innerText()); };
// Le client garde 1 plaque sur 2 et paie 95 000 + 4 000 de frais
await seed([{ id: 'r1', status: 'partial', lines: [{ id: 'l1', variantId: 'va', qty: 2, unitPrice: 95000, qtyKept: 1, qtyReturned: 1 }], paid: 99000 }]);
let tx = await read();
if (process.env.DBG) console.log(tx.slice(0, 1200));
ok(/Total commandes\s+190 000 Ar/.test(tx), 'total commandes 190 000 (2 articles commandés)');
ok(/− Annulé\s+95 000 Ar\s+1 commande\(s\)/.test(tx), 'annulé 95 000 : l’article rendu au livreur');
ok(/= Ventes\s+95 000 Ar/.test(tx), 'ventes 95 000 : l’article gardé');
// Refus complet : tout va dans « Annulé »
await seed([{ id: 'r2', status: 'refused', lines: [{ id: 'l2', variantId: 'va', qty: 1, unitPrice: 95000, qtyKept: 0, qtyReturned: 1 }], paid: 0 }]);
tx = await read();
ok(/Total commandes\s+285 000 Ar/.test(tx), 'avec un refus de 95 000 : total commandes 285 000');
ok(/− Annulé\s+190 000 Ar\s+2 commande\(s\)/.test(tx), 'annulé 190 000 : retour partiel + refus');
ok(/= Ventes\s+95 000 Ar/.test(tx), 'ventes toujours 95 000');
await b.close(); process.exit(fail ? 1 : 0);
