// Poste d'impression toujours connecté : état de la liaison en direct, reconnexion automatique, lien vers l'historique,
// logo plus léger, fenêtre Imprimer qui se ferme tout de suite.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 }, timezoneId: 'Indian/Antananarivo' });
await ctx.addInitScript(() => {
  window.__btChunks = []; window.__connects = 0;
  const ch = { properties: { write: true }, async writeValueWithResponse(data) { window.__btChunks.push([...data]); } };
  const listeners = {};
  const dev = { id: 'bt1', name: 'KPrinter_1234', addEventListener(t, f) { (listeners[t] ||= []).push(f); },
    gatt: { connected: false, async connect() { window.__connects++; this.connected = true; return { getPrimaryServices: async () => [{ getCharacteristics: async () => [ch] }] }; }, disconnect() { this.connected = false; } }, forget: async () => {} };
  window.__dropBt = () => { dev.gatt.connected = false; (listeners.gattserverdisconnected || []).forEach((f) => f()); };
  Object.defineProperty(navigator, 'bluetooth', { value: { getDevices: async () => [dev], requestDevice: async () => dev } });
});
const p = await ctx.newPage();
const N = (t) => t.replace(/[  ]/g, ' ');
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
await p.evaluate(async () => { await window.__tsena.setMeta('printers', [{ id: 'bt1', name: 'Ticket BT', kind: 'bluetooth', paper: '58', charset: 'cp850', logo: true, cut: false, ref: 'bt1', deviceName: 'KPrinter_1234', btSpeed: 'safe' }]); });
await p.goto('http://localhost:5173/#/parametres/imprimantes'); await p.waitForTimeout(500);
const row = () => p.getByRole('listitem').filter({ hasText: 'Ticket BT' }).filter({ hasText: 'Bluetooth' }).first();
let tx = N(await row().innerText());
ok(tx.includes('À reconnecter') && tx.includes('Se reconnecter maintenant'), 'pas encore connectée : rouge « À reconnecter » + bouton');
await row().getByRole('button', { name: 'Se reconnecter maintenant' }).click(); await p.waitForTimeout(800);
tx = N(await row().innerText());
ok(tx.includes('Connectée') && !tx.includes('À reconnecter') && tx.includes('Associée à cet appareil'), 'après « Se reconnecter maintenant » : vert « Connectée »');
await p.evaluate(() => window.__dropBt()); await p.waitForTimeout(600);
ok(N(await row().innerText()).includes('À reconnecter'), 'liaison perdue : repasse en rouge tout de suite');
// Poste : reconnexion automatique sans clic
await p.evaluate(async () => { const t = window.__tsena; await t.save('printStations', [{ id: 'st1', name: 'Caisse', printerName: 'Ticket BT', lastSeen: new Date().toISOString() }]); await t.setMeta('myStation', { stationId: 'st1', printerId: 'bt1' }); });
await p.waitForTimeout(1500);
ok(N(await row().innerText()).includes('Connectée'), 'poste : reconnecté tout seul à l’ouverture');
const before = await p.evaluate(() => window.__connects);
await p.evaluate(() => window.__dropBt()); await p.waitForTimeout(2000);
ok((await p.evaluate(() => window.__connects)) > before && N(await row().innerText()).includes('Connectée'), 'poste : liaison perdue → reconnexion automatique sans clic');
tx = N(await p.locator('main').innerText());
ok(tx.includes('Pour que le poste ne se coupe jamais') && tx.includes('Sans restriction') && tx.includes('chargeur'), 'conseils anti-veille affichés sur le poste');
// Ticket envoyé au poste puis imprimé, liaison reprise avant d'imprimer
await p.evaluate(() => { window.__btChunks = []; window.__dropBt(); });
await p.evaluate(async () => { await window.__tsena.save('printJobs', [{ id: 'j1', stationId: 'st1', status: 'pending', copies: 1, doc: { title: 'Ticket V-1', blocks: [{ k: 'text', s: 'Bonjour' }] } }]); });
await p.waitForTimeout(2500);
ok((await p.evaluate(() => window.__tsena.get('printJobs', 'j1').status)) === 'done', 'ticket du poste imprimé même après une coupure');
// Lien vers l'historique dans une notification d'erreur
await p.evaluate(async () => { await window.__tsena.setMeta('myStation', null); });
await p.evaluate(async () => { const t = window.__tsena; await t.save('printStations', [{ id: 'st9', name: 'Poste PC', lastSeen: new Date().toISOString() }]); });
await p.evaluate(() => { const ev = new CustomEvent('x'); void ev; });
await p.evaluate(async () => { const t = window.__tsena; await t.save('printJobs', [{ id: 'j9', stationId: 'st9', status: 'error', error: 'papier vide', copies: 1, doc: { title: 'Ticket V-9', blocks: [] } }]); });
// Erreur d'impression directe : imprimante supprimée → notification avec lien
await p.goto('http://localhost:5173/#/'); await p.waitForTimeout(300);
await p.evaluate(async () => { await window.__tsena.setMeta('printers', [{ id: 'bt2', name: 'Sans ref', kind: 'bluetooth', paper: '58', charset: 'cp850', logo: false, cut: false }]); await window.__tsena.setMeta('printDefault', 'bt2'); await window.__tsena.setMeta('printAutoTicket', false); });
await p.evaluate(async () => { const t = window.__tsena; const now = new Date().toISOString(); await t.save('categories', [{ id: 'pg1', name: 'Talon' }]); await t.save('products', [{ id: 'p1', code: 'TA', name: 'Slingback', categoryId: 'pg1', priceRetail: 60000, active: true }]); await t.save('variants', [{ id: 'v1', productId: 'p1', sku: 'TA', active: true }]); await t.save('orders', [{ id: 'o1', number: 'C-1', kind: 'order', channel: 'facebook', phone: '0341112233', name: 'Rina', zoneId: 'zone-centre', status: 'confirmed', lines: [{ id: 'l', variantId: 'v1', qty: 1, unitPrice: 60000 }], payments: [], discount: 0, deliveryFee: 0, createdAt: now }]); });
await p.goto('http://localhost:5173/#/commandes/o1'); await p.waitForTimeout(500);
await p.getByRole('button', { name: 'Imprimer' }).first().click(); await p.waitForTimeout(300);
await p.getByRole('dialog').getByRole('radio', { name: /Sans ref/ }).check();
await p.getByRole('dialog').getByRole('button', { name: /^Imprimer$/ }).click(); await p.waitForTimeout(800);
ok(await p.getByRole('dialog').count() === 0, 'fenêtre Imprimer fermée tout de suite (impression en arrière-plan)');
const link = p.getByRole('button', { name: 'Historique des impressions' });
ok(await link.count() > 0, 'erreur d’impression : lien « Historique des impressions »');
await link.first().click(); await p.waitForTimeout(600);
ok(p.url().includes('/parametres/imprimantes') && (await p.locator('#historique').getAttribute('open')) !== null && N(await p.locator('#historique').innerText()).includes('Réessayer'), 'lien : historique ouvert, avec Réessayer');
// Logo plus léger : largeur du logo seulement, lignes blanches retirées
await p.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 200; c.height = 100; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 200, 100); g.fillStyle = '#000'; g.fillRect(40, 30, 120, 40);
  const t = window.__tsena; await t.save('settings', { id: 'company', name: 'Ma boutique', logo: c.toDataURL('image/png') });
  await t.setMeta('printers', [{ id: 'bt1', name: 'Ticket BT', kind: 'bluetooth', paper: '58', charset: 'cp850', logo: true, cut: false, ref: 'bt1', deviceName: 'KPrinter_1234', btSpeed: 'safe' }]);
  window.__btChunks = [];
});
await p.goto('http://localhost:5173/#/parametres/imprimantes'); await p.waitForTimeout(500);
await row().getByRole('button', { name: /Test|Se reconnecter/ }).first().click(); await p.waitForTimeout(800);
if (N(await row().innerText()).includes('Test')) { await row().getByRole('button', { name: 'Test' }).click(); await p.waitForTimeout(3000); }
const flat = (await p.evaluate(() => window.__btChunks)).flat();
const k = flat.findIndex((x, i) => x === 0x1d && flat[i + 1] === 0x76 && flat[i + 2] === 0x30);
const wBytes = flat[k + 4] + 256 * flat[k + 5], hRows = flat[k + 6] + 256 * flat[k + 7];
ok(k >= 0 && wBytes < 48 && hRows < 100, `logo : ${wBytes} octets par ligne (au lieu de 48), ${hRows} lignes (lignes blanches retirées)`);
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); await b.close(); process.exit(fail ? 1 : 0);
