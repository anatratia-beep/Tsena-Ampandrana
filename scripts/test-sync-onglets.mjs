// Deux onglets ouverts sur le même appareil renouvellent la connexion au même moment : le cloud (rotation des jetons
// avec détection de réutilisation) ne doit pas couper l'appareil.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 1200, height: 900 } });
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
let gen = 1; let revoked = false; const used = new Set(); let refreshCalls = 0;
await ctx.route('https://mock.supabase.co/**', async (route) => {
  const req = route.request(); const url = new URL(req.url());
  if (url.pathname.startsWith('/auth/')) {
    const body = JSON.parse(req.postData() || '{}');
    if (url.searchParams.get('grant_type') === 'refresh_token') {
      refreshCalls++;
      await new Promise((r) => setTimeout(r, 300));
      if (revoked || used.has(body.refresh_token) || body.refresh_token !== 'r' + gen) { revoked = true; return route.fulfill({ status: 400, json: { error_description: 'Invalid Refresh Token: Already Used' } }); }
      used.add(body.refresh_token); gen++;
      return route.fulfill({ json: { access_token: 'a' + gen, refresh_token: 'r' + gen, expires_in: 3600 } });
    }
    return route.fulfill({ status: 400, json: {} });
  }
  if (revoked) return route.fulfill({ status: 401, json: {} });
  if (req.method() === 'GET') return route.fulfill({ json: [] });
  return route.fulfill({ json: [] });
});
const p1 = await ctx.newPage(); p1.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
await p1.goto('http://localhost:5173/'); await p1.waitForTimeout(600);
await p1.getByLabel("Nom d'utilisateur").fill('super-adm'); await p1.locator('input[type=password]').fill('anosy'); await p1.keyboard.press('Enter');
await p1.getByRole('button', { name: 'Plus tard' }).click(); await p1.waitForTimeout(400);
await p1.evaluate(async () => { await window.__tsena.setMeta('cloud', { url: 'https://mock.supabase.co', anonKey: 'k', email: 'e@x', accessToken: 'a1', refreshToken: 'r1', expiresAt: Date.now() - 1000 }); });
const p2 = await ctx.newPage(); await p2.goto('http://localhost:5173/'); await p2.waitForTimeout(1500);
// Les deux onglets synchronisent en même temps avec un jeton expiré.
await Promise.all([p1.evaluate(() => window.__tsena.syncNow(true)), p2.evaluate(() => window.__tsena.syncNow(true))]);
await p1.waitForTimeout(800);
ok(!revoked, `la connexion n’est pas coupée (renouvellements : ${refreshCalls})`);
const s1 = await p1.evaluate(() => window.__tsena.syncStatus()); const s2 = await p2.evaluate(() => window.__tsena.syncStatus());
ok(s1.state !== 'error' && s2.state !== 'error', `les deux onglets restent synchronisés (${s1.state} / ${s2.state})`);
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); await b.close(); process.exit(fail ? 1 : 0);
