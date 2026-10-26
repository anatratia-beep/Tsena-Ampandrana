// Imprimante d'étiquettes Luck Jingle L12 (« MPL12_1B4A_BLE ») : reconnue, étiquette de test envoyée en GS v 0.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 }, timezoneId: 'Indian/Antananarivo' });
await ctx.addInitScript(() => {
  const S = (n) => `0000${n}-0000-1000-8000-00805f9b34fb`;
  const st = window.__l12 = { bytes: [], writes: 0 };
  const write = { properties: { writeWithoutResponse: true }, uuid: S('ff02'), async writeValueWithoutResponse(d) { st.bytes.push(...new Uint8Array(d.buffer ? d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) : d)); st.writes++; } };
  const notify = { properties: { notify: true }, uuid: S('ff01'), async startNotifications() { return this; }, addEventListener() {} };
  const svc = { uuid: S('ff00'), getCharacteristics: async () => [notify, write], getCharacteristic: async (u) => (u === S('ff02') ? write : notify) };
  const dev = { id: 'l12', name: 'MPL12_1B4A_BLE', addEventListener() {}, forget: async () => {},
    gatt: { connected: false, async connect() { this.connected = true; return this; }, disconnect() { this.connected = false; }, getPrimaryServices: async () => [svc], getPrimaryService: async () => svc } };
  Object.defineProperty(navigator, 'bluetooth', { value: { getDevices: async () => [dev], requestDevice: async () => dev } });
});
const p = await ctx.newPage();
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
await p.goto('http://localhost:5173/#/parametres/imprimantes'); await p.waitForTimeout(600);
await p.getByRole('button', { name: 'Ajouter une imprimante' }).click(); await p.waitForTimeout(300);
await p.getByRole('button', { name: /Chercher l’imprimante/ }).click(); await p.waitForTimeout(800);
const dlg = (await p.getByRole('dialog').innerText()).replace(/[  ]/g, ' ');
ok(dlg.includes('Appairée : MPL12_1B4A_BLE') && dlg.includes('Imprimante d’étiquettes : elle imprime'), 'L12 reconnue comme imprimante d’étiquettes');
ok(dlg.includes('Taille des étiquettes') && !dlg.includes('Jeu de caractères') && !dlg.includes('Espace blanc'), 'réglages d’étiquettes (taille, noirceur, sens), pas ceux des tickets');
await p.screenshot({ path: '/tmp/claude-0/l12-form.png' });
await p.getByRole('button', { name: 'Étiquette de test' }).click();
await p.waitForTimeout(4000);
const r = await p.evaluate(() => {
  const b = window.__l12.bytes; const hex = (a) => a.map((x) => x.toString(16).padStart(2, '0')).join(' ');
  const i = b.findIndex((x, k) => x === 0x1d && b[k + 1] === 0x76 && b[k + 2] === 0x30);
  const w = b[i + 4] | (b[i + 5] << 8), h = b[i + 6] | (b[i + 7] << 8);
  const data = b.slice(i + 8, i + 8 + w * h);
  const cv = document.createElement('canvas'); cv.width = w * 8; cv.height = h; const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, h); g.fillStyle = '#000';
  for (let y = 0; y < h; y++) for (let x = 0; x < w * 8; x++) if (data[y * w + (x >> 3)] & (0x80 >> (x & 7))) g.fillRect(x, y, 1, 1);
  // remise à plat (rotation inverse) pour regarder l'étiquette comme on la lit
  const flat = document.createElement('canvas'); flat.width = h; flat.height = w * 8; const f = flat.getContext('2d'); f.translate(0, w * 8); f.rotate(-Math.PI / 2); f.drawImage(cv, 0, 0);
  return { start: hex(b.slice(0, 24)), end: hex(b.slice(-9)), w, h, after: hex(b.slice(i + 8 + w * h, i + 10 + w * h)), png: flat.toDataURL() };
});
fs.writeFileSync('/tmp/claude-0/l12-label.png', Buffer.from(r.png.split(',')[1], 'base64'));
console.log('     début', r.start, '| fin', r.end, '| image', r.w * 8, '×', r.h);
ok(r.start.startsWith('10 ff f1 03 00 00 00 00 00 00 00 00 00 00 00 00 10 ff 10 00 02 1f 11 51'), 'activation, réveil, noirceur foncée, début d’étiquette (1F 11 51)');
ok(r.w === 12 && r.h === 240, 'image 96 points de large × 240 lignes (30 mm)');
ok(r.after === '1d 0c', 'étiquette suivante (1D 0C) après l’image');
ok(r.end === '1d 0c 1f 11 50 10 ff f1 45', 'fin : 1F 11 50 puis arrêt (10 FF F1 45)');
await b.close();
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); process.exit(fail ? 1 : 0);
