// Étiquette du colis : aucun prix ni montant (le livreur a les montants sur sa feuille de livraisons).
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 1280, height: 1000 }, timezoneId: 'Indian/Antananarivo' })).newPage();
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
const r = await p.evaluate(async () => {
  const t = window.__tsena; const now = new Date().toISOString();
  const v = t.all('variants')[0] || { id: 'none' };
  const base = { kind: 'order', channel: 'online', status: 'ready', name: 'Rasoa', phone: '0341234567', place: 'Ampandrana', createdAt: now, discount: 3000, deliveryFee: 5000,
    lines: [{ id: 'l1', variantId: v.id, qty: 2, unitPrice: 45000 }] };
  const txt = (o) => o.blocks.map((x) => [x.s, x.l, x.r].filter(Boolean).join(' ')).join('\n');
  const company = t.get('settings', 'company') || {};
  const a = t.print.parcelLabelDoc({ ...base, id: 'E1', number: 'C-1', payments: [{ method: 'mvola', amount: 20000, at: now }] }, company);
  const c = t.print.parcelLabelDoc({ ...base, id: 'E2', number: 'C-2', payments: [{ method: 'cash', amount: 92000, at: now }] }, company);
  const d = t.print.deliveryNoteDoc ? txt(t.print.deliveryNoteDoc({ ...base, id: 'E3', number: 'C-3', payments: [] }, company)) : '';
  return { a: txt(a), c: txt(c), d };
});
console.log(r.a);
ok(!/\bAr\b|ENCAISSER|Remise|Frais|payé|45\s?000|92\s?000|74\s?000|20\s?000/i.test(r.a), 'étiquette à encaisser : aucun prix ni montant');
ok(r.a.includes('Rasoa') && r.a.includes('C-1') && /2 x /.test(r.a), 'client, numéro et articles toujours affichés');
ok(r.c.includes('DEJA PAYE') && !/\bAr\b/.test(r.c), 'étiquette déjà payée : « DEJA PAYE » sans montant');
ok(!r.d || /\bAr\b/.test(r.d), 'bon de livraison : montants inchangés');
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); await b.close(); process.exit(fail ? 1 : 0);
