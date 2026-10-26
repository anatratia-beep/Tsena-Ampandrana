// Connexion au cloud expirée (mot de passe du compte cloud changé) : erreur claire, la pastille ouvre Paramètres → Cloud,
// reprise avec le seul mot de passe, sans rien perdre : les ventes en attente partent.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 1280, height: 1000 }, timezoneId: 'Indian/Antananarivo' })).newPage();
const N = (t) => t.replace(/[  ]/g, ' ');
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
const cloud = new Map(); let rev = 0; const GOOD = 'tok-new';
await p.route('https://mock.supabase.co/**', async (route) => {
  const req = route.request(); const url = new URL(req.url()); const m = req.method(); const q = url.searchParams;
  if (url.pathname.startsWith('/auth/v1/token')) {
    const body = JSON.parse(req.postData() || '{}');
    if (q.get('grant_type') === 'password' && body.password === 'nouveau') return route.fulfill({ json: { access_token: GOOD, refresh_token: 'r2', expires_in: 3600 } });
    return route.fulfill({ status: 400, json: { error_description: q.get('grant_type') === 'password' ? 'Invalid login credentials' : 'Invalid Refresh Token: Refresh Token Not Found' } });
  }
  if (req.headers()['authorization'] !== 'Bearer ' + GOOD) return route.fulfill({ status: 401, json: { message: 'JWT expired' } });
  if (m === 'GET') {
    let rows = [...cloud.values()];
    if (q.get('rev')) { const g = Number(q.get('rev').replace('gt.', '')); rows = rows.filter((r) => r.rev > g); }
    if (q.get('select') === 'rev') return route.fulfill({ json: rows.sort((a, c) => c.rev - a.rev).slice(0, 1).map((r) => ({ rev: r.rev })) });
    return route.fulfill({ json: rows.sort((a, c) => a.rev - c.rev).map((r) => ({ tbl: r.tbl, id: r.id, data: r.data, rev: r.rev })) });
  }
  const out = [];
  for (const r of JSON.parse(req.postData())) { cloud.set(r.tbl + ':' + r.id, { ...r, rev: ++rev }); out.push({ tbl: r.tbl, id: r.id, updated_at: r.updated_at }); }
  return route.fulfill({ json: out });
});
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
await p.evaluate(async () => {
  const t = window.__tsena; const now = new Date().toISOString();
  await t.save('orders', Array.from({ length: 4 }, (_, i) => ({ id: 'V' + i, number: 'V-' + i, kind: 'order', channel: 'shop', status: 'delivered', lines: [], payments: [], discount: 0, createdAt: now })));
  // Jeton encore « valide » localement mais refusé par le cloud (401), et renouvellement refusé.
  await t.setMeta('cloud', { url: 'https://mock.supabase.co', anonKey: 'k', email: 'boutique@x', accessToken: 'old', refreshToken: 'r', expiresAt: Date.now() + 3600e3 });
  await t.syncNow();
});
await p.waitForTimeout(1200);
ok(cloud.size === 0, 'connexion expirée : rien n’est envoyé');
const pill = p.locator('.sync-pill, [class*=sync]').filter({ hasText: 'Erreur' }).first();
ok(await pill.count() > 0, 'pastille « Erreur synchro » affichée');
await pill.click(); await p.waitForTimeout(500);
ok(p.url().includes('#/parametres/cloud'), 'la pastille ouvre Paramètres → Cloud');
let tx = N(await p.locator('main').innerText());
ok(tx.includes('La connexion de cet appareil au cloud a expiré') && tx.includes('Reprendre la connexion au cloud') && tx.includes('boutique@x'), 'message clair + formulaire de reprise (mot de passe seul)');
await p.getByLabel('Mot de passe du compte cloud').fill('mauvais'); await p.getByRole('button', { name: 'Reprendre la connexion' }).click(); await p.waitForTimeout(600);
ok(N(await p.locator('body').innerText()).includes('Invalid login credentials') && cloud.size === 0, 'mauvais mot de passe : refusé, rien de perdu');
await p.getByLabel('Mot de passe du compte cloud').fill('nouveau'); await p.getByRole('button', { name: 'Reprendre la connexion' }).click(); await p.waitForTimeout(1500);
ok([0, 1, 2, 3].every((i) => cloud.has('orders:V' + i)), 'bon mot de passe : les ventes en attente sont arrivées dans le cloud');
const pending = await p.evaluate(async () => { await window.__tsena.syncNow(); return window.__tsena.outboxCount(); });
ok(pending === 0, `plus rien en attente (${pending})`);
tx = N(await p.locator('main').innerText());
ok(!tx.includes('Reprendre la connexion au cloud') && await p.locator('main .notice-danger').count() === 0 && tx.includes('Synchronisé'), 'formulaire et erreur disparus, « Synchronisé »');
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); await b.close(); process.exit(fail ? 1 : 0);
