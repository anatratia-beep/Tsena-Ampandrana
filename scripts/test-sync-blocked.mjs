// Synchronisation : une fiche refusée par le cloud ne bloque plus les autres (ventes) ; envoi par paquets ≤ 1 Mo ;
// tickets d'impression légers (logo de la page par référence).
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 1280, height: 1000 }, timezoneId: 'Indian/Antananarivo' })).newPage();
const N = (t) => t.replace(/[  ]/g, ' ');
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
const cloud = new Map(); let rev = 0; let maxBody = 0;
await p.route('https://mock.supabase.co/**', async (route) => {
  const req = route.request(); const url = new URL(req.url()); const m = req.method(); const q = url.searchParams;
  if (m === 'GET') {
    let rows = [...cloud.values()];
    if (q.get('rev')) { const g = Number(q.get('rev').replace('gt.', '')); rows = rows.filter((r) => r.rev > g); }
    if (q.get('select') === 'rev') return route.fulfill({ json: rows.sort((a, c) => c.rev - a.rev).slice(0, 1).map((r) => ({ rev: r.rev })) });
    return route.fulfill({ json: rows.sort((a, c) => a.rev - c.rev).map((r) => ({ tbl: r.tbl, id: r.id, data: r.data, rev: r.rev })) });
  }
  const raw = req.postData() || ''; maxBody = Math.max(maxBody, raw.length);
  if (raw.length > 1_500_000) return route.fulfill({ status: 413, body: 'Payload Too Large' });
  const body = JSON.parse(raw);
  if (body.some((r) => r.id === 'BAD')) return route.fulfill({ status: 400, body: '{"message":"invalid input syntax"}' });
  const out = [];
  for (const r of body) { cloud.set(r.tbl + ':' + r.id, { ...r, rev: ++rev }); out.push({ tbl: r.tbl, id: r.id, updated_at: r.updated_at }); }
  return route.fulfill({ json: out });
});
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
await p.evaluate(async () => {
  const t = window.__tsena; const now = new Date().toISOString();
  const big = 'data:image/png;base64,' + 'A'.repeat(400_000);
  await t.save('orders', [{ id: 'BAD', number: 'X', kind: 'order', channel: 'shop', status: 'delivered', lines: [], payments: [], discount: 0, createdAt: now }]);
  await t.save('orders', Array.from({ length: 5 }, (_, i) => ({ id: 'V' + i, number: 'V-' + i, kind: 'order', channel: 'shop', status: 'delivered', lines: [], payments: [], discount: 0, createdAt: now })));
  await t.save('printJobs', Array.from({ length: 6 }, (_, i) => ({ id: 'J' + i, stationId: 's', status: 'done', copies: 1, doc: { title: 'T', blocks: [{ k: 'logo', src: big }] } })));
  await t.setMeta('cloud', { url: 'https://mock.supabase.co', anonKey: 'k', email: 'e@x', accessToken: 't', refreshToken: 'r', expiresAt: Date.now() + 3600e3 });
  await t.syncNow();
});
await p.waitForTimeout(1500);
ok([0, 1, 2, 3, 4].every((i) => cloud.has('orders:V' + i)), 'les 5 ventes sont arrivées dans le cloud malgré une fiche refusée');
ok([0, 1, 2, 3, 4, 5].every((i) => cloud.has('printJobs:J' + i)) && maxBody <= 1_500_000, `gros tickets envoyés par petits paquets (plus gros envoi : ${Math.round(maxBody / 1000)} ko)`);
ok(!cloud.has('orders:BAD'), 'la fiche refusée reste à part');
await p.goto('http://localhost:5173/#/parametres/cloud'); await p.waitForTimeout(500);
const tx = N(await p.locator('main').innerText());
ok(tx.includes('1 fiche(s) refusée(s) par le cloud') && tx.includes('Tout le reste est bien synchronisé') && tx.includes('invalid input syntax'), 'Paramètres → Cloud : fiche refusée affichée avec la raison');
const pending = await p.evaluate(async () => (await window.__tsena.outboxCount()));
ok(pending === 1, `seule la fiche refusée reste dans la file (${pending})`);
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); await b.close(); process.exit(fail ? 1 : 0);
