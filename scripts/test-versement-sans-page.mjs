// Versements par page : la ligne « Sans page » (articles sans page) n’est plus comptée dans le tableau ni dans les totaux ;
// elle est montrée à part sous le tableau.
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
await p.evaluate(async () => {
  const t = window.__tsena; const now = new Date().toISOString(); const hash = t.get('users', 'user-superadmin').passwordHash;
  await t.save('categories', [{ id: 'pp', name: 'Poignet précieux' }]);
  await t.save('products', [{ id: 'a', code: 'A', name: 'Montre', categoryId: 'pp', priceRetail: 15000, active: true }, { id: 'z', code: 'Z', name: 'Sans cat', priceRetail: 1000, active: true }]);
  await t.save('variants', [{ id: 'va', productId: 'a', sku: 'A', costAvg: 5000, active: true }, { id: 'vz', productId: 'z', sku: 'Z', costAvg: 500, active: true }]);
  await t.save('stockMoves', [{ variantId: 'va', qty: 50, type: 'initial', at: now }, { variantId: 'vz', qty: 50, type: 'initial', at: now }]);
  await t.save('users', [{ id: 'u1', username: 'elisah', fullName: 'Elisah', roleId: 'role-seller', active: true, passwordHash: hash, mustChangePassword: false, pageIds: ['pp'] }]);
  const shop = (id, v, price, pays) => ({ id, number: id, kind: 'order', channel: 'shop', phone: '', status: 'delivered', lines: [{ id: 'l' + id, variantId: v, qty: 1, unitPrice: price, qtyKept: 1 }], payments: pays.map(([a, m], i) => ({ id: `p${id}${i}`, at: now, amount: a, method: m, receivedBy: 'shop' })), discount: 0, deliveryFee: 0, createdBy: 'u1', createdByName: 'Elisah', createdAt: now });
  await t.save('orders', [shop('S1', 'va', 15000, [[15000, 'cash']]), { ...shop('Z1', 'vz', 1000, [[-55308, 'cash'], [-37692, 'orange']]) }]);
});
await p.goto('http://localhost:5173/#/versements'); await p.waitForTimeout(800);
const table = N(await p.locator('.handover-table').first().innerText());
ok(!/Sans page/.test(table), 'plus de ligne « Sans page » dans le tableau Page par page');
ok(/Total\s+15 000 Ar\s+15 000 Ar/.test(table), `totaux sans les montants « Sans page » (${table.split('Total')[1]?.slice(0, 80)})`);
const tx = N(await p.locator('main').innerText());
ok(/Sans page \(Elisah\) : pas compté dans ce versement/.test(tx) && /espèces -?−?55 308 Ar/.test(tx), 'montants « Sans page » montrés à part sous le tableau');
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); await b.close(); process.exit(fail ? 1 : 0);
