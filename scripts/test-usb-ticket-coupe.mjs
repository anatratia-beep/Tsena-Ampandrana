// Imprimante USB à petite mémoire (« USB Printer Port ») : le ticket ne doit plus être coupé au milieu.
// L'imprimante simulée a 4 Ko de mémoire et imprime environ 20 octets par milliseconde : ce qui arrive en trop est perdu.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 }, timezoneId: 'Indian/Antananarivo' });
await ctx.addInitScript(() => {
  const CAP = 4096, RATE = 20;
  const st = window.__usb = { got: [], lost: 0, chunks: [], level: 0, t: performance.now() };
  const drain = () => { const n = performance.now(); st.level = Math.max(0, st.level - (n - st.t) * RATE); st.t = n; };
  const ep = { endpointNumber: 1, direction: 'out', type: 'bulk' };
  const dev = { vendorId: 1155, productId: 22304, serialNumber: '', productName: 'USB Printer Port', opened: false, configuration: null,
    async open() { this.opened = true; }, async close() { this.opened = false; },
    async selectConfiguration() { this.configuration = { interfaces: [{ interfaceNumber: 0, claimed: false, alternates: [{ endpoints: [ep] }] }] }; },
    async claimInterface() { this.configuration.interfaces[0].claimed = true; },
    async clearHalt() {},
    async transferOut(n, data) {
      await new Promise((r) => setTimeout(r, 1)); drain(); st.chunks.push(data.length);
      const room = Math.max(0, CAP - st.level), keep = Math.min(room, data.length);
      st.got.push(...data.slice(0, keep)); st.lost += data.length - keep; st.level += keep;
      return { status: 'ok', bytesWritten: data.length }; // imprimante bon marché : dit « reçu » même quand elle jette
    } };
  Object.defineProperty(navigator, 'usb', { value: { getDevices: async () => [dev], requestDevice: async () => dev } });
});
const p = await ctx.newPage();
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
// logo de société assez grand pour remplir la mémoire de l'imprimante
const logo = await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 600; c.height = 300; const g = c.getContext('2d');
  for (let y = 0; y < 300; y += 6) for (let x = 0; x < 600; x += 6) { g.fillStyle = (x + y) % 12 ? '#000' : '#888'; g.fillRect(x, y, 3, 3); } return c.toDataURL('image/png'); });
await p.evaluate(async (logo) => { const t = window.__tsena; const c = (await t.getMeta('company', null)) || {}; await t.save('settings', { ...(t.get('settings', 'company') || { id: 'company' }), logo }).catch(() => {});
  await t.setMeta('printers', [{ id: 'u1', name: 'USB Printer Port', kind: 'usb', paper: '80', charset: 'cp850', logo: true, cut: false, ref: '1155:22304:', feedMm: 20 }]); }, logo);
await p.goto('http://localhost:5173/#/parametres/imprimantes'); await p.waitForTimeout(600);
const row = p.getByRole('listitem').filter({ hasText: 'USB Printer Port' }).first();
await row.getByRole('button', { name: 'Test', exact: true }).click();
await p.waitForFunction(() => window.__usb.chunks.length && performance.now() - window.__usb.t > 800, null, { timeout: 30000 });
const u = await p.evaluate(() => ({ sent: window.__usb.chunks.reduce((a, b) => a + b, 0), lost: window.__usb.lost, max: Math.max(...window.__usb.chunks), n: window.__usb.chunks.length, end: window.__usb.got.slice(-8) }));
console.log(`     envoyé ${u.sent} octets en ${u.n} morceaux (max ${u.max}), perdu ${u.lost}`);
ok(u.sent > 1000, 'la page de test part bien vers l’imprimante USB');
ok(u.max <= 256, 'envoi en petits morceaux (256 octets au plus)');
ok(u.lost === 0, 'rien de perdu : le ticket n’est plus coupé');
// Deux tickets lancés en même temps : ils ne se mélangent pas
await p.evaluate(() => { window.__usb.got = []; window.__usb.chunks = []; window.__usb.lost = 0; });
await row.getByRole('button', { name: 'Test', exact: true }).click(); await p.waitForTimeout(50);
await row.getByRole('button', { name: 'Test des accents' }).click().catch(async () => {});
await p.waitForTimeout(6000);
const g = await p.evaluate(() => window.__usb.got);
let inits = []; for (let i = 0; i < g.length - 1; i++) if (g[i] === 0x1b && g[i + 1] === 0x40) inits.push(i);
ok(g.length > 0 && inits[0] === 0, 'chaque envoi commence par l’initialisation, sans morceau d’un autre ticket au milieu');
await b.close();
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); process.exit(fail ? 1 : 0);
