// Versements : vue PAR PAGE (par défaut) ; espèces du jour / 1er / 2ème paiement espèces (frais gardés par les livreurs
// déjà retirés), frais livreurs payés en MVola / Orange Money ; ✓ ou correction directe dans la case « Espèces du jour »,
// écart affiché dessous et impayé vendeur à réclamer ; vue par vendeur disponible.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const W = Number(process.argv[2] || 1280);
const p = await (await b.newContext({ viewport: { width: W, height: 900 }, timezoneId: 'Indian/Antananarivo', acceptDownloads: true })).newPage();
const N = (t) => t.replace(/[\u00a0\u202f]/g, ' ');
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
const roles = await p.evaluate(() => ({ seller: window.__tsena.get('roles', 'role-seller'), manager: window.__tsena.get('roles', 'role-manager') }));
ok(roles.manager?.name === 'Responsable' && roles.manager.permissions.includes('orders.dispatch') && roles.manager.permissions.includes('handover.receive'), 'rôle Responsable : assigne les livreurs et reçoit les versements');
ok(!roles.seller.permissions.includes('orders.dispatch') && roles.seller.permissions.includes('handover.self'), 'rôle Vendeur : ne remet pas les colis au livreur (le responsable le fait), voit sa feuille');
await p.evaluate(async () => {
  const t = window.__tsena; const now = new Date().toISOString(); const ago = (n) => new Date(Date.now() - n * 864e5).toISOString(); const hash = t.get('users', 'user-superadmin').passwordHash;
  await t.save('categories', [{ id: 'pp', name: 'Poignet précieux' }, { id: 'is', name: 'Intimity style' }]);
  await t.save('products', [{ id: 'a', code: 'A', name: 'Montre', categoryId: 'pp', priceRetail: 15000, active: true }, { id: 'bx', code: 'B', name: 'Boxer', categoryId: 'is', priceRetail: 10000, active: true }]);
  await t.save('variants', [{ id: 'va', productId: 'a', sku: 'A', costAvg: 5000, active: true }, { id: 'vb', productId: 'bx', sku: 'B', costAvg: 4000, active: true }]);
  await t.save('stockMoves', [{ variantId: 'va', qty: 50, type: 'initial', at: now }, { variantId: 'vb', qty: 50, type: 'initial', at: now }]);
  await t.save('users', [
    { id: 'u1', username: 'aina', fullName: 'Aina', roleId: 'role-seller', active: true, passwordHash: hash, mustChangePassword: false, pageIds: ['pp'] },
    { id: 'u2', username: 'bako', fullName: 'Bako', roleId: 'role-seller', active: true, passwordHash: hash, mustChangePassword: false, pageIds: ['is'] },
    { id: 'u3', username: 'resp', fullName: 'Rindra', roleId: 'role-manager', active: true, passwordHash: hash, mustChangePassword: false },
  ]);
  await t.save('zones', { id: 'z1', name: 'Analakely', fee: 3000, active: true });
  await t.save('couriers', { id: 'c1', name: 'Faly', active: true });
  const shop = (id, by, name, v, q, price, method) => ({ id, number: id, kind: 'order', channel: 'shop', phone: '', status: 'delivered', lines: [{ id: 'l' + id, variantId: v, qty: q, unitPrice: price, qtyKept: q }], payments: [{ id: 'p' + id, at: now, amount: q * price, method, receivedBy: 'shop' }], discount: 0, deliveryFee: 0, createdBy: by, createdByName: name, createdAt: now });
  await t.save('orders', [
    shop('S1', 'u1', 'Aina', 'va', 2, 15000, 'cash'),
    shop('S2', 'u1', 'Aina', 'vb', 1, 10000, 'mvola'),
    { id: 'D1', number: 'D1', kind: 'order', channel: 'facebook', phone: '0340000000', zoneId: 'z1', courierId: 'c1', status: 'delivered', lines: [{ id: 'ld', variantId: 'va', qty: 1, unitPrice: 15000, qtyKept: 1, qtyReturned: 0 }], deliveryFee: 3000, feeCharged: 3000, discount: 0,
      payments: [{ id: 'pd', at: now, amount: 18000, method: 'cash', receivedBy: 'courier', courierId: 'c1' }], dispatchedAt: now, returnedAt: now, courierSettledAt: now, createdBy: 'u1', createdByName: 'Aina', createdAt: now },
    shop('S3', 'u2', 'Bako', 'vb', 2, 10000, 'cash'),
    // Vente d'il y a 3 jours sur Intimity style, payée 4 000 sur 10 000 : reste client 6 000
    // Vieux reste d'il y a 30 jours (réglé en vrai mais jamais cliqué) : caché par « Impayés affichés à partir du »
    { ...shop('R0', 'u2', 'Bako', 'vb', 1, 10000, 'cash'), createdAt: ago(30), payments: [] },
    // Vieux reste d'avant le 26/10 cliqué payé aujourd'hui (déjà réglé en vrai) : ne compte pas dans le versement
    { ...shop('W0', 'u1', 'Aina', 'va', 1, 15000, 'cash'), createdAt: ago(30), payments: [{ id: 'pw0', at: now, amount: 15000, method: 'cash', receivedBy: 'shop' }] },
    { ...shop('R1', 'u2', 'Bako', 'vb', 1, 10000, 'cash'), createdAt: ago(3), payments: [{ id: 'pr1', at: ago(3), amount: 4000, method: 'cash', receivedBy: 'shop' }] },
    // Livraison payée par MVola à la boutique, frais compris : la boutique doit les 3 000 de frais au livreur
    { id: 'D2', number: 'D2', kind: 'order', channel: 'facebook', phone: '0340000001', zoneId: 'z1', courierId: 'c1', status: 'delivered', lines: [{ id: 'ld2', variantId: 'va', qty: 1, unitPrice: 15000, qtyKept: 1, qtyReturned: 0 }], deliveryFee: 3000, feeCharged: 3000, discount: 0,
      payments: [{ id: 'pd2', at: now, amount: 18000, method: 'mvola', receivedBy: 'shop' }], dispatchedAt: now, returnedAt: now, courierSettledAt: now, createdBy: 'u1', createdByName: 'Aina', createdAt: now },
    // Restes des jours précédents payés en espèces aujourd'hui : hier → 1er paiement, il y a 3 jours → 2ème paiement
    { ...shop('Y1', 'u1', 'Aina', 'va', 1, 15000, 'cash'), createdAt: ago(1), payments: [{ id: 'py1', at: ago(1), amount: 5000, method: 'cash', receivedBy: 'shop' }, { id: 'py2', at: now, amount: 10000, method: 'cash', receivedBy: 'shop' }] },
    { ...shop('W1', 'u1', 'Aina', 'va', 1, 15000, 'cash'), createdAt: ago(3), payments: [{ id: 'pw1', at: now, amount: 15000, method: 'cash', receivedBy: 'shop' }] },
  ]);
  // Versement d'hier de la page Intimity style : 5 000 de moins que prévu → impayé vendeur à réclamer
  const y = new Date(Date.now() - 864e5); const yd = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
  await t.save('handovers', { id: `ho_page:is_${yd}`, userId: 'page:is', userName: 'Intimity style', date: yd, sales: 0, perPage: [], cash: 0, mvola: 0, orange: 0, airtel: 0, fees: 0, expenses: 0, expected: 25000, amount: 20000, gap: -5000, at: ago(1), status: 'received', repaid: 0, repayments: [] });
  await t.save('cashMoves', { at: now, account: 'cash', amount: -2000, type: 'expense', label: 'Taxi', userName: 'Aina' });
});
await p.goto('http://localhost:5173/#/versements'); await p.waitForTimeout(800);
let tx = N(await p.locator('main').innerText());
ok(/Par page/.test(tx) && /Page par page/i.test(tx), 'vue « Par page » affichée par défaut');
const row = (name) => p.locator('.handover-table tbody tr', { hasText: name });
let rA = N(await row('Poignet précieux').innerText()).replace(/\s+/g, ' ');
ok(/Poignet précieux Aina 60 000 Ar 45 000 Ar à recevoir 10 000 Ar 15 000 Ar 18 000 Ar — — 3 000 Ar 70 000 Ar/.test(rA), `Poignet précieux : ventes 60 000, espèces du jour 45 000 (48 000 − 3 000 de frais gardés), 1er 10 000, 2ème 15 000, MVola 18 000, frais MVola 3 000, à payer 70 000 (${rA})`);
let rB = N(await row('Intimity style').innerText()).replace(/\s+/g, ' ');
ok(/Intimity style Aina, Bako impayé précédent 5 000 Ar 30 000 Ar 20 000 Ar à recevoir — — 10 000 Ar — — — 20 000 Ar/.test(rB), `Intimity style : ventes 30 000, espèces 20 000, MVola 10 000, à payer 20 000 (${rB})`);
ok(/Total\s+90 000 Ar\s+65 000 Ar\s+10 000 Ar\s+15 000 Ar\s+28 000 Ar\s+0 Ar\s+0 Ar\s+3 000 Ar\s+90 000 Ar/.test(tx), 'ligne Total : espèces 65 000 + 10 000 + 15 000 = 90 000 à payer, frais MVola 3 000');
ok(!/Espèces du jour reçues/.test(tx) && !/− 3 000 Ar/.test(N(await p.locator('.handover-table').innerText())), 'plus de colonne séparée ni de frais espèces déduits');
// En haut : restes impayés par page
const rests = () => p.locator('.card', { hasText: 'Restes impayés par page' });
let rs = N(await rests().innerText()).replace(/\s+/g, ' ');
ok(/Restes impayés par page .* 11 000 Ar/.test(rs) && /Intimity style 6 000 Ar 5 000 Ar 11 000 Ar/.test(rs) && !rs.includes('Poignet'), `en haut : Intimity style reste client 6 000 + impayé vendeur 5 000 = 11 000 (${rs})`);
await rests().locator('tr', { hasText: 'Intimity style' }).first().click(); await p.waitForTimeout(200);
rs = N(await rests().innerText()).replace(/\s+/g, ' ');
ok(/Le .{3,6} \d\d\/\d\d · clients 6 000 Ar \(R1\) 6 000 Ar/.test(rs) && /Le .{3,6} \d\d\/\d\d · impayé vendeur 5 000 Ar 5 000 Ar/.test(rs), `détail Intimity style jour par jour : client R1 6 000, impayé vendeur 5 000 (${rs})`);
await rests().locator('tr', { hasText: 'Intimity style' }).first().click(); await p.waitForTimeout(200);
ok(!/\(R1\)/.test(await rests().innerText()), 'le détail se referme');
// Date de début d'affichage des impayés : par défaut le 26/10/2026, le vieux reste R0 est caché
const since = rests().getByLabel('Impayés affichés à partir du');
ok(await since.inputValue() === '2026-10-26' && !rs.includes('R0') && !rs.includes('16 000'), 'vieux reste d’il y a 30 jours caché (affichage à partir du 26/10/2026)');
const d40 = new Date(Date.now() - 40 * 864e5); await since.fill(`${d40.getFullYear()}-${String(d40.getMonth() + 1).padStart(2, '0')}-${String(d40.getDate()).padStart(2, '0')}`); await p.waitForTimeout(400);
rs = N(await rests().innerText()).replace(/\s+/g, ' ');
ok(/Intimity style 16 000 Ar 5 000 Ar 21 000 Ar/.test(rs), `date plus ancienne : le vieux reste 10 000 réapparaît (${rs})`);
await since.fill('2026-10-26'); await p.waitForTimeout(400);
ok(/Intimity style 6 000 Ar 5 000 Ar 11 000 Ar/.test(N(await rests().innerText()).replace(/\s+/g, ' ')), 'retour au 26/10 : vieux reste de nouveau caché');
const firstCard = await p.locator('main .card').nth(1).innerText();
ok(firstCard.includes('Restes impayés par page'), 'tableau des restes impayés juste sous la date');
// Argent réellement reçu ce jour (saisi à la main) comparé au calcul
const mc = () => p.locator('.card', { hasText: 'Argent réellement reçu ce jour' });
await mc().getByLabel('Espèces réellement reçu').fill('85000'); await mc().getByLabel('Espèces réellement reçu').press('Enter'); await p.waitForTimeout(400);
await mc().getByLabel('MVola réellement reçu').fill('28000'); await mc().getByLabel('MVola réellement reçu').press('Enter'); await p.waitForTimeout(400);
let mt = N(await mc().innerText()).replace(/\s+/g, ' ');
ok(/Espèces total à payer des vendeurs 90 000 Ar − 5 000 Ar/.test(mt) && /MVola 25 000 Ar \+ 3 000 Ar/.test(mt) && /Orange Money 0 Ar —/.test(mt), `argent reçu : espèces 85 000 → écart − 5 000 ; MVola ventes 25 000, reçu 28 000 → écart + 3 000 ; Orange pas saisi (${mt})`);
ok(/Total frais MVola \/ Orange Money \(livreurs\) .* MVola 3 000 Ar · Orange 0 Ar 3 000 Ar Différence/.test(mt) && /Différence : écart MVola \+ écart Orange − total frais 0 = tout est juste \(reste éventuel : frais de retrait…\) écart MVola \+ 3 000 Ar − frais 3 000 Ar ✓ juste/.test(mt), `écart MVola + 3 000 − frais livreurs 3 000 = 0, juste (${mt})`);
const rec = await p.evaluate(() => window.__tsena.all('moneyCounts')[0]);
ok(rec && rec.cash === 85000 && rec.mvola === 28000 && rec.orange == null, 'montants enregistrés pour le jour');
ok(N(await p.locator('main').innerText()).includes('90 000 Ar'), 'le total à payer ne change pas');
// La semaine : jour par jour + total
const wk = p.locator('.card', { hasText: 'Argent réellement reçu : la semaine' });
const lastRow = N(await wk.locator('tbody tr').last().innerText()).replace(/\s+/g, ' ');
ok(/90 000 Ar 85 000 Ar − 5 000 Ar 25 000 Ar 28 000 Ar 0 Ar — 3 000 Ar ✓ juste$/.test(lastRow), `semaine, aujourd’hui : espèces 85 000 → écart − 5 000 ; MVola 28 000 (calcul 25 000) + 3 000 − frais 3 000 = juste (${lastRow})`);
const wt = N(await wk.locator('tfoot').innerText()).replace(/\s+/g, ' ');
ok(/Total semaine .* 85 000 Ar − 5 000 Ar 25 000 Ar 28 000 Ar 0 Ar 0 Ar 3 000 Ar ✓ juste/.test(wt), `total de la semaine (${wt})`);
const nDays = await wk.locator('tbody tr').count(); const wd = new Date().getDay();
ok(nDays === ((wd + 6) % 7) + 1, `du lundi à aujourd’hui : ${nDays} jour(s)`);
await wk.getByRole('button', { name: 'Semaine précédente' }).click(); await p.waitForTimeout(300);
ok((await wk.locator('tbody tr').count()) === 7 && /Total semaine 99 000 Ar|Total semaine/.test(N(await wk.innerText())) && !(N(await wk.locator('tfoot').innerText()).includes('85 000')), 'semaine précédente : 7 jours, sans les montants de cette semaine');
await wk.getByRole('button', { name: 'Cette semaine' }).click(); await p.waitForTimeout(300);
ok((await wk.locator('tbody tr').count()) === nDays && N(await wk.locator('tfoot').innerText()).includes('85 000'), 'retour à cette semaine');
// Correction directe dans la case « Espèces du jour »
await row('Poignet précieux').getByRole('button', { name: /Corriger les espèces du jour/ }).click();
await row('Poignet précieux').getByLabel(/Espèces du jour reçues de/).fill('15000');
await row('Poignet précieux').getByLabel(/Espèces du jour reçues de/).press('Enter'); await p.waitForTimeout(500);
let hs = await p.evaluate(() => window.__tsena.all('handovers').filter((h) => h.userId === 'page:pp'));
ok(hs.length === 1 && hs[0].amount === 40000 && hs[0].expected === 70000 && hs[0].gap === -30000 && hs[0].userName === 'Poignet précieux', 'Poignet précieux : 15 000 d’espèces du jour → versement 15 000 + 10 000 + 15 000 = 40 000, écart −30 000');
rA = N(await row('Poignet précieux').innerText()).replace(/\s+/g, ' ');
ok(/Poignet précieux Aina 60 000 Ar 15 000 Ar reçu calculé 45 000 Ar écart − 30 000 Ar 10 000 Ar 15 000 Ar/.test(rA), `la case affiche 15 000, avec calculé 45 000 et l’écart dessous (${rA})`);
rs = N(await rests().innerText()).replace(/\s+/g, ' ');
ok(/Poignet précieux — 30 000 Ar 30 000 Ar/.test(rs) && /41 000 Ar/.test(rs), `en haut : Poignet précieux impayé vendeur 30 000, total 41 000 (${rs})`);
// L'écart devient un impayé vendeur à réclamer
const gaps = () => p.locator('.card', { hasText: 'Impayés vendeurs (écarts à réclamer)' });
let g = N(await gaps().innerText()).replace(/\s+/g, ' ');
ok(/Impayés vendeurs \(écarts à réclamer\) 35 000 Ar/i.test(g) && /Intimity style · page 5 000 Ar — 5 000 Ar/.test(g) && /Poignet précieux · page 30 000 Ar — 30 000 Ar/.test(g), `impayés vendeurs : hier Intimity 5 000 + aujourd’hui Poignet 30 000 = 35 000 (${g})`);
// Remboursement partiel de l'impayé d'hier
await gaps().locator('tr', { hasText: 'Intimity style' }).getByRole('button', { name: 'Régler' }).click();
await gaps().getByLabel(/Remboursé par Intimity style/).fill('2000');
await gaps().getByLabel(/Remboursé par Intimity style/).press('Enter'); await p.waitForTimeout(500);
g = N(await gaps().innerText()).replace(/\s+/g, ' ');
ok(/Intimity style · page 5 000 Ar 2 000 Ar 3 000 Ar/.test(g) && /33 000 Ar/.test(g), `remboursement partiel : reste 3 000 (${g})`);
ok(N(await row('Intimity style').innerText()).includes('impayé précédent 3 000 Ar'), 'tableau : impayé précédent 3 000');
await gaps().locator('tr', { hasText: 'Intimity style' }).getByRole('button', { name: 'Régler' }).click();
await gaps().getByLabel(/Remboursé par Intimity style/).press('Enter'); await p.waitForTimeout(500);
ok(!(await row('Intimity style').innerText()).includes('impayé précédent'), 'remboursé en entier : plus d’impayé précédent');
// Correction du montant déjà validé
await row('Poignet précieux').getByRole('button', { name: /Corriger les espèces du jour/ }).click();
await row('Poignet précieux').getByLabel(/Espèces du jour reçues de/).fill('45000');
await row('Poignet précieux').getByRole('button', { name: 'Valider le montant reçu' }).click(); await p.waitForTimeout(500);
hs = await p.evaluate(() => window.__tsena.all('handovers').filter((h) => h.userId === 'page:pp'));
ok(hs.length === 1 && hs[0].status === 'received' && hs[0].amount === 70000 && hs[0].gap === 0, 'correction : 45 000 → versement 70 000, plus d’écart');
rA = N(await row('Poignet précieux').innerText()).replace(/\s+/g, ' ');
ok(/Poignet précieux Aina 60 000 Ar 45 000 Ar reçu 10 000 Ar/.test(rA) && !rA.includes('calculé') && !rA.includes('écart'), `espèces du jour revenues au calcul (${rA})`);
ok(/Aucun écart à réclamer/.test(await gaps().innerText()), 'plus d’écart : plus rien à réclamer');
const au = await p.evaluate(() => window.__tsena.all('audit').filter((a) => /Versement vendeur/.test(a.action)).map((a) => a.action));
ok(au.includes('Versement vendeur annulé') && au.filter((a) => a === 'Versement vendeur reçu').length === 2, 'ancien montant tracé dans le journal');
// Vue par vendeur
await p.getByRole('button', { name: 'Par vendeur' }).click(); await p.waitForTimeout(300);
tx = N(await p.locator('main').innerText());
const rowS = N(await p.locator('tr.row-link', { hasText: 'Aina' }).innerText()).replace(/\s+/g, ' ');
ok(/Aina Poignet précieux, Intimity style 70 000 Ar 45 000 Ar à recevoir 10 000 Ar 15 000 Ar 28 000 Ar — — 3 000 Ar 2 000 Ar 70 000 Ar/.test(rowS), `vue par vendeur : Aina 70 000 ventes, espèces 45 000 + 10 000 + 15 000 = 70 000 à payer (${rowS})`);
// ✓ : reçu comme calculé
await p.locator('tr.row-link', { hasText: 'Bako' }).getByRole('button', { name: /Reçu comme calculé/ }).click(); await p.waitForTimeout(500);
ok(!(await p.getByRole('dialog').count()), 'valider dans le tableau n’ouvre pas la fiche');
hs = await p.evaluate(() => window.__tsena.all('handovers').filter((h) => h.userId === 'u2'));
ok(hs.length === 1 && hs[0].amount === 20000 && hs[0].gap === 0, 'vendeur Bako : ✓ = 20 000 reçu comme calculé');
await p.getByRole('button', { name: 'Par page' }).click(); await p.waitForTimeout(300);
// Calcul comme dans Excel dans la case Orange Money
await mc().getByLabel('Orange Money réellement reçu').fill('=2000+1500'); await mc().getByLabel('Orange Money réellement reçu').press('Enter'); await p.waitForTimeout(400);
const rec2 = await p.evaluate(() => window.__tsena.all('moneyCounts')[0]);
ok(rec2.orange === 3500 && rec2.formulas?.orange === '=2000+1500' && rec2.mvola === 28000, 'calcul « =2000+1500 » → Orange Money 3 500, calcul gardé');
mt = N(await mc().innerText()).replace(/\s+/g, ' ');
ok(/Orange Money 0 Ar = 3 500 Ar \+ 3 500 Ar/.test(mt) && (await mc().getByLabel('Orange Money réellement reçu').inputValue()) === '=2000+1500', `la case garde le calcul et affiche le résultat (${mt})`);
await mc().getByLabel('Orange Money réellement reçu').fill('=2000+'); await mc().getByLabel('Orange Money réellement reçu').press('Enter'); await p.waitForTimeout(400);
ok((await p.evaluate(() => window.__tsena.all('moneyCounts')[0])).orange === 3500, 'calcul invalide refusé');
const sw = await p.evaluate(() => document.documentElement.scrollWidth); ok(sw <= W + 1, `pas de débordement (${sw})`);
await p.waitForTimeout(4500); await p.locator('.card', { hasText: 'Page par page' }).screenshot({ path: process.env.SHOT || '/tmp/versements-page.png' });
console.log(fail ? `${fail} ÉCHEC(S)` : 'TOUT EST BON'); await b.close(); process.exit(fail ? 1 : 0);
