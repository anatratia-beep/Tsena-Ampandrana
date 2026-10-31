// Récap livraison : la colonne « Frais MVola / Orange Money » ne compte que les frais vraiment reçus sur les téléphones ;
// les autres frais dus au livreur (payés en espèces au magasin, refus) sont à part, et le détail par commande s’ouvre au clic.
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
    // Andry : articles et frais payés en espèces au magasin (avant livraison) : frais dus au livreur, mais pas par MVola
    o('d5', 'c1', 3000, [{ id: 'p5', at, amount: 98000, method: 'cash', receivedBy: 'shop' }]),
    // Andry : refusé, le client n'a rien payé mais les frais sont comptés au livreur
    { ...o('d6', 'c1', 2000, [], 'refused'), lines: [{ id: 'ld6', variantId: 'va', qty: 1, unitPrice: 95000, qtyKept: 0, qtyReturned: 1 }] },
  ]);
});
await p.goto('http://localhost:5173/#/livraisons/recap'); await p.waitForTimeout(900);
let tx = N(await p.locator('.fee-board').innerText());
if (process.env.DBG) console.log(tx);
ok(/Autres frais dus\s+espèces au magasin, refus \/ retour/i.test(tx), 'colonne « Autres frais dus » quand il y en a');
ok(/Andry\s+4\s+380 000 Ar\s+14 000 Ar\s+4 000 Ar\s+5 000 Ar\s+5 000 Ar\s+1/i.test(tx), `Andry : 14 000 de frais = 4 000 espèces + 5 000 MVola (d2 seulement) + 5 000 autres (d5 espèces magasin 3 000 + d6 refus 2 000) (${tx})`);
ok(/TOTAL\s+6\s+570 000 Ar\s+17 000 Ar\s+7 000 Ar\s+5 000 Ar\s+5 000 Ar\s+2/.test(tx), 'TOTAL : MVola 5 000 seulement, autres 5 000');
await p.locator('.fee-board tr', { hasText: 'Andry' }).first().click(); await p.waitForTimeout(300);
tx = N(await p.locator('.fee-board').innerText()).replace(/\s+/g, ' ');
ok(/d2 · payés par MVola \/ Orange Money MVola \/ Orange 5 000 Ar/.test(tx) && /d5 · payés en espèces au magasin autres 3 000 Ar/.test(tx) && /d6 · client n’a pas payé les frais \(refus \/ retour\) autres 2 000 Ar/.test(tx), `détail Andry par commande (${tx})`);
await p.waitForTimeout(1500); await p.locator('.fee-board').screenshot({ path: process.env.SHOT || '/tmp/fee-board-autres.png' });
console.log(fail ? `${fail} ÉCHEC(S)` : 'TOUT EST BON'); await b.close(); process.exit(fail ? 1 : 0);
