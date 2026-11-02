// Synchro légère : les appareils ne retéléchargent plus les 50 dernières fiches toutes les 15 s (cause du blocage
// Supabase 402 du 31/10) ; blocage 402 signalé clairement (pas « mot de passe »), et on arrête de marteler le cloud.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 1280, height: 1000 }, timezoneId: 'Indian/Antananarivo' })).newPage();
const N = (t) => t.replace(/[  ]/g, ' ');
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
const cloud = new Map(); let rev = 0; let quota = false; const log = [];
const now = new Date().toISOString();
for (let i = 0; i < 120; i++) { rev++; cloud.set('audit:A' + i, { tbl: 'audit', id: 'A' + i, data: { id: 'A' + i, at: now, action: 'x', detail: 'y'.repeat(500), updatedAt: now, _f: {} }, rev }); }
await p.route('https://mock.supabase.co/**', async (route) => {
  const req = route.request(); const url = new URL(req.url()); const m = req.method(); const q = url.searchParams;
  log.push({ t: Date.now(), m, path: url.pathname, select: q.get('select') || '' });
  if (quota) return route.fulfill({ status: 402, body: '' });
  if (url.pathname.startsWith('/auth/')) return route.fulfill({ json: { access_token: 't', refresh_token: 'r', expires_in: 3600 } });
  if (m === 'GET') {
    let rows = [...cloud.values()];
    if (q.get('tbl')?.startsWith('eq.')) rows = rows.filter((r) => r.tbl === q.get('tbl').slice(3));
    if (q.get('rev')?.startsWith('in.(')) { const set = new Set(q.get('rev').slice(4, -1).split(',').map(Number)); rows = rows.filter((r) => set.has(r.rev)); } else if (q.get('rev')) { const g = Number(q.get('rev').replace('gt.', '')); rows = rows.filter((r) => r.rev > g); }
    if (q.get('order') === 'rev.desc') rows.sort((a, c) => c.rev - a.rev); else rows.sort((a, c) => a.rev - c.rev);
    if (q.get('limit')) rows = rows.slice(0, Number(q.get('limit')));
    const sel = (q.get('select') || '').split(',');
    return route.fulfill({ json: rows.map((r) => Object.fromEntries(sel.map((k) => [k, r[k]]))) });
  }
  const out = [];
  for (const r of JSON.parse(req.postData() || '[]')) { cloud.set(r.tbl + ':' + r.id, { ...r, rev: ++rev }); out.push({ tbl: r.tbl, id: r.id, updated_at: r.updated_at, rev }); }
  return route.fulfill({ json: out });
});
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
await p.evaluate(async () => { await window.__tsena.setMeta('cloud', { url: 'https://mock.supabase.co', anonKey: 'k', email: 'e@x', accessToken: 't', refreshToken: 'r', expiresAt: Date.now() + 3600e3 }); await window.__tsena.syncNow(); });
await p.waitForTimeout(1500);
ok(await p.evaluate(() => window.__tsena.get('audit', 'A119')?.detail?.length === 500), 'première synchro : tout est reçu');
const dataGets = () => log.filter((l) => l.m === 'GET' && l.select.includes('data')).length;
const before = dataGets();
for (let k = 0; k < 4; k++) await p.evaluate(() => window.__tsena.syncNow(true));
await p.waitForTimeout(500);
ok(dataGets() === before, `synchros suivantes sans rien de nouveau : aucune fiche retéléchargée (${dataGets() - before})`);
rev++; cloud.set('audit:NEW', { tbl: 'audit', id: 'NEW', data: { id: 'NEW', at: now, action: 'nouveau', detail: 'z', updatedAt: now, _f: {} }, rev });
await p.evaluate(() => window.__tsena.syncNow(true)); await p.waitForTimeout(500);
ok(await p.evaluate(() => window.__tsena.get('audit', 'NEW')?.action === 'nouveau'), 'nouvelle fiche d’un autre appareil bien reçue');
ok(dataGets() === before + 1, 'une seule petite demande pour la nouvelle fiche');
// Blocage 402
quota = true;
await p.evaluate(async () => { await window.__tsena.save('audit', { id: 'LOCAL', at: new Date().toISOString(), action: 'vente', detail: 'd' }); await window.__tsena.syncNow(true); });
await p.waitForTimeout(800);
const st = await p.evaluate(() => window.__tsena.syncStatus());
ok(st.state === 'error' && /quota gratuit du mois est dépassé/.test(st.error) && !st.auth, 'erreur 402 : « quota dépassé », pas « mot de passe »');
ok(st.pending >= 1, 'la vente reste en attente sur l’appareil');
const n0 = log.length;
await p.evaluate(async () => { for (let i = 0; i < 5; i++) await window.__tsena.syncNow(); });
await p.waitForTimeout(20_000);
ok(log.length - n0 === 0, `pendant le blocage : plus de synchro automatique toutes les 15 s (${log.length - n0} requête(s))`);
await p.goto('http://localhost:5173/#/parametres/cloud'); await p.waitForTimeout(600);
const tx = N(await p.locator('main').innerText());
ok(tx.includes('quota gratuit') && !tx.includes('Reprendre la connexion au cloud'), 'Paramètres → Cloud : message clair, pas de formulaire de mot de passe');
quota = false;
await p.getByRole('button', { name: 'Synchroniser maintenant' }).click(); await p.waitForTimeout(1500);
ok(cloud.has('audit:LOCAL') && (await p.evaluate(() => window.__tsena.syncStatus())).state === 'ok', 'cloud débloqué + « Synchroniser maintenant » : la vente part');
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); await b.close(); process.exit(fail ? 1 : 0);
