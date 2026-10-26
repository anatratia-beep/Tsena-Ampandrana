// Imprimantes (prompt du 24/10) : test des accents, espace blanc 2 cm, Bluetooth par paquets de 20 octets avec renvoi,
// poste d'impression (imprimante déconnectée → bandeau « Reconnecter »), étiquette compacte.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 }, timezoneId: 'Indian/Antananarivo' });
await ctx.addInitScript(() => {
  window.__usbOut = []; window.__btChunks = []; let refused = false;
  const usbDev = { vendorId: 1155, productId: 22304, serialNumber: 'X', productName: 'POS-58', opened: false, configuration: null,
    async open() { this.opened = true; }, async close() { this.opened = false; }, async selectConfiguration() { this.configuration = { interfaces: [{ interfaceNumber: 0, claimed: false, alternates: [{ endpoints: [{ direction: 'out', type: 'bulk', endpointNumber: 1 }] }] }] }; },
    async claimInterface() { this.configuration.interfaces[0].claimed = true; }, async transferOut(ep, data) { window.__usbOut.push(...data); } };
  Object.defineProperty(navigator, 'usb', { value: { getDevices: async () => [usbDev], requestDevice: async () => usbDev } });
  const ch = { properties: { write: true }, async writeValueWithResponse(data) { if (!refused && window.__btChunks.length === 3) { refused = true; throw new Error('GATT operation already in progress'); } window.__btChunks.push([...data]); } };
  const dev = { id: 'bt1', name: 'KPrinter_1234', gatt: { connected: false, async connect() { this.connected = true; return { getPrimaryServices: async () => [{ getCharacteristics: async () => [ch] }] }; }, disconnect() { this.connected = false; } }, forget: async () => {} };
  Object.defineProperty(navigator, 'bluetooth', { value: { getDevices: async () => [dev], requestDevice: async () => dev } });
});
const p = await ctx.newPage();
const N = (t) => t.replace(/[  ]/g, ' ');
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
const hex = (a) => a.map((x) => x.toString(16).padStart(2, '0')).join(' ');
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
await p.evaluate(async () => {
  const t = window.__tsena;
  await t.setMeta('printers', [
    { id: 'usb1', name: 'Ticket USB', kind: 'usb', paper: '58', charset: 'cp850', logo: false, cut: false, ref: '1155:22304:X', deviceName: 'POS-58' },
    { id: 'bt1', name: 'Ticket BT', kind: 'bluetooth', paper: '58', charset: 'cp850', logo: false, cut: false, ref: 'bt1', deviceName: 'KPrinter_1234', btSpeed: 'safe' },
  ]);
});
// 1. USB : test des accents et page de test
await p.goto('http://localhost:5173/#/parametres/imprimantes'); await p.waitForTimeout(500);
let tx = N(await p.locator('main').innerText());
ok(tx.includes('comment la brancher') && tx.includes('Associée à cet appareil'), 'guide + badge « Associée à cet appareil »');
await p.getByRole('listitem').filter({ hasText: 'Ticket USB' }).getByRole('button', { name: 'Modifier' }).click(); await p.waitForTimeout(200);
await p.getByRole('dialog').getByRole('button', { name: 'Test des accents' }).click(); await p.waitForTimeout(500);
let out = await p.evaluate(() => window.__usbOut);
let h = hex(out);
ok(h.includes('1b 74 02') && out.indexOf(0x82) > h.split(' ').indexOf('74'), 'test des accents : 1b 74 02 puis é = 0x82');
ok(h.includes('1b 74 10') && h.includes('1b 74 0b'), 'test des accents : lignes C (table 16) et D (table 11)');
const opts = await p.getByRole('dialog').getByLabel('Jeu de caractères (accents)').locator('option').allInnerTexts();
ok(opts[0].startsWith('A — PC850') && !opts.some((o) => o.startsWith('B —')), 'jeux : A PC850 recommandé, PC858 masqué');
await p.getByRole('dialog').getByRole('button', { name: 'Annuler' }).click();
await p.evaluate(() => { window.__usbOut = []; });
await p.getByRole('listitem').filter({ hasText: 'Ticket USB' }).getByRole('button', { name: 'Test' }).click(); await p.waitForTimeout(600);
h = hex(await p.evaluate(() => window.__usbOut));
ok(h.includes('1b 33 18 0a 0a 0a 0a 0a 0a 0a 1b 32'), 'page de test : 2 cm d’espace blanc (7 sauts de ligne de 3 mm)');
ok(h.startsWith('1b 40 1c 2e'), 'début du ticket : remise à zéro + sortie du mode chinois (1c 2e)');
// 2. Bluetooth : paquets ≤ 20 octets, ticket complet malgré un paquet refusé
await p.getByRole('listitem').filter({ hasText: 'Ticket BT' }).getByRole('button', { name: 'Test' }).click(); await p.waitForTimeout(2500);
const chunks = await p.evaluate(() => window.__btChunks);
const flat = chunks.flat();
ok(chunks.length > 5 && chunks.every((c) => c.length <= 20), `Bluetooth : ${chunks.length} paquets, tous ≤ 20 octets`);
ok(hex(flat).endsWith('0a 0a 1b 32') && hex(flat).startsWith('1b 40 1c 2e'), 'Bluetooth : ticket complet malgré un paquet refusé');
// 3. Déconnecter / Reconnecter
await p.getByRole('listitem').filter({ hasText: 'Ticket USB' }).getByRole('button', { name: 'Déconnecter' }).click();
await p.getByRole('dialog').getByRole('button', { name: 'Déconnecter' }).click(); await p.waitForTimeout(400);
tx = N(await p.locator('main').innerText());
ok(tx.includes('Déconnectée') && (await p.evaluate(() => window.__tsena.getMeta('printers', []).find((x) => x.id === 'usb1').paused)) === true, 'Déconnecter : badge « Déconnectée », réglages gardés');
// 4. Poste : ticket en attente avec imprimante en pause → bandeau, puis Reconnecter
await p.evaluate(async () => {
  const t = window.__tsena;
  await t.save('printStations', [{ id: 'st1', name: 'Caisse', printerName: 'Ticket USB', lastSeen: new Date().toISOString() }]);
  await t.setMeta('myStation', { stationId: 'st1', printerId: 'usb1' });
  await t.save('printJobs', [{ id: 'j1', stationId: 'st1', status: 'pending', copies: 1, byName: 'Aina', doc: { title: 'Ticket V-1', blocks: [{ k: 'text', s: 'Bonjour' }] } }]);
  window.__usbOut = [];
});
await p.waitForTimeout(1500);
tx = N(await p.locator('body').innerText());
ok(tx.includes('Poste d’impression : imprimante à reconnecter') && tx.includes('1 ticket(s) en attente'), 'poste : bandeau « Reconnecter l’imprimante »');
ok((await p.evaluate(() => window.__tsena.get('printJobs', 'j1').status)) === 'pending', 'ticket gardé en attente (pas en erreur)');
await p.getByRole('button', { name: 'Reconnecter l’imprimante' }).click(); await p.waitForTimeout(1500);
const st = await p.evaluate(() => ({ job: window.__tsena.get('printJobs', 'j1').status, paused: window.__tsena.getMeta('printers', []).find((x) => x.id === 'usb1').paused, alert: window.__tsena.get('printStations', 'st1').alert }));
ok(st.job === 'done' && st.paused === false && !st.alert, 'après « Reconnecter » : ticket imprimé, imprimante reprise, alerte retirée');
// Drapeau d'alerte périmé : impression automatique sans clic
await p.evaluate(async () => { const t = window.__tsena; await t.save('printStations', { id: 'st1', alert: 'ancien message' }); await t.save('printJobs', [{ id: 'j2', stationId: 'st1', status: 'pending', copies: 1, doc: { title: 'Ticket V-2', blocks: [{ k: 'text', s: 'Re' }] } }]); });
await p.waitForTimeout(2000);
ok((await p.evaluate(() => window.__tsena.get('printJobs', 'j2').status)) === 'done' && !(await p.evaluate(() => window.__tsena.get('printStations', 'st1').alert)), 'alerte périmée : imprimé tout seul, alerte retirée');
// 5. Étiquette d'une commande à 1 article sans paiement
await p.evaluate(async () => {
  const t = window.__tsena; const now = new Date().toISOString();
  await t.setMeta('myStation', null);
  await t.save('categories', [{ id: 'pg1', name: 'Talon' }]);
  await t.save('products', [{ id: 'p1', code: 'TA', name: 'Slingback 36', categoryId: 'pg1', priceRetail: 60000, active: true }]);
  await t.save('variants', [{ id: 'v1', productId: 'p1', sku: 'TA', active: true }]);
  await t.save('orders', [{ id: 'o1', number: 'C-1', kind: 'order', channel: 'facebook', phone: '0341112233', name: 'Rina', zoneId: 'zone-centre', status: 'confirmed', lines: [{ id: 'l', variantId: 'v1', qty: 1, unitPrice: 60000 }], payments: [], discount: 0, deliveryFee: 0, createdAt: now }]);
});
await p.goto('http://localhost:5173/#/commandes/o1'); await p.waitForTimeout(500);
await p.getByRole('button', { name: 'Imprimer' }).first().click(); await p.waitForTimeout(300);
const segs = await p.getByRole('dialog').getByRole('group', { name: 'Document' }).getByRole('button').allInnerTexts();
ok(segs[0] === 'Ticket client' && (await p.getByRole('dialog').getByRole('button', { name: 'Ticket client' }).getAttribute('aria-pressed')) === 'true', '« Ticket client » en premier, choisi par défaut');
await p.getByRole('dialog').getByRole('button', { name: /Étiquette/ }).click(); await p.waitForTimeout(300);
const prev = p.getByRole('dialog').locator('.ticket');
const ptx = N(await prev.innerText());
ok(!ptx.includes('dont') && ptx.includes('A ENCAISSER') && ptx.replace(/\s+/g, ' ').includes('Merci pour votre commande') && !ptx.includes('Scanner pour ouvrir') && !ptx.includes('Frais de livraison'), 'étiquette : pas de « dont », A ENCAISSER, remerciement, sans légende ni frais à 0');
ok(await prev.locator('.tk-row.big', { hasText: 'A ENCAISSER' }).count() === 0 && await prev.locator('.tk-row.b', { hasText: 'A ENCAISSER' }).count() === 1, 'A ENCAISSER en gras taille normale');
ok(await prev.locator('.tk-qr svg').count() === 1 && await prev.locator('.tk-bottom').count() === 1, 'petit QR + 2 cm en bas dans l’aperçu');
// 6. Fenêtre « Imprimer » vers un poste : tickets déjà en attente, annulables
await p.evaluate(async () => { const t = window.__tsena; await t.save('printStations', [{ id: 'st2', name: 'Caisse 2', printerName: 'X', lastSeen: new Date().toISOString(), alert: 'geste' }]); await t.save('printJobs', [{ id: 'j9', stationId: 'st2', status: 'pending', copies: 1, byName: 'Aina', doc: { title: 'Ticket C-1', blocks: [] } }]); });
await p.getByRole('dialog').getByRole('button', { name: 'Ticket client' }).click();
await p.getByRole('dialog').getByRole('radio', { name: /Caisse 2/ }).check(); await p.waitForTimeout(300);
let dtx = N(await p.getByRole('dialog').innerText());
ok(dtx.includes('1 ticket(s) déjà en attente sur ce poste') && dtx.includes('Ce document est déjà en attente') && dtx.includes('imprimante à reconnecter sur le poste'), 'fenêtre Imprimer : tickets en attente du poste, alerte du poste');
await p.getByRole('dialog').getByRole('button', { name: 'Annuler ces tickets en attente' }).click(); await p.waitForTimeout(300);
ok(!(await p.evaluate(() => window.__tsena.get('printJobs', 'j9'))) , 'tickets en attente annulés');
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); await b.close(); process.exit(fail ? 1 : 0);
