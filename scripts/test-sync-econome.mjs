// Synchronisation économe : un appareil ne re-télécharge plus le contenu des fiches déjà reçues (avant : ~50 fiches
// complètes à chaque passage, toutes les 15 s, ce qui épuisait le quota du cloud). Les vraies modifications arrivent
// toujours, y compris deux modifications du même article sur deux appareils (fusion).
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const cloud = new Map(); let rev = 0; let dataBytes = 0;
const route = async (rt) => {
  const req = rt.request(); const url = new URL(req.url()); const q = url.searchParams;
  if (req.method() === 'GET') {
    let rows = [...cloud.values()];
    for (const f of url.searchParams.getAll('rev')) { const [op, v] = f.split('.'); rows = rows.filter((r) => (op === 'gt' ? r.rev > +v : op === 'lte' ? r.rev <= +v : true)); }
    if (q.get('tbl')) rows = rows.filter((r) => r.tbl === q.get('tbl').replace('eq.', ''));
    if (q.get('id')) { const ids = q.get('id').replace(/^in\.\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, '')); rows = rows.filter((r) => ids.includes(r.id)); }
    const sel = (q.get('select') || '').split(',');
    rows = (q.get('order') === 'rev.desc' ? rows.sort((a, c) => c.rev - a.rev) : rows.sort((a, c) => a.rev - c.rev)).slice(0, Number(q.get('limit') || 1e9));
    const out = rows.map((r) => Object.fromEntries(sel.map((k) => [k, r[k]])));
    if (sel.includes('data')) dataBytes += JSON.stringify(out).length;
    return rt.fulfill({ json: out });
  }
  const body = JSON.parse(req.postData() || '[]'); const out = [];
  for (const r of body) { const old = cloud.get(r.tbl + ':' + r.id); if (old && r.updated_at < old.updated_at) continue; const row = { ...r, rev: ++rev }; cloud.set(r.tbl + ':' + r.id, row); out.push({ tbl: r.tbl, id: r.id, updated_at: r.updated_at, rev: row.rev }); }
  return rt.fulfill({ json: out });
};
const device = async () => {
  const p = await (await b.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Indian/Antananarivo' })).newPage();
  p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
  await p.route('https://mock.supabase.co/**', route);
  await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
  await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
  await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
  await p.evaluate(async () => { await window.__tsena.setMeta('cloud', { url: 'https://mock.supabase.co', anonKey: 'k', email: 'e@x', accessToken: 't', refreshToken: 'r', expiresAt: Date.now() + 3600e3 }); });
  return p;
};
const sync = (p) => p.evaluate(async () => { await window.__tsena.syncNow(); });
const A = await device(), B = await device();
await A.evaluate(async () => { const now = new Date().toISOString(); await window.__tsena.save('orders', Array.from({ length: 80 }, (_, i) => ({ id: 'V' + i, number: 'V-' + i, kind: 'order', channel: 'shop', status: 'delivered', lines: [], payments: [], discount: 0, note: 'x'.repeat(2000), createdAt: now }))); });
await sync(A); await sync(B); await sync(A);
const count = (p) => p.evaluate(() => window.__tsena.all('orders').filter((o) => o.id.startsWith('V')).length);
ok(await count(B) === 80, 'B reçoit les 80 commandes de A');
dataBytes = 0;
for (let i = 0; i < 4; i++) { await sync(A); await sync(B); }
ok(dataBytes < 5000, `rien de nouveau : presque aucun contenu re-téléchargé (${dataBytes} octets ; avant : ~100 fiches complètes à chaque passage)`);
await A.evaluate(async () => { await window.__tsena.save('orders', { id: 'V5', note: 'modifié par A' }); });
await sync(A); await sync(B);
ok(await B.evaluate(() => window.__tsena.get('orders', 'V5').note) === 'modifié par A', 'une modification faite sur A arrive sur B');
// Même commande modifiée sur les deux appareils (champs différents) : chacun garde les deux modifications.
await A.evaluate(async () => { await window.__tsena.save('orders', { id: 'V7', note: 'note A' }); });
await B.waitForTimeout(20);
await B.evaluate(async () => { await window.__tsena.save('orders', { id: 'V7', phone: '0341111111' }); });
await sync(A); await sync(B); await sync(A); await sync(B);
const va = await A.evaluate(() => window.__tsena.get('orders', 'V7')), vb = await B.evaluate(() => window.__tsena.get('orders', 'V7'));
ok(va.note === 'note A' && va.phone === '0341111111' && vb.note === 'note A' && vb.phone === '0341111111', `fusion : les deux appareils ont la note de A et le téléphone de B (A: ${va.note}/${va.phone} · B: ${vb.note}/${vb.phone})`);
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); await b.close(); process.exit(fail ? 1 : 0);
