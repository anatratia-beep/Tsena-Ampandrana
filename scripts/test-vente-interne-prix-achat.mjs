// Ventes internes (employés, au prix d’achat) : hors ventes et hors versements ; case « Prix d’achat » à part dans le
// rapport patron.
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
  await t.save('categories', [{ id: 'pp', name: 'Poignet précieux' }, { id: 'pi', name: 'Pile' }]);
  await t.save('products', [{ id: 'a', code: 'A', name: 'Montre', categoryId: 'pp', priceRetail: 15000, active: true }, { id: 'b', code: 'B', name: 'Batterie', categoryId: 'pi', priceRetail: 60000, active: true }]);
  await t.save('variants', [{ id: 'va', productId: 'a', sku: 'A', costAvg: 5000, active: true }, { id: 'vb', productId: 'b', sku: 'B', costAvg: 38524, active: true }]);
  await t.save('stockMoves', [{ variantId: 'va', qty: 50, type: 'initial', at: now }, { variantId: 'vb', qty: 50, type: 'initial', at: now }]);
  await t.save('users', [{ id: 'u1', username: 'mbola', fullName: 'Mbolatiana', roleId: 'role-seller', active: true, passwordHash: hash, mustChangePassword: false, pageIds: ['pp', 'pi'] }]);
  const shop = (id, v, price, extra = {}) => ({ id, number: id, kind: 'order', channel: 'shop', phone: '', status: 'delivered', lines: [{ id: 'l' + id, variantId: v, qty: 1, unitPrice: price, qtyKept: 1 }], payments: [{ id: 'p' + id, at: now, amount: price, method: 'cash', receivedBy: 'shop' }], discount: 0, deliveryFee: 0, createdBy: 'u1', createdByName: 'Mbolatiana', createdAt: now, ...extra });
  await t.save('orders', [shop('S1', 'va', 15000), shop('VI1', 'vb', 38524, { internal: true, employeeId: 'u1', employeeName: 'Mbolatiana' })]);
});
await p.goto('http://localhost:5173/#/versements'); await p.waitForTimeout(800);
const table = N(await p.locator('.handover-table').first().innerText());
ok(!/Pile/.test(table) && !/38 524/.test(table), 'vente interne (Pile, 38 524) absente du versement');
ok(/Total\s+15 000 Ar\s+15 000 Ar/.test(table), 'total du versement = vente normale seulement (15 000)');
const today = await p.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
await p.goto(`http://localhost:5173/#/rapports/patron?p=day&a=${today}`); await p.reload(); await p.waitForTimeout(1000);
const tx = N(await p.locator('main').innerText());
ok(/Total à verser\s*15 000 Ar/.test(tx), 'rapport patron : Total à verser 15 000 (sans la vente interne)');
ok(/Prix d’achat\s*38 524 Ar/.test(tx), 'rapport patron : case « Prix d’achat » 38 524');
ok(!/Chiffre d'affaires\s*53 524/.test(tx), 'CA sans la vente interne');
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); await b.close(); process.exit(fail ? 1 : 0);
