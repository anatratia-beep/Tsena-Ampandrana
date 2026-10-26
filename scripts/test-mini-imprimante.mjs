// Mini imprimante « Tiny Print » X6h : reconnue au nom, ticket envoyé en image (protocole 51 78), pauses respectées.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 }, timezoneId: 'Indian/Antananarivo' });
await ctx.addInitScript(() => {
  const S = (n) => `0000${n}-0000-1000-8000-00805f9b34fb`;
  const st = window.__cat = { bytes: [], writes: 0, duringPause: 0, paused: false, listeners: [] };
  const notify = { properties: { notify: true }, uuid: S('ae02'), async startNotifications() { return this; },
    addEventListener(t, f) { st.listeners.push(f); } };
  const send = (flag) => { const v = new Uint8Array([0x51, 0x78, 0xae, 0x01, 0x01, 0x00, flag, 0x00, 0xff]); st.listeners.forEach((f) => f({ target: { value: { buffer: v.buffer } } })); };
  const write = { properties: { writeWithoutResponse: true }, uuid: S('ae01'),
    async writeValueWithoutResponse(d) {
      if (st.paused) st.duringPause++;
      st.bytes.push(...new Uint8Array(d.buffer ? d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) : d)); st.writes++;
      if (st.writes === 40) { st.paused = true; send(0x10); setTimeout(() => { st.paused = false; send(0x00); }, 300); }
    } };
  const svc = { uuid: S('ae30'), getCharacteristics: async () => [write, notify], getCharacteristic: async (u) => (u === S('ae01') ? write : notify) };
  const dev = { id: 'x6h', name: 'X6h-5306', addEventListener() {}, forget: async () => {},
    gatt: { connected: false, async connect() { this.connected = true; return this; }, disconnect() { this.connected = false; },
      getPrimaryServices: async () => [svc], getPrimaryService: async () => svc } };
  Object.defineProperty(navigator, 'bluetooth', { value: { getDevices: async () => [dev], requestDevice: async () => dev } });
});
const p = await ctx.newPage();
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
await p.goto('http://localhost:5173/#/parametres/imprimantes'); await p.waitForTimeout(600);
// Ajout : Bluetooth → Chercher → X6h reconnue
await p.getByRole('button', { name: 'Ajouter une imprimante' }).click(); await p.waitForTimeout(300);
await p.getByRole('dialog').getByText('Bluetooth', { exact: false }).first().click().catch(() => {});
await p.getByRole('button', { name: /Chercher l’imprimante/ }).click(); await p.waitForTimeout(800);
const dlg = (await p.getByRole('dialog').innerText()).replace(/[  ]/g, ' ');
ok(dlg.includes('Appairée : X6h-5306'), 'X6h trouvée');
ok(dlg.includes('Mini imprimante (application « Tiny Print »)') && !dlg.includes('Jeu de caractères'), 'reconnue comme mini imprimante : pas de jeu de caractères ni test des accents');
await p.screenshot({ path: '/tmp/claude-0/mini-form.png' });
await p.getByRole('button', { name: 'Page de test' }).click();
await p.waitForFunction(() => window.__cat.writes > 50 && performance.now() > 0, null, { timeout: 60000 });
await p.waitForTimeout(4000);
const r = await p.evaluate(() => {
  const b = window.__cat.bytes; const frames = []; let i = 0, bad = 0;
  const T = new Uint8Array(256); for (let k = 0; k < 256; k++) { let c = k; for (let j = 0; j < 8; j++) c = c & 0x80 ? ((c << 1) ^ 7) & 255 : (c << 1) & 255; T[k] = c; }
  while (i < b.length) {
    if (b[i] !== 0x51 || b[i + 1] !== 0x78) { bad++; i++; continue; }
    const cmd = b[i + 2], len = b[i + 4] | (b[i + 5] << 8), data = b.slice(i + 6, i + 6 + len);
    let c = 0; for (const x of data) c = T[(c ^ x) & 255];
    if (c !== b[i + 6 + len] || b[i + 7 + len] !== 0xff) bad++;
    frames.push({ cmd, data }); i += 8 + len;
  }
  // redessine l'image reçue
  const rows = []; for (const f of frames) { if (f.cmd === 0xa2) rows.push(f.data); else if (f.cmd === 0xa1 && rows.length) for (let k = 0; k < f.data[0]; k++) rows.push(new Array(48).fill(0)); }
  const cv = document.createElement('canvas'); cv.width = 384; cv.height = rows.length; const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 384, rows.length); g.fillStyle = '#000';
  rows.forEach((row, y) => { for (let x = 0; x < 384; x++) if (row[x >> 3] & (1 << (x & 7))) g.fillRect(x, y, 1, 1); });
  return { n: frames.length, bad, cmds: frames.map((f) => f.cmd), rowLens: [...new Set(frames.filter((f) => f.cmd === 0xa2).map((f) => f.data.length))], png: cv.toDataURL(), dp: window.__cat.duringPause };
});
const fs = await import('node:fs'); fs.writeFileSync('/tmp/claude-0/mini-ticket.png', Buffer.from(r.png.split(',')[1], 'base64'));
console.log(`     ${r.n} trames, ${r.cmds.filter((c) => c === 0xa2).length} lignes dessinées`);
ok(r.bad === 0, 'toutes les trames sont valides (51 78 … CRC FF)');
ok(r.cmds[0] === 0xa3 && r.cmds.includes(0xa4) && r.cmds.includes(0xaf), 'début : état, qualité 200 dpi, chauffe');
ok(r.cmds.filter((c) => c === 0xa6).length === 2, 'début et fin de l’impression (A6)');
ok(r.rowLens.length === 1 && r.rowLens[0] === 48 && r.cmds.filter((c) => c === 0xa2).length > 100, 'ticket envoyé en lignes de 384 points (48 octets)');
ok(r.cmds.lastIndexOf(0xa1) > r.cmds.lastIndexOf(0xa6), 'avance du papier à la fin (espace blanc)');
ok(r.dp === 0, 'pause demandée par l’imprimante respectée (rien envoyé pendant la pause)');
await b.close();
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); process.exit(fail ? 1 : 0);
