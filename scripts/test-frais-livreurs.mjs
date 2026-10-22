// Récapitulatifs → Synthèse de la journée → Livreurs : par livreur, nombre de livraisons, total des frais, frais en espèces
// (gardés par le livreur) et frais par MVola (payés à la boutique, l'entreprise les paie au livreur), et total général.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Indian/Antananarivo' })).newPage();
const N = (t) => t.replace(/[  ]/g, ' ');
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
await p.evaluate(async () => { const t = window.__tsena;
  const d = new Date(); const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const at = `${day}T09:00:00+03:00`, back = `${day}T16:00:00+03:00`;
  await t.save('categories', [{ id: 'ind', name: 'Induction' }]);
  await t.save('products', [{ id: 'a', code: 'A', name: 'Plaque', categoryId: 'ind', priceRetail: 95000, active: true }]);
  await t.save('variants', [{ id: 'va', productId: 'a', sku: 'A', costAvg: 50000, active: true }]);
  await t.save('couriers', [{ id: 'c1', name: 'Andry', active: true }, { id: 'c2', name: 'Solo', active: true }]);
  const o = (id, courierId, fee, payments, status = 'delivered') => ({ id, number: id, kind: 'order', channel: 'online', phone: '0340000000', status, courierId, zoneId: 'z1',
    lines: [{ id: 'l' + id, variantId: 'va', qty: 1, unitPrice: 95000, qtyKept: 1 }], deliveryFee: fee, feeCharged: fee, payments, discount: 0, createdAt: at, dispatchedAt: at, returnedAt: back });
  await t.save('orders', [
    // Andry : le client lui paie 99 000 en espèces (95 000 + 4 000 de frais, gardés)
    o('d1', 'c1', 4000, [{ id: 'p1', at: back, amount: 99000, method: 'cash', receivedBy: 'courier', courierId: 'c1' }]),
    // Andry : le client a tout payé par MVola à la boutique (95 000 + 5 000) : l'entreprise paie les 5 000 de frais au livreur
    o('d2', 'c1', 5000, [{ id: 'p2', at, amount: 100000, method: 'mvola', receivedBy: 'shop' }]),
    // Solo : 98 000 en espèces au livreur (3 000 de frais gardés)
    o('d3', 'c2', 3000, [{ id: 'p3', at: back, amount: 98000, method: 'cash', receivedBy: 'courier', courierId: 'c2' }]),
    // Annulée : pas de frais
    o('d4', 'c2', 4000, [], 'cancelled'),
  ]);
});
await p.goto('http://localhost:5173/#/recapitulatif'); await p.waitForTimeout(900);
const tx = N(await p.locator('main').innerText());
if (process.env.DBG) console.log(tx);
const check = (tx, where) => {
  ok(/Livreur\s+Colis\s+Total commandes\s+emportées, sans frais\s+Total frais\s+Frais en espèces\s+gardés par le livreur\s+Frais MVola \/ Orange Money\s+payés par la caisse\s+Retours/i.test(tx), `${where} : colonnes livreur, colis, total commandes, total frais, espèces, MVola / Orange Money, retours`);
  ok(/Andry\s+2\s+190 000 Ar\s+9 000 Ar\s+4 000 Ar\s+5 000 Ar\s+0/i.test(tx), `${where} : Andry 2 colis, 190 000 de commandes, 9 000 de frais = 4 000 espèces + 5 000 MVola`);
  ok(/Solo\s+2\s+190 000 Ar\s+3 000 Ar\s+3 000 Ar\s+0 Ar\s+1/i.test(tx), `${where} : Solo 2 colis emportés (dont 1 annulé : 1 retour), 3 000 de frais en espèces`);
  ok(/TOTAL\s+4\s+380 000 Ar\s+12 000 Ar\s+7 000 Ar\s+5 000 Ar\s+1/.test(tx), `${where} : ligne TOTAL 4 colis, 380 000, 12 000 = 7 000 + 5 000, 1 retour`);
};
check(tx, 'Récapitulatifs');
await p.goto('http://localhost:5173/#/livraisons/recap'); await p.waitForTimeout(900);
const tx2 = N(await p.locator('main').innerText());
ok(/Zones et frais\s+Récap livraison/.test(tx2) && tx2.includes('Récap livraison'), 'onglet « Récap livraison » après « Zones et frais »');
check(tx2, 'Livraisons → Récap livraison');
await p.locator('.fee-board').screenshot({ path: process.env.SHOT || '/tmp/fee-board.png' });
await b.close(); process.exit(fail ? 1 : 0);
