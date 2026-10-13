// Série 4 : synchronisation vérifiée (fiche refusée par le cloud → fusion et renvoi), fiche Société (seuls les champs
// modifiés partent), copies cloud contrôlées (nombre de fiches, copie incomplète signalée), page Notifications
// (voir plus, plus tard, ne plus afficher, retour si nouveau problème), compte boost du dimanche à 17 h, colonne
// « veille » du premier comptage, filtre de période et ordre des listes, boutons Annuler / Supprimer, photos à la norme.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const W = Number(process.argv[2] || 1280);
const p = await (await b.newContext({ viewport: { width: W, height: 900 }, timezoneId: 'Indian/Antananarivo' })).newPage();
const N = (t) => t.replace(/[  ]/g, ' ');
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
p.on('dialog', (d) => d.accept());

// ---- Faux cloud (même règle que le vrai : une version plus ancienne que celle du cloud est ignorée sans erreur) ----
const cloud = new Map(); let rev = 0; let race = false; const backups = [];
const FUT = Date.now() + 2 * 86400_000;
await p.route('https://mock.supabase.co/**', async (route) => {
  const req = route.request(); const url = new URL(req.url()); const m = req.method();
  const path = url.pathname.replace('/rest/v1/', ''); const q = url.searchParams;
  if (path === 'records' && m === 'GET') {
    const sel = q.get('select');
    let rows = [...cloud.values()];
    if (q.get('tbl')?.startsWith('eq.')) rows = rows.filter((r) => r.tbl === q.get('tbl').slice(3));
    if (q.get('id')) { const ids = q.get('id').replace(/^in\.\(/, '').replace(/\)$/, '').split(',').map((s) => s.replace(/"/g, '')); rows = rows.filter((r) => ids.includes(r.id)); }
    if (q.get('rev')) { const g = Number(q.get('rev').replace('gt.', '')); rows = rows.filter((r) => r.rev > g); }
    if (sel === 'rev') { rows.sort((a, c) => c.rev - a.rev); return route.fulfill({ json: rows.slice(0, 1).map((r) => ({ rev: r.rev })) }); }
    if (sel === 'id') return route.fulfill({ json: [], headers: { 'content-range': `0-0/${cloud.size}`, 'access-control-expose-headers': 'content-range' } });
    rows.sort((a, c) => a.rev - c.rev);
    return route.fulfill({ json: rows.map((r) => ({ tbl: r.tbl, id: r.id, data: r.data, rev: r.rev })) });
  }
  if (path === 'records' && m === 'POST') {
    const body = JSON.parse(req.postData()); const out = [];
    for (const r of body) {
      const k = r.tbl + ':' + r.id; const old = cloud.get(k);
      if (race && k === 'settings:company' && old) {
        // Un autre appareil (horloge en avance) modifie le téléphone juste avant notre envoi.
        race = false;
        const d = { ...old.data, phone: '034 99 999 99', _f: { ...(old.data._f || {}), phone: FUT }, _v: FUT, updatedAt: new Date(FUT).toISOString() };
        cloud.set(k, { ...old, data: d, updated_at: d.updatedAt, rev: ++rev });
      }
      const cur = cloud.get(k);
      if (cur && r.updated_at < cur.updated_at) continue; // ignoré sans rien dire
      cloud.set(k, { tbl: r.tbl, id: r.id, data: r.data, updated_at: r.updated_at, rev: ++rev });
      out.push({ tbl: r.tbl, id: r.id, updated_at: r.updated_at });
    }
    return route.fulfill({ json: out });
  }
  if (path === 'backups' && m === 'POST') { const bk = JSON.parse(req.postData()); const id = 'bk' + backups.length; backups.push({ id, ...bk, created_at: new Date().toISOString() }); return route.fulfill({ json: [{ id }] }); }
  if (path === 'backups' && m === 'GET') {
    const sel = q.get('select') || '';
    if (sel.startsWith('categories')) { const bk = backups.find((x) => 'eq.' + x.id === q.get('id')); return route.fulfill({ json: [{ categories: bk.data.categories, users: bk.data.users }] }); }
    return route.fulfill({ json: [...backups].reverse().map((x) => ({ id: x.id, created_at: x.created_at, label: x.label, device: x.device })) });
  }
  return route.fulfill({ json: [] });
});

await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
const today = await p.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
const addDays = (s, n) => { const d = new Date(`${s}T12:00:00`); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const monday = (() => { const d = new Date(`${today}T12:00:00`); const dow = (d.getDay() + 6) % 7; return addDays(today, -dow); })();
const veille = addDays(monday, -1);
await p.evaluate(async ({ today, veille }) => {
  const t = window.__tsena; const now = new Date().toISOString();
  await t.save('settings', { id: 'company', name: 'Ma boutique', address: 'Lot II A 12' });
  await t.save('categories', { id: 'lp', name: 'Lampe' });
  await t.save('products', Array.from({ length: 60 }, (_, i) => ({ id: 'a' + i, code: 'LAMP-' + i, name: 'Lampe ' + i, categoryId: 'lp', priceRetail: 10000, active: true, alertQty: 2 })));
  await t.save('variants', Array.from({ length: 60 }, (_, i) => ({ id: 'v' + i, productId: 'a' + i, sku: 'LAMP-' + i, costAvg: 4000, active: true })));
  await t.save('stockMoves', Array.from({ length: 60 }, (_, i) => ({ variantId: 'v' + i, qty: i === 0 ? 0 : 10, type: 'initial', at: now })));
  const y = new Date(Date.now() - 86400_000).toISOString();
  await t.save('cashMoves', [{ id: 'e1', at: y, account: 'cash', amount: -5000, type: 'expense', label: 'Taxi hier' }, { id: 'e2', at: now, account: 'cash', amount: -7000, type: 'expense', label: 'Eau aujourd’hui' }]);
  await t.save('orders', { id: 'O1', number: 'C-1', kind: 'order', channel: 'facebook', phone: '0340000000', status: 'new', lines: [{ id: 'l1', variantId: 'v1', qty: 1, unitPrice: 10000 }], payments: [], discount: 0, deliveryFee: 0, createdAt: now });
  // Boost en cours depuis avant la semaine, jamais compté : la colonne « veille » doit apparaître.
  await t.save('boosts', { id: 'bst', pageId: 'lp', slot: 1, label: 'Promo', startDate: '2026-09-01', status: 'active' });
  // Trois actions importantes à vérifier : texte long dans la notification.
  await t.save('audit', [1, 2, 3].map((i) => ({ id: 'au' + i, at: now, action: 'Vente annulée', details: 'Erreur de saisie ' + i, userName: 'Super-admin', level: 'high', review: 'todo' })));
}, { today, veille });

// 1. Synchronisation : fiche refusée par le cloud → fusionnée et renvoyée
await p.evaluate(async () => { await window.__tsena.setMeta('cloud', { url: 'https://mock.supabase.co', anonKey: 'k', email: 'e@x', accessToken: 't', refreshToken: 'r', expiresAt: Date.now() + 3600e3 }); await window.__tsena.syncNow(); });
await p.waitForTimeout(800);
ok(cloud.has('settings:company') && cloud.has('products:a5'), `premier envoi au cloud (${cloud.size} fiches)`);
race = true;
await p.goto('http://localhost:5173/#/parametres/societe'); await p.waitForTimeout(600);
const before = await p.evaluate(() => window.__tsena.getRaw('settings', 'company')._f?.address ?? 0);
await p.getByLabel('Nom de la société').fill('Boutique Ampandrana');
await p.getByRole('button', { name: /^Enregistrer$/ }).first().click(); await p.waitForTimeout(2500);
await p.evaluate(() => window.__tsena.syncNow()); await p.waitForTimeout(1200);
const cc = cloud.get('settings:company').data;
ok(cc.name === 'Boutique Ampandrana' && cc.phone === '034 99 999 99', `cloud : nouveau nom gardé ET téléphone de l’autre appareil gardé (${cc.name} / ${cc.phone})`);
const local = await p.evaluate(() => window.__tsena.get('settings', 'company'));
ok(local.phone === '034 99 999 99' && local.name === 'Boutique Ampandrana', 'cet appareil a reçu la modification de l’autre appareil');
ok(await p.evaluate(() => window.__tsena.outboxCount()) === 0, 'plus rien en attente d’envoi');
const after = await p.evaluate(() => window.__tsena.getRaw('settings', 'company')._f?.address ?? 0);
ok(after === before, 'fiche Société : seuls les champs modifiés sont envoyés (adresse non réécrite)');
const au = await p.evaluate(() => window.__tsena.all('audit').filter((a) => a.action === 'Paramètres').map((a) => a.details).join(' | '));
ok(au.includes('nom') && au.includes('Boutique Ampandrana'), 'journal : champs modifiés et nouveau nom notés');

// 2. Copies cloud contrôlées
await p.goto('http://localhost:5173/#/parametres/sauvegarde'); await p.waitForTimeout(600);
await p.getByRole('button', { name: 'Copier maintenant dans le cloud' }).click(); await p.waitForTimeout(2000);
ok(backups.length === 1 && /· [\d  ]+ fiches/.test(N(backups[0].label)), `copie enregistrée avec le nombre de fiches (${backups[0]?.label})`);
backups.push({ id: 'bkold', label: 'Automatique — quotidienne · 12 fiches', device: 'Téléphone Android', data: { categories: [], users: [] }, created_at: new Date(Date.now() - 86400_000).toISOString() });
await p.getByRole('button', { name: 'Voir les copies' }).click(); await p.waitForTimeout(800);
let tx = N(await p.getByRole('dialog').innerText());
ok(tx.includes('Copie incomplète') && tx.includes('12 fiches seulement'), 'copie faite par un appareil pas synchronisé : signalée « Copie incomplète »');
await p.keyboard.press('Escape'); await p.waitForTimeout(200);
ok(N(await p.locator('main').innerText()).includes('Données actuelles'), 'contrôle des copies expliqué, avec les données actuelles');

// 3. Notifications : voir plus, page dédiée, plus tard, ne plus afficher, retour si nouveau problème
await p.evaluate(async () => { await window.__tsena.setMeta('cloud', null); });
await p.goto('http://localhost:5173/#/'); await p.waitForTimeout(800);
const more = p.locator('.notif-bar').getByRole('button', { name: 'voir plus' }).first();
ok(await more.count() === 1, 'notification longue coupée avec « voir plus »');
await more.click(); await p.waitForTimeout(150);
ok(await p.locator('.notif-bar').getByRole('button', { name: 'voir moins' }).count() >= 1, '« voir plus » affiche tout le texte');
ok(await p.locator('nav, .sidebar').getByText('Notifications').count() > 0 || W < 700, 'menu « Notifications »');
await p.goto('http://localhost:5173/#/notifications'); await p.waitForTimeout(600);
tx = N(await p.locator('main').innerText());
ok(tx.includes('Notifications') && tx.includes('Stock') && tx.includes('à vérifier'), 'page Notifications : toutes les notifications');
const stockItem = p.locator('.notif', { hasText: 'Stock' }).first();
await stockItem.getByRole('button', { name: 'Ne plus afficher' }).click(); await p.waitForTimeout(400);
ok(!N(await p.locator('main').innerText()).includes('en rupture'), 'notification de stock masquée');
await p.evaluate(async () => { await window.__tsena.save('stockMoves', { variantId: 'v2', qty: -10, type: 'adjust', at: new Date().toISOString() }); });
await p.waitForTimeout(500);
ok(N(await p.locator('main').innerText()).includes('2 en rupture'), 'nouveau problème (2e rupture) : la notification revient');
const audItem = p.locator('.notif', { hasText: 'à vérifier' }).first();
await audItem.getByRole('button', { name: 'Plus tard' }).click(); await audItem.getByRole('button', { name: 'Dans 3 h' }).click(); await p.waitForTimeout(400);
tx = N(await p.locator('main').innerText());
ok(tx.includes('Reportées') && tx.includes('Reportée — revient'), 'notification reportée de 3 h');
await p.getByRole('button', { name: /Voir les notifications masquées/ }).click(); await p.waitForTimeout(200);
ok(N(await p.locator('main').innerText()).includes('1 en rupture'), 'liste des notifications masquées, avec « Réafficher »');

// 4. Compte boost : dimanche à 17 h le jour même ; colonne « veille »
await p.goto('http://localhost:5173/#/parametres/societe'); await p.waitForTimeout(500);
ok(await p.getByLabel('Heure limite compte boost dimanche').inputValue() === '17:00', 'dimanche : heure limite 17:00, le jour même');
await p.goto('http://localhost:5173/#/boosts/suivi'); await p.waitForTimeout(600);
await p.getByLabel('Page').first().selectOption('lp').catch(() => {}); await p.waitForTimeout(400);
ok(N(await p.locator('main').innerText()).includes('veille'), 'premier comptage : colonne « veille » (dimanche avant la semaine)');
const ddv = (s) => s.slice(8, 10) + '/' + s.slice(5, 7);
await p.getByLabel(`Conversations boost 1 ${ddv(veille)} (veille)`).fill('100'); await p.keyboard.press('Tab'); await p.waitForTimeout(400);
await p.getByLabel(`Conversations boost 1 ${ddv(monday)}`, { exact: true }).fill('120'); await p.keyboard.press('Tab'); await p.waitForTimeout(500);
const mon = await p.evaluate(() => window.__tsena.all('boostReadings').map((r) => r.date + ':' + r.messages).sort().join(','));
tx = N(await p.locator('.boost-week').innerText());
ok(tx.includes('+20') && mon.includes(':100') && mon.includes(':120'), `lundi déjà juste : +20 (veille 100 → lundi 120) [${mon}]`);
await p.goto('http://localhost:5173/#/boosts/suivi'); await p.waitForTimeout(300);

// 5. Filtre de période et ordre
await p.goto('http://localhost:5173/#/depenses/liste'); await p.waitForTimeout(500);
await p.getByLabel('Période').first().selectOption('yesterday'); await p.waitForTimeout(300);
tx = N(await p.locator('main').innerText());
ok(tx.includes('Taxi hier') && !tx.includes('Eau aujourd’hui'), 'dépenses : filtre « Hier »');
const opts = await p.getByLabel('Période').first().locator('option').allInnerTexts();
ok(['Hier', "Aujourd'hui", 'Demain', 'Jour défini…', 'Période (du … au …)'].every((o) => opts.includes(o)), 'choix : hier, aujourd’hui, demain, jour défini, période');
await p.getByLabel('Période').first().selectOption('day'); await p.waitForTimeout(200);
ok(await p.getByLabel('Jour').count() === 1, '« Jour défini » : un seul jour à choisir');
for (const [path, name] of [['/commandes', 'commandes'], ['/achats', 'achats'], ['/receptions', 'réceptions'], ['/clients', 'clients'], ['/stock/mouvements', 'mouvements de stock'], ['/vente', 'ventes']]) {
  await p.goto('http://localhost:5173/#' + path); await p.waitForTimeout(450);
  const o = p.getByLabel('Ordre');
  ok(await o.count() >= 1 && (await o.first().locator('option').allInnerTexts()).includes('Plus ancien d’abord'), `${name} : période + plus récent / plus ancien d’abord`);
}
await p.goto('http://localhost:5173/#/articles'); await p.waitForTimeout(400);
ok(N(await p.locator('main').innerText()).includes('Ordre (date d’ajout)'), 'articles : filtre par date d’ajout');

// 6. Boutons Annuler / Supprimer bien visibles
await p.goto('http://localhost:5173/#/commandes/O1'); await p.waitForTimeout(500);
const cls = await p.getByRole('button', { name: 'Annuler / supprimer' }).getAttribute('class');
ok(cls.includes('btn-danger') && await p.getByRole('button', { name: 'Annuler / supprimer' }).locator('svg').count() === 1, 'bouton « Annuler / supprimer » rouge avec icône');

// 7. Photos ramenées à la norme
await p.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 1400; c.height = 1400; const x = c.getContext('2d');
  for (let i = 0; i < 4000; i++) { x.fillStyle = `hsl(${i % 360},70%,${30 + (i % 40)}%)`; x.fillRect(Math.random() * 1400, Math.random() * 1400, 60, 60); }
  await window.__tsena.save('products', { id: 'a3', photo: c.toDataURL('image/png') });
});
const big = await p.evaluate(() => window.__tsena.get('products', 'a3').photo.length);
await p.evaluate(() => window.__tsena.optimizePhotos()); await p.waitForTimeout(300);
const ph = await p.evaluate(() => window.__tsena.get('products', 'a3').photo);
const kb = Math.round((ph.length - ph.indexOf(',')) * 0.75 / 1024);
ok(ph.startsWith('data:image/jpeg') && kb <= 58 && kb >= 10, `photo lourde (${Math.round(big * 0.75 / 1024)} Ko PNG) ramenée à ${kb} Ko JPEG`);
const dims = await p.evaluate((src) => new Promise((r) => { const i = new Image(); i.onload = () => r([i.width, i.height]); i.src = src; }), ph);
ok(Math.max(...dims) <= 600 && Math.max(...dims) >= 300, `taille ${dims.join('×')} px (norme 600 px, photo reconnaissable)`);

const sw = await p.evaluate(() => document.documentElement.scrollWidth); ok(sw <= W + 1, `pas de débordement (${sw})`);
console.log(fail ? `${fail} ÉCHEC(S)` : 'TOUT EST BON'); await b.close();
