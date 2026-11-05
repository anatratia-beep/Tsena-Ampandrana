// Versements : « Suivi des restes par page » — par page et par jour de vente : reste du jour → 1er paiement →
// 2ème paiement → annulé → reste encore dû (une vente annulée avec un reste n'est plus perdue de vue).
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Indian/Antananarivo', deviceScaleFactor: Number(process.env.DPR || 1) })).newPage();
const N = (t) => t.replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
const days = await p.evaluate(async () => {
  const t = window.__tsena; const pad = (n) => String(n).padStart(2, '0');
  // jours de travail (pas dimanche) : d0 = vente, d1 = jour suivant (1er paiement)
  const at = (d, h = 10) => { const x = new Date(d); x.setHours(h, 0, 0, 0); return x.toISOString(); };
  const back = (n) => { const x = new Date(); x.setDate(x.getDate() - n); return x; };
  let k = 2; while (back(k).getDay() === 0 || back(k - 1).getDay() === 0) k++;
  const d0 = back(k), d1 = back(k - 1); const day = (x) => `${pad(x.getDate())}/${pad(x.getMonth() + 1)}/${String(x.getFullYear()).slice(2)}`;
  await t.save('categories', [{ id: 'nv', name: 'Netvision' }, { id: 'pp', name: 'Poignet précieux' }]);
  await t.save('products', [{ id: 'a', code: 'A', name: 'Casque', categoryId: 'nv', priceRetail: 10000, active: true }, { id: 'b', code: 'B', name: 'Montre', categoryId: 'pp', priceRetail: 10000, active: true }]);
  await t.save('variants', [{ id: 'va', productId: 'a', sku: 'A', costAvg: 5000, active: true }, { id: 'vb', productId: 'b', sku: 'B', costAvg: 5000, active: true }]);
  const o = (id, v, amount, d, x) => ({ id, number: id, kind: 'order', channel: 'facebook', phone: '0340000000', name: 'Client ' + id, status: 'delivered', lines: [{ id: 'l' + id, variantId: v, qty: 1, unitPrice: amount }], payments: [], discount: 0, deliveryFee: 0, createdAt: at(d, 8), dispatchedAt: at(d), ...x });
  await t.save('orders', [
    o('N1', 'va', 90000, d0, { payments: [{ id: 'p1', at: at(d1), amount: 40000, method: 'mvola', receivedBy: 'shop' }] }),
    o('N2', 'va', 30000, d0, { status: 'cancelled', notes: 'Annulée : client injoignable', statusDates: { cancelled: at(d1) } }),
    o('N3', 'va', 25000, d1, { status: 'out' }),
    o('P1', 'vb', 20000, d0, {}),
    o('X1', 'vb', 50000, d0, { status: 'cancelled', dispatchedAt: undefined }), // jamais partie : pas une vente
  ]);
  return { d0: day(d0), d1: day(d1) };
});
await p.goto('http://localhost:5173/#/versements'); await p.waitForTimeout(900);
const card = p.locator('.card', { has: p.getByRole('heading', { name: /Suivi des restes par page/ }) });
const rows = (await card.locator('tbody tr, tfoot tr').allInnerTexts()).map(N);
console.log(rows.join('\n'));
const i = rows.indexOf('Netvision');
ok(i >= 0, 'groupe Netvision');
ok(new RegExp(`^Le ${days.d0} annulé : N2 · ✓ Validé 120 000 Ar 40 000 Ar — 30 000 Ar 50 000 Ar$`).test(rows[i + 1]), `Netvision ${days.d0} : 120 000 → 1er 40 000 → annulé 30 000 → reste 50 000`);
ok(new RegExp(`^Le ${days.d1} 25 000 Ar — — — 25 000 Ar$`).test(rows[i + 2]), `Netvision ${days.d1} : reste 25 000`);
ok(/^Total Netvision 145 000 Ar 40 000 Ar — 30 000 Ar 75 000 Ar$/.test(rows[i + 3]), 'total Netvision');
ok(rows.includes('Poignet précieux') && !rows.some((r) => /X1/.test(r)), 'Poignet précieux à part, X1 (jamais partie) ignorée');
ok(/^Total toutes pages 165 000 Ar 40 000 Ar — 30 000 Ar 95 000 Ar$/.test(rows[rows.length - 1]), `total toutes pages (${rows[rows.length - 1]})`);
if (process.env.SHOT) { await card.scrollIntoViewIfNeeded(); await card.screenshot({ path: process.env.SHOT }); }
// ✓ Validé : l'annulation vue sort du suivi
await card.getByRole('button', { name: /Valider l’annulation N2/ }).click(); await p.waitForTimeout(500);
const rows2 = (await card.locator('tbody tr, tfoot tr').allInnerTexts()).map(N);
const j = rows2.indexOf('Netvision');
ok(new RegExp(`^Le ${days.d0} 90 000 Ar 40 000 Ar — — 50 000 Ar$`).test(rows2[j + 1]), `après validation : ${days.d0} 90 000 → 40 000 → reste 50 000, plus d'annulé (${rows2[j + 1]})`);
ok(/^Total toutes pages 135 000 Ar 40 000 Ar — — 95 000 Ar$/.test(rows2[rows2.length - 1]), `reste encore dû inchangé 95 000 (${rows2[rows2.length - 1]})`);
ok(await p.evaluate(() => !!window.__tsena.get('orders', 'N2').cancelChecked), 'N2 marquée validée');
if (process.env.SHOT2) await card.screenshot({ path: process.env.SHOT2 });
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); await b.close(); process.exit(fail ? 1 : 0);
