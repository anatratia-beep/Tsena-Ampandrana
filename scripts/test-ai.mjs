// Tests de l'assistant IA (fonction cloud ai-chat) sans le vrai serveur IA ni Supabase :
//   - Postgres local (variable AI_TEST_PG, ex. postgres://postgres@localhost:5432/postgres) : base de test recréée,
//     supabase/schema.sql puis supabase/ai.sql ;
//   - deux faux serveurs IA (tests/ai/fake-llm.mjs) : « local » sans clé, « en ligne » avec clé.
//   node scripts/test-ai.mjs
import * as esbuild from 'esbuild';
import { readFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import postgres from 'postgres';
import { fakeLlm } from '../tests/ai/fake-llm.mjs';

const root = new URL('..', import.meta.url).pathname;
let fail = 0, pass = 0;
const ok = (c, m, extra) => { if (c) pass++; else fail++; console.log((c ? 'OK   ' : 'FAIL ') + m + (!c && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 400) : '')); };

// ---------- Base de test ----------
const PG = process.env.AI_TEST_PG || 'postgres://postgres@localhost:5433/postgres';
const admin = postgres(PG, { onnotice: () => {} });
await admin.unsafe('drop database if exists tsena_ai_test with (force)');
await admin.unsafe('create database tsena_ai_test');
for (const r of ['anon', 'authenticated', 'service_role']) await admin.unsafe(`do $$ begin if not exists (select 1 from pg_roles where rolname = '${r}') then create role ${r} nologin; end if; end $$`);
await admin.end();
const url = PG.replace(/\/postgres(\?|$)/, '/tsena_ai_test$1');
const sql = postgres(url, { onnotice: () => {}, max: 4 });
await sql.unsafe(readFileSync(join(root, 'supabase/schema.sql'), 'utf8'));
await sql.unsafe(readFileSync(join(root, 'supabase/ai.sql'), 'utf8'));
await sql.unsafe(readFileSync(join(root, 'supabase/ai.sql'), 'utf8')); // relançable
ok(true, 'schema.sql + ai.sql installés (2 fois)');

// Données : 2 pages, 2 articles, ventes cette semaine et la semaine dernière, 3 utilisateurs.
const T = (d, h = '10:00') => `${d}T${h}:00+03:00`;
const now = new Date();
const mg = new Date(now.getTime() + 3 * 3600_000);
const today = mg.toISOString().slice(0, 10);
const dow = (mg.getUTCDay() + 6) % 7;
const addD = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const monday = addD(today, -dow);
const lastWeek = addD(monday, -7 + Math.min(dow, 5));
const rec = (tbl, id, data) => ({ tbl, id, data: { id, createdAt: data.createdAt ?? T(addD(today, -30)), updatedAt: T(today, '08:00'), ...data } });
const line = (id, v, q, p) => ({ id, variantId: v, qty: q, unitPrice: p, qtyKept: q });
const rows = [
  rec('settings', 'company', { name: 'Tsena Ampandrana' }),
  rec('settings', 'ai', { enabled: true, localUrl: 'http://127.0.0.1:18801/v1', onlineUrl: 'http://127.0.0.1:18802/v1', model: 'qwen3.8-27b' }),
  rec('categories', 'pa', { name: 'Pyjamas' }), rec('categories', 'pb', { name: 'Boxer' }),
  rec('products', 'p1', { code: 'PYJ1', name: 'Pyjama rayé', categoryId: 'pa', priceRetail: 15000, alertQty: 3, active: true }),
  rec('products', 'p2', { code: 'BOX1', name: 'Boxer noir', categoryId: 'pb', priceRetail: 5000, alertQty: 5, active: true }),
  rec('variants', 'v1', { productId: 'p1', sku: 'PYJ1-M', size: 'M', costAvg: 5000, active: true }),
  rec('variants', 'v2', { productId: 'p2', sku: 'BOX1-L', size: 'L', costAvg: 2000, active: true }),
  rec('stockMoves', 'm1', { variantId: 'v1', qty: 10, type: 'initial', at: T(addD(today, -30)) }),
  rec('stockMoves', 'm2', { variantId: 'v2', qty: 4, type: 'initial', at: T(addD(today, -30)) }),
  rec('stockMoves', 'm3', { variantId: 'v1', qty: -3, type: 'sale', at: T(today) }),
  rec('stockMoves', 'm4', { variantId: 'v2', qty: -3, type: 'sale', at: T(today) }),
  rec('couriers', 'c1', { name: 'Rado', active: true }),
  rec('orders', 'o1', { number: 'V-001', kind: 'order', channel: 'shop', phone: '', status: 'delivered', lines: [line('l1', 'v1', 2, 15000)], payments: [{ id: 'y1', at: T(today), amount: 30000, method: 'cash', receivedBy: 'shop' }], discount: 0, deliveryFee: 0, createdAt: T(today), createdBy: 'u-admin', createdByName: 'Anja' }),
  rec('orders', 'o2', { number: 'V-002', kind: 'order', channel: 'shop', phone: '', status: 'delivered', lines: [line('l2', 'v2', 3, 5000)], payments: [{ id: 'y2', at: T(today), amount: 15000, method: 'mvola', receivedBy: 'shop' }], discount: 0, deliveryFee: 0, createdAt: T(today, '11:30'), createdBy: 'u-seller', createdByName: 'Hery' }),
  rec('orders', 'o3', { number: 'V-003', kind: 'order', channel: 'shop', phone: '', status: 'delivered', lines: [line('l3', 'v1', 1, 15000)], payments: [], discount: 0, deliveryFee: 0, createdAt: T(lastWeek) }),
  rec('orders', 'o4', { number: 'C-004', kind: 'order', channel: 'facebook', phone: '0340000001', name: 'Fara', status: 'out', courierId: 'c1', lines: [{ id: 'l4', variantId: 'v1', qty: 1, unitPrice: 15000 }], payments: [], discount: 0, deliveryFee: 3000, createdAt: T(today, '09:00'), dispatchedAt: T(today, '13:00'), createdBy: 'u-admin', createdByName: 'Anja' }),
  rec('users', 'u-admin', { username: 'anja', fullName: 'Anja', roleId: 'role-admin', active: true, passwordHash: 'SECRET-HASH' }),
  rec('users', 'u-seller', { username: 'hery', fullName: 'Hery', roleId: 'role-seller', pageIds: ['pb'], active: true, passwordHash: 'SECRET-HASH' }),
  rec('users', 'u-courier', { username: 'rado', fullName: 'Rado', roleId: 'role-courier', courierId: 'c1', active: true }),
  rec('users', 'u-off', { username: 'old', fullName: 'Ancien', roleId: 'role-admin', active: false }),
  rec('audit', 'a1', { at: T(today, '07:55'), action: 'Connexion', details: '', userId: 'u-seller', userName: 'Hery' }),
  rec('audit', 'a2', { at: T(today, '16:40'), action: 'Vente', details: '', userId: 'u-seller', userName: 'Hery' }),
];
for (const r of rows) await sql`insert into public.records (tbl, id, data, updated_at) values (${r.tbl}, ${r.id}, ${sql.json(r.data)}, now())`;

// ---------- Sécurité de la base ----------
{
  const ro = (q) => sql.begin('read only', async (tx) => { await tx`set local role ai_reader`; return tx.unsafe(q); }).then(() => 'ok', (e) => e.message);
  ok(/permission denied/.test(await ro('select * from public.records')), 'ai_reader ne lit pas public.records');
  ok(/permission denied/.test(await ro('select * from ai.secrets')), 'ai_reader ne lit pas ai.secrets');
  ok(/read-only|permission/.test(await ro("insert into public.records(tbl,id,data,updated_at) values ('x','y','{}',now())")), 'ai_reader ne peut pas écrire');
  const users = await sql.begin('read only', async (tx) => { await tx`set local role ai_reader`; return tx`select data from ai.data where tbl = 'users'`; });
  ok(users.length >= 3 && users.every((u) => !('passwordHash' in u.data)), 'ai.data : sans les mots de passe');
  const priv = await sql`select has_schema_privilege('anon', 'ai', 'usage') as a, has_schema_privilege('authenticated', 'ai', 'usage') as b`;
  ok(!priv[0].a && !priv[0].b, 'schéma ai invisible pour anon / authenticated');
}

// ---------- Fonction ----------
const out = join(mkdtempSync(join(tmpdir(), 'tsena-ai-')), 'ai.mjs');
await esbuild.build({ entryPoints: [join(root, 'tests/ai/entry.ts')], bundle: true, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'], jsx: 'automatic', loader: { '.md': 'text' }, outfile: out, logLevel: 'error', nodePaths: [join(root, 'node_modules')], define: { __APP_VERSION__: '"t"', __BUILD_DATE__: '"t"', 'process.env.NODE_ENV': '"production"' } });
const AI = await import(pathToFileURL(out).href);

// Filtre du raisonnement
{
  const f = new AI.ThinkFilter(); let s = '';
  for (const c of ['Bon', 'jour <th', 'ink>caché</thi', 'nk> à ', 'vous']) s += f.push(c);
  s += f.flush();
  ok(s === 'Bonjour  à vous', '<think> coupé en morceaux retiré', s);
  ok(AI.stripThink('raisonnement sans balise</think>Réponse') === 'Réponse', '</think> sans ouverture : seul le texte après est gardé');
}
// Contrôle SQL
for (const [q, good] of [['select 1', true], ['WITH x AS (select 1) select * from x', true], ['select 1; delete from ai.data', false], ['delete from ai.data', false], ["select pg_sleep(20)", false], ["select 'update' as mot", true], ['update ai.data set id = 1', false], ['with d as (delete from x returning *) select 1', false]])
  ok(AI.checkSelect(q).ok === good, `SQL ${good ? 'accepté' : 'refusé'} : ${q}`);
// Historique tronqué
{
  const hist = Array.from({ length: 60 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `message ${i} ` + 'x'.repeat(3000) }));
  const m = AI.fitHistory('système', '[]', hist);
  const total = m.reduce((t, x) => t + AI.tokens(x.content), 0);
  ok(m[0].role === 'system' && m[1].role === 'user' && m[m.length - 1].content.startsWith('message 59') && total < 32768 - 8192, `historique tronqué (${m.length - 1} messages gardés, ~${total} tokens)`);
}

const KEY = 'sk-test-SECRETE-123';
const local = await fakeLlm({ port: 18801 });
const online = await fakeLlm({ port: 18802, key: KEY });
const handle = AI.createHandler({ sql, supabaseUrl: 'http://x', anonKey: 'x', verifyToken: async (t) => t === 'jeton-ok' });
const call = (body, token = 'jeton-ok') => handle(new Request('http://f/ai-chat', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }));
const j = async (r) => ({ status: r.status, body: await r.json() });
async function chat(userId, question, history = []) {
  const r = await call({ action: 'chat', userId, messages: [...history, { role: 'user', content: question }] });
  if (r.status !== 200) return { status: r.status, body: await r.json() };
  const raw = await r.text();
  const ev = raw.split('\n\n').filter((x) => x.startsWith('data: ')).map((x) => JSON.parse(x.slice(6)));
  let text = '';
  for (const e of ev) { if (e.type === 'delta') text += e.text; if (e.type === 'replace') text = e.text; }
  return { status: 200, raw, ev, text, via: ev.find((e) => e.type === 'meta')?.via, tools: ev.filter((e) => e.type === 'tool').map((e) => e.name) };
}

ok((await call({ action: 'status', userId: 'u-admin' }, 'mauvais')).status === 401, 'jeton refusé → 401');
ok((await j(await call({ action: 'status', userId: 'u-off' }))).status === 403, 'utilisateur désactivé → 403');
{
  const s = await j(await call({ action: 'status', userId: 'u-admin' }));
  ok(s.status === 200 && s.body.enabled && !s.body.hasKey && s.body.admin, 'status : activé, pas de clé, admin', s);
  ok((await call({ action: 'set_key', userId: 'u-seller', apiKey: 'x' })).status === 403, 'set_key refusé au vendeur');
  ok((await call({ action: 'test', userId: 'u-seller' })).status === 403, 'test refusé au vendeur');
  const k = await j(await call({ action: 'set_key', userId: 'u-admin', apiKey: KEY }));
  ok(k.body.ok && k.body.hasKey, 'clé enregistrée par l’admin');
  const s2 = await call({ action: 'status', userId: 'u-admin' }); const t2 = await s2.text();
  ok(JSON.parse(t2).hasKey && !t2.includes(KEY), 'status : « clé enregistrée » sans jamais renvoyer la clé');
  const [row] = await sql`select value from ai.secrets where id = 'api_key'`;
  ok(row?.value === KEY, 'clé stockée dans ai.secrets');
}
{
  const t = await j(await call({ action: 'test', userId: 'u-admin' }));
  ok(t.body.ok && t.body.via === 'local' && t.body.modelFound && t.body.ms >= 0, 'test de connexion : Local + temps de réponse', t.body);
  local.state.down = true; AI.forgetChoice();
  const t2 = await j(await call({ action: 'test', userId: 'u-admin' }));
  ok(t2.body.ok && t2.body.via === 'online' && t2.body.local, 'test : local coupé → En ligne', t2.body);
  const t3 = await j(await call({ action: 'test', userId: 'u-admin', apiKey: 'mauvaise' }));
  ok(!t3.body.ok && /401/.test(t3.body.online) && !JSON.stringify(t3.body).includes(KEY), 'test : mauvaise clé → 401 indiqué', t3.body);
  local.state.down = false; AI.forgetChoice();
}
// Conversation simple (local)
{
  const c = await chat('u-admin', 'Bonjour, comment vendre sur place ?');
  ok(c.status === 200 && c.via === 'local' && /Vente sur place/.test(c.text), 'réponse en streaming via Local', c.text);
  ok(!/SECRET/.test(c.raw), 'aucun raisonnement transmis (reasoning_content et <think>)');
  ok(c.ev.some((e) => e.type === 'thinking') && c.ev.at(-1).type === 'done', 'indicateur « réfléchit » puis fin');
  const sys = local.state.requests.at(-1).messages[0].content;
  ok(/Anja/.test(sys) && /Admin \/ Gérant/.test(sys) && /Tsena Ampandrana/.test(sys) && sys.includes(today), 'prompt : utilisateur, rôle, société, date du jour');
  ok(/Comment faire/.test(sys) && /Vocabulaire/.test(sys), 'prompt : AI_CONTEXT.md intégré');
}
// Outils : ventes de la semaine (admin)
{
  const c = await chat('u-admin', 'Combien de ventes cette semaine par rapport à la semaine dernière ?');
  const res = JSON.parse(local.state.requests.at(-1).messages.at(-1).content);
  ok(c.tools[0] === 'ventes_resume' && res.nb_ventes === 3 && res.chiffre_affaires_net === 60000, 'ventes_resume : 3 ventes, 60 000 Ar (sur place + livraison partie)', res);
  ok(res.periode_precedente?.du === addD(monday, -7) && res.periode_precedente?.au === addD(today, -7) && res.periode_precedente.nb_ventes === 1 && res.marge_brute === 60000 - 2 * 5000 - 3 * 2000 - 5000, 'comparaison avec les mêmes jours de la semaine dernière, et marge (droit prix d’achat)', res);
}
// Mêmes questions pour le vendeur limité à la page Boxer
{
  await chat('u-seller', 'Combien de ventes cette semaine ?');
  const req = local.state.requests.at(-1);
  const res = JSON.parse(req.messages.at(-1).content);
  ok(res.chiffre_affaires_net === 15000 && res.nb_ventes === 1 && res.marge_brute === undefined, 'vendeur : seulement sa page (15 000 Ar), sans marge', res);
  const names = req.tools.map((t) => t.function.name);
  ok(!names.includes('requete_sql') && !names.includes('tresorerie') && !names.includes('depenses'), 'vendeur : pas de SQL, trésorerie ni dépenses', names);
  const forced = JSON.parse(await AI.runTool(AI.ctxFor(AI.get('users', 'u-seller'), sql), 'tresorerie', '{}'));
  ok(/accès refusé/.test(forced.erreur), 'outil interdit appelé quand même → accès refusé');
  const other = JSON.parse(await AI.runTool(AI.ctxFor(AI.get('users', 'u-seller'), sql), 'ventes_resume', '{"page":"Pyjamas"}'));
  ok(/pas accès/.test(other.erreur), 'vendeur : pas accès à une autre page');
  const cmd = JSON.parse(await AI.runTool(AI.ctxFor(AI.get('users', 'u-seller'), sql), 'commandes', '{"periode":"cette_semaine","statut":"tous"}'));
  ok(cmd.commandes.every((o) => o.numero === 'V-002'), 'vendeur : seulement les commandes de sa page', cmd.commandes);
  const act = JSON.parse(await AI.runTool(AI.ctxFor(AI.get('users', 'u-seller'), sql), 'activite_utilisateurs', '{}'));
  ok(act.lignes.length === 1 && act.lignes[0].utilisateur === 'Hery' && act.lignes[0].premiere_action === '07:55' && act.lignes[0].derniere_action === '16:40', 'vendeur : seulement sa propre activité (07:55 → 16:40)', act);
}
// Livreur
{
  const cx = AI.ctxFor(AI.get('users', 'u-courier'), sql);
  const names = AI.toolsFor(cx).map((t) => t.function.name);
  ok(!names.includes('ventes_resume') && names.includes('livreurs') && names.includes('commandes'), 'livreur : pas de ventes, ses livraisons et colis', names);
  const cmd = JSON.parse(await AI.runTool(cx, 'commandes', '{"periode":"cette_semaine","statut":"tous"}'));
  ok(cmd.commandes.length === 1 && cmd.commandes[0].numero === 'C-004', 'livreur : seulement ses colis', cmd);
}
// Heures de travail (admin), produits les plus vendus, stock
{
  const cx = AI.ctxFor(AI.get('users', 'u-admin'), sql);
  const act = JSON.parse(await AI.runTool(cx, 'activite_utilisateurs', '{"periode":"aujourdhui"}'));
  ok(act.lignes.some((l) => l.utilisateur === 'Hery' && l.duree === '8 h 45') && act.lignes.some((l) => l.utilisateur === 'Anja'), 'heures de travail estimées de chaque utilisateur', act.lignes);
  const top = JSON.parse(await AI.runTool(cx, 'meilleurs_articles', '{"periode":"ce_mois"}'));
  ok(top.articles[0].article === 'Pyjama rayé' && top.articles[0].quantite >= 3, 'articles les plus vendus du mois', top.articles);
  const st = JSON.parse(await AI.runTool(cx, 'stock_articles', '{"filtre":"alerte"}'));
  ok(st.articles.length === 1 && st.articles[0].article === 'Boxer noir' && st.articles[0].stock === 1, 'stock en alerte (Boxer : 1 ≤ 5)', st);
  const sr = JSON.parse(await AI.runTool(cx, 'stock_articles', '{"filtre":"bientot_rupture"}'));
  ok(sr.articles.some((a) => a.article === 'Boxer noir'), 'bientôt en rupture', sr);
}
// SQL de secours (admin)
{
  const c = await chat('u-admin', 'Fais une requête sql pour compter les fiches');
  const res = JSON.parse(local.state.requests.at(-1).messages.at(-1).content);
  ok(c.tools[0] === 'requete_sql' && res.lignes > 3 && res.resultat.some((r) => r.tbl === 'orders'), 'requete_sql : SELECT exécuté', res);
  await chat('u-admin', 'requete sql insert');
  const res2 = JSON.parse(local.state.requests.at(-1).messages.at(-1).content);
  ok(/interdit|SELECT/.test(res2.erreur), 'requete_sql : INSERT refusé', res2);
  await chat('u-admin', 'requete sql sur les secrets');
  const res3 = JSON.parse(local.state.requests.at(-1).messages.at(-1).content);
  ok(/permission denied/.test(res3.erreur), 'requete_sql : ai.secrets illisible', res3);
}
// Bascule
{
  local.state.down = true;
  const c = await chat('u-admin', 'Bonjour');
  ok(c.via === 'online' && /Vente sur place/.test(c.text), 'local coupé en cours de route → bascule En ligne et nouvel essai', c);
  online.state.failChat = 1; local.state.down = false; AI.forgetChoice();
  const before = local.state.requests.length;
  const c2 = await chat('u-admin', 'Bonjour');
  ok(c2.via === 'local' && local.state.requests.length === before + 1, 'retour au local après revérification', c2.via);
  local.state.down = true; online.state.down = true; AI.forgetChoice();
  const c3 = await chat('u-admin', 'Bonjour');
  const err = c3.ev?.find((e) => e.type === 'error');
  ok(err && /momentanément indisponible/.test(err.message), 'local ET en ligne coupés → message clair', c3.ev);
  local.state.down = false; online.state.down = false; AI.forgetChoice();
}
// Désactivation
{
  await sql`update public.records set data = data || '{"enabled": false}'::jsonb where tbl = 'settings' and id = 'ai'`;
  await new Promise((r) => setTimeout(r, 3100));
  const r = await call({ action: 'chat', userId: 'u-admin', messages: [{ role: 'user', content: 'Bonjour' }] });
  ok(r.status === 403, 'IA désactivée dans les réglages → refus');
}

await local.close(); await online.close(); await sql.end();
console.log(`\n${pass} OK, ${fail} échec(s)`);
process.exit(fail ? 1 : 0);
