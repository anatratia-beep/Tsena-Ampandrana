// Codes QR et numéros de série : création à l'entrée en stock, étiquettes sur la L12, vente par scan,
// numéros pris automatiquement, comptage par scan, page de garantie publique.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 }, timezoneId: 'Indian/Antananarivo' });
await ctx.addInitScript(() => {
  const S = (n) => `0000${n}-0000-1000-8000-00805f9b34fb`;
  const st = window.__l12 = { bytes: [] };
  const write = { properties: { writeWithoutResponse: true }, async writeValueWithoutResponse(d) { st.bytes.push(...new Uint8Array(d.buffer ? d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) : d)); } };
  const svc = { getCharacteristics: async () => [write], getCharacteristic: async (u) => (u === S('ff02') ? write : { startNotifications: async () => {}, addEventListener() {} }) };
  const dev = { id: 'l12', name: 'MPL12_1B4A_BLE', addEventListener() {}, gatt: { connected: false, async connect() { this.connected = true; return this; }, disconnect() {}, getPrimaryServices: async () => [svc], getPrimaryService: async () => svc } };
  Object.defineProperty(navigator, 'bluetooth', { value: { getDevices: async () => [dev], requestDevice: async () => dev } });
});
const p = await ctx.newPage();
const N = (t) => t.replace(/[  ]/g, ' ');
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
// Articles : IND (suivi, garantie 6 mois), BOL (non suivi)
const setup = await p.evaluate(async () => {
  const t = window.__tsena;
  await t.save('products', [{ id: 'pIND', code: 'IND TAC', name: 'Induction tactile', priceRetail: 95000, active: true, serialTracked: true, warrantyMonths: 6 },
    { id: 'pBOL', code: 'BOL', name: 'Bol inox', priceRetail: 5000, active: true }]);
  await t.save('variants', [{ id: 'vIND', productId: 'pIND', sku: 'IND TAC', active: true }, { id: 'vBOL', productId: 'pBOL', sku: 'BOL', active: true }]);
  await t.addMoves([{ variantId: 'vIND', qty: 3, type: 'initial', reason: 'test' }, { variantId: 'vBOL', qty: 2, type: 'initial', reason: 'test' }]);
  await t.setMeta('printers', [{ id: 'lab', name: 'Étiquettes', kind: 'bluetooth', lang: 'label', paper: '58', charset: 'cp850', logo: false, cut: false, ref: 'l12', deviceName: 'MPL12_1B4A_BLE', labelSize: '30x15', headDots: 96, density: 2 }]);
  return t.all('serials').map((s) => s.serial + ':' + s.status);
});
ok(setup.length === 3 && setup.every((x) => /^INDTAC-\d{5}:stock$/.test(x)), `3 numéros de série créés à l’entrée en stock (${setup.join(', ')})`);
// Étiquettes : une par pièce
await p.goto('http://localhost:5173/#/etiquettes?produit=pIND'); await p.waitForTimeout(800);
let tx = N(await p.locator('main').innerText());
ok(tx.includes('Imprimer 3 étiquette(s)'), 'page Étiquettes : l’article choisi, une étiquette par pièce (3)');
await p.screenshot({ path: '/tmp/claude-0/labels-page.png', fullPage: true });
await p.getByRole('button', { name: /Imprimer 3 étiquette/ }).click(); await p.waitForTimeout(5000);
const sent = await p.evaluate(() => { const b = window.__l12.bytes; let n = 0; for (let i = 0; i < b.length - 2; i++) if (b[i] === 0x1d && b[i + 1] === 0x76 && b[i + 2] === 0x30) n++; return { n, printed: window.__tsena.all('serials').filter((s) => s.printedAt).length }; });
ok(sent.n === 3 && sent.printed === 3, `3 étiquettes envoyées à la L12, pièces marquées « imprimées » (${sent.n} / ${sent.printed})`);
// Étiquette article (non suivi) : code court A…
await p.goto('http://localhost:5173/#/etiquettes?produit=pBOL'); await p.waitForTimeout(600);
await p.evaluate(() => { window.__l12.bytes = []; });
await p.getByRole('button', { name: /Imprimer 2 étiquette/ }).click(); await p.waitForTimeout(4000);
const code = await p.evaluate(() => window.__tsena.get('variants', 'vBOL').labelCode);
ok(/^A\d{5}$/.test(code || ''), `article non suivi : code d’étiquette créé (${code})`);
// Vente sur place : scan d'un numéro précis
const [s1, s2] = setup.map((x) => x.split(':')[0]);
await p.goto('http://localhost:5173/#/vente'); await p.waitForTimeout(600);
const box = p.getByLabel('Rechercher un article');
await box.fill(`http://localhost:5173/?s=${s2}`); await box.press('Enter'); await p.waitForTimeout(300);
await box.fill(code); await box.press('Enter'); await p.waitForTimeout(300);
tx = N(await p.locator('#pos-cart').innerText());
ok(tx.includes(`N° ${s2}`) && tx.includes('Bol inox'), 'scan du QR (lien de garantie) et du code article : ajoutés au panier avec le bon numéro');
await p.getByRole('button', { name: /^Encaisser/ }).first().click(); await p.waitForTimeout(300);
await p.getByRole('button', { name: /Valider la vente/ }).click(); await p.waitForTimeout(800);
const after = await p.evaluate((ids) => { const t = window.__tsena; return ids.map((s) => t.get('serials', s)?.status); }, [s1, s2]);
ok(after[1] === 'sold' && after[0] === 'stock', `la pièce scannée (${s2}) est vendue, les autres restent en stock`);
// Vente sans scan : numéro pris automatiquement (le plus ancien)
await p.evaluate(async () => { const t = window.__tsena; await t.addMoves({ variantId: 'vIND', qty: -1, type: 'sale', reason: 'test sans scan' }); });
const auto = await p.evaluate((s) => window.__tsena.get('serials', s)?.status, s1);
ok(auto === 'sold', `vente sans scan : le numéro le plus ancien (${s1}) est pris automatiquement`);
// Article existant devenu suivi : numéros manquants
await p.evaluate(async () => { await window.__tsena.save('products', { id: 'pBOL', serialTracked: true }); });
await p.goto('http://localhost:5173/#/etiquettes?produit=pBOL'); await p.waitForTimeout(700);
tx = N(await p.locator('main').innerText());
ok(tx.includes('1 manquant(s)'), 'article existant passé en « numéro par pièce » : numéros manquants signalés (stock 1)');
await p.getByRole('button', { name: /Créer les numéros manquants/ }).click(); await p.waitForTimeout(500);
ok((await p.evaluate(() => window.__tsena.all('serials').filter((s) => s.variantId === 'vBOL').length)) === 1, 'numéros manquants créés pour le stock existant');
// Inventaire : comptage par scan
await p.goto('http://localhost:5173/#/stock/inventaire'); await p.waitForTimeout(700);
const search = p.getByLabel('Rechercher', { exact: true }).first();
if (await search.count()) {
  await search.fill(setup[2].split(':')[0]); await search.press('Enter'); await p.waitForTimeout(300);
  const d = await p.evaluate(() => window.__tsena.getMeta('inventoryDraft', {}));
  ok(d.vIND === '1', 'inventaire : un QR scanné compte une pièce (+1)');
} else ok(false, 'inventaire : champ de recherche trouvé');
// Page de garantie (client, sans connexion)
const sold = s2;
await ctx.route('**/garantie.json', (r) => r.fulfill({ json: { url: 'https://cloud.example', key: 'pub' } }));
await ctx.route('https://cloud.example/rest/v1/rpc/warranty_lookup', async (r) => {
  const body = JSON.parse(r.request().postData() || '{}');
  const s = await p.evaluate((x) => window.__tsena.get('serials', x), body.p_serial);
  r.fulfill({ json: s ? { serial: s.serial, status: s.status, soldAt: s.outAt, product: 'Induction tactile', warrantyMonths: 6, company: 'Induction.mg', phone: '038 70 627 48' } : null });
});
const c2 = await b.newContext({ viewport: { width: 390, height: 800 } });
await c2.route('**/garantie.json', (r) => r.fulfill({ json: { url: 'https://cloud.example', key: 'pub' } }));
await c2.route('https://cloud.example/rest/v1/rpc/warranty_lookup', (r) => r.fulfill({ json: { serial: sold, status: 'sold', soldAt: new Date().toISOString(), product: 'Induction tactile', warrantyMonths: 6, company: 'Induction.mg', phone: '038 70 627 48' } }));
const g = await c2.newPage();
await g.goto(`http://localhost:5173/?s=${sold}`); await g.waitForTimeout(1200);
const gt = N(await g.locator('body').innerText());
ok(gt.includes('Garantie valable') && gt.includes('Induction tactile') && gt.includes(sold) && !gt.includes("Nom d'utilisateur"), 'page de garantie (client) : produit, numéro, garantie valable, sans connexion');
await g.screenshot({ path: '/tmp/claude-0/garantie.png' });
await b.close();
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); process.exit(fail ? 1 : 0);
