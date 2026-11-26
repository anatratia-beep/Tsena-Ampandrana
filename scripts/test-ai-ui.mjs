// Test dans le navigateur de l'assistant IA (réglages + bulle), avec un faux cloud qui sert la VRAIE fonction ai-chat
// (Postgres local + faux serveurs IA). Prérequis : npm run build, Postgres local (AI_TEST_PG), Playwright.
//   PLAYWRIGHT=/chemin/playwright-core node scripts/test-ai-ui.mjs [dossier-captures]
import * as esbuild from 'esbuild';
import { createServer } from 'node:http';
import { readFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import postgres from 'postgres';
import { fakeLlm } from '../tests/ai/fake-llm.mjs';

const root = new URL('..', import.meta.url).pathname;
const shots = process.argv[2] || mkdtempSync(join(tmpdir(), 'ai-shots-'));
mkdirSync(shots, { recursive: true });
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright-core');
let fail = 0, pass = 0;
const ok = (c, m, x) => { if (c) pass++; else fail++; console.log((c ? 'OK   ' : 'FAIL ') + m + (!c && x !== undefined ? ' → ' + String(x).slice(0, 300) : '')); };

// Base : on reprend celle de scripts/test-ai.mjs (relancer ce test d'abord), avec l'IA réactivée.
const PG = (process.env.AI_TEST_PG || 'postgres://postgres@localhost:5433/postgres').replace(/\/postgres$/, '/tsena_ai_test');
const sql = postgres(PG, { onnotice: () => {}, max: 4 });
await sql`update public.records set data = data || '{"enabled": true}'::jsonb where tbl = 'settings' and id = 'ai'`;
await sql`delete from ai.secrets`;

const out = join(mkdtempSync(join(tmpdir(), 'ai-ui-')), 'ai.mjs');
await esbuild.build({ entryPoints: [join(root, 'tests/ai/entry.ts')], bundle: true, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'], jsx: 'automatic', loader: { '.md': 'text' }, outfile: out, logLevel: 'error', nodePaths: [join(root, 'node_modules')], define: { __APP_VERSION__: '"t"', __BUILD_DATE__: '"t"', 'process.env.NODE_ENV': '"production"' } });
const AI = await import(pathToFileURL(out).href);
const KEY = 'sk-ui-SECRETE';
const local = await fakeLlm({ port: 18801 });
const online = await fakeLlm({ port: 18802, key: KEY });
const handle = AI.createHandler({ sql, supabaseUrl: 'x', anonKey: 'x', verifyToken: async (t) => t === 'tok' });

// Faux cloud : fonction ai-chat (vraie), REST minimal pour la synchro, application construite (dist/).
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const srv = createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/functions/v1/ai-chat')) {
    let body = ''; for await (const c of req) body += c;
    const r = await handle(new Request('http://x' + req.url, { method: req.method, headers: req.headers, body: req.method === 'POST' ? body : undefined }));
    res.writeHead(r.status, Object.fromEntries(r.headers));
    if (r.body) { const rd = r.body.getReader(); for (;;) { const { done, value } = await rd.read(); if (done) break; res.write(value); } }
    res.end(); return;
  }
  if (u.pathname.startsWith('/rest/') || u.pathname.startsWith('/auth/')) {
    let body = ''; for await (const c of req) body += c;
    res.writeHead(req.method === 'OPTIONS' ? 204 : 200, { ...CORS, 'content-type': 'application/json' });
    res.end(req.method === 'POST' && body.startsWith('[') ? JSON.stringify(JSON.parse(body).map((r, i) => ({ tbl: r.tbl, id: r.id, updated_at: r.updated_at, rev: 1000 + i }))) : '[]'); return;
  }
  let p = u.pathname; if (p.endsWith('/')) p += 'index.html';
  try { const b = readFileSync(join(root, 'dist', p)); res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' }); res.end(b); }
  catch { res.writeHead(404); res.end(); }
}).listen(18900);

const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, timezoneId: 'Indian/Antananarivo', locale: 'fr-FR' });
const p = await ctx.newPage();
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
await p.goto('http://localhost:18900/'); await p.waitForTimeout(800);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
ok(!(await p.locator('.ai-fab').count()), 'bulle cachée tant que l’IA n’est pas activée');
// Appareil « relié » au faux cloud.
await p.evaluate(() => (window).__tsena?.setMeta?.('cloud', { url: 'http://localhost:18900', anonKey: 'anon', email: 'cloud@x', accessToken: 'tok', refreshToken: 'r', expiresAt: Date.now() + 3600e3 }));

// Réglages → Intelligence artificielle
await p.goto('http://localhost:18900/#/parametres/ia'); await p.waitForTimeout(800);
ok(await p.getByRole('tab', { name: 'Intelligence artificielle' }).count() === 1, 'onglet « Intelligence artificielle » dans Paramètres');
ok(await p.getByLabel('URL locale').inputValue() === 'http://10.5.50.7:1234/v1' && await p.getByLabel('Nom du modèle').inputValue() === 'qwen3.8-27b', 'valeurs par défaut (URL locale, modèle)');
ok(/Aucune clé enregistrée/.test(await p.locator('.card').nth(1).innerText()), 'aucune clé au départ');
await p.getByLabel('URL locale').fill('http://127.0.0.1:18801/v1');
await p.getByLabel('URL en ligne').fill('http://127.0.0.1:18802/v1');
await p.getByText('Activer l’assistant IA pour tous les utilisateurs').click();
await p.locator('input[type=password]').fill(KEY);
ok(await p.locator('input[type=password]').getAttribute('type') === 'password', 'clé API dans un champ masqué');
await p.getByRole('button', { name: 'Enregistrer' }).click(); await p.waitForTimeout(800);
const card = await p.locator('.card').nth(1).innerText();
ok(/•••• enregistrée/.test(card) && !card.includes(KEY) && !(await p.content()).includes(KEY), 'clé enregistrée : seulement « •••• enregistrée » affiché');
ok(await p.locator('input[type=password]').inputValue() === '', 'le champ de la clé est vidé après enregistrement');
await p.getByRole('button', { name: 'Tester la connexion' }).click(); await p.waitForTimeout(800);
const t1 = await p.locator('.notice[role=status]').last().innerText();
ok(/Connexion réussie : Local/.test(t1) && /ms/.test(t1), 'Tester la connexion → Local + temps de réponse', t1);
await p.screenshot({ path: join(shots, 'ia-reglages.png'), fullPage: true });
local.state.down = true; AI.forgetChoice();
await p.getByRole('button', { name: 'Tester la connexion' }).click(); await p.waitForTimeout(2500);
ok(/Connexion réussie : En ligne/.test(await p.locator('.notice[role=status]').last().innerText()), 'local coupé → Tester indique En ligne');
local.state.down = false; AI.forgetChoice();
// Le serveur lit les réglages dans le cloud : on y met ceux de l'écran (la synchro est simulée).
await sql`update public.records set data = data || ${sql.json({ localUrl: 'http://127.0.0.1:18801/v1', onlineUrl: 'http://127.0.0.1:18802/v1' })}::jsonb, rev = nextval('public.records_rev_seq') where tbl = 'settings' and id = 'ai'`;

// Bulle
await p.goto('http://localhost:18900/#/'); await p.waitForTimeout(500);
ok(await p.locator('.ai-fab').count() === 1, 'bulle visible (IA activée, utilisateur connecté)');
await p.locator('.ai-fab').click();
const sugg = p.locator('.ai-suggest button');
ok(await sugg.count() >= 3 && await sugg.count() <= 4, `suggestions affichées (${await sugg.count()})`);
await p.screenshot({ path: join(shots, 'ia-bulle-vide.png') });
local.state.delay = 60;
await sugg.filter({ hasText: 'ventes cette semaine' }).click();
await p.waitForTimeout(150);
ok(await p.locator('.ai-stop').count() === 1, 'bouton « Arrêter » pendant la génération');
await p.waitForSelector('.ai-bot .md', { timeout: 8000 });
const partial = await p.locator('.ai-bot').last().innerText();
await p.waitForSelector('.ai-send:not(.ai-stop)', { timeout: 15000 });
const full = await p.locator('.ai-bot').last().innerText();
ok(full.length > partial.length, 'réponse affichée au fur et à mesure (streaming)');
ok(/chiffre_affaires_net/.test(full) && !/SECRET/.test(await p.content()), 'réponse issue de l’outil, sans le raisonnement');
ok((await p.locator('.ai-via').innerText()) === 'Local', 'badge « Local »');
local.state.delay = 0;

// Shift+Entrée = retour à la ligne, Entrée = envoyer
const box = p.getByLabel('Votre message');
await box.fill('Bonjour'); await box.press('Shift+Enter'); await box.type('comment vendre ?');
ok((await box.inputValue()).includes('\n'), 'Maj+Entrée : retour à la ligne');
await box.press('Enter');
await p.waitForTimeout(300);
await p.waitForSelector('.ai-send:not(.ai-stop)', { timeout: 15000 });
ok(await p.locator('.ai-user').count() === 2 && /Vente sur place/.test(await p.locator('.ai-bot').last().innerText()), 'Entrée : envoyé, réponse reçue');
ok(await p.locator('.ai-bot strong').filter({ hasText: 'Vente sur place' }).count() >= 1, 'Markdown : gras rendu');

// Conversation gardée en changeant de page
await p.goto('http://localhost:18900/#/stock'); await p.waitForTimeout(500);
ok(await p.locator('.ai-panel').count() === 1 && await p.locator('.ai-user').count() === 2, 'conversation gardée en changeant de page');
await p.screenshot({ path: join(shots, 'ia-bulle-conversation.png') });

// Arrêter
local.state.delay = 120;
await box.fill('Bonjour encore'); await box.press('Enter');
await p.waitForSelector('.ai-bot .md', { timeout: 8000 });
await p.locator('.ai-stop').click(); await p.waitForTimeout(400);
ok(/arrêté/.test(await p.locator('.ai-bot').last().innerText()) && await p.locator('.ai-stop').count() === 0, 'Arrêter : génération stoppée');
local.state.delay = 0;

// Serveur IA injoignable
local.state.down = true; online.state.down = true; AI.forgetChoice();
await box.fill('Test panne'); await box.press('Enter');
await p.waitForSelector('.ai-error', { timeout: 15000 });
ok(/momentanément indisponible/.test(await p.locator('.ai-error').last().innerText()), 'IA injoignable : message clair dans la bulle');
ok(await p.locator('.sidebar').isVisible(), 'le reste du logiciel fonctionne');
local.state.down = false; online.state.down = false; AI.forgetChoice();

// Nouvelle conversation
await p.getByRole('button', { name: 'Nouvelle conversation' }).click();
ok(await p.locator('.ai-msg').count() === 0 && await sugg.count() > 0, 'Nouvelle conversation : vidée, suggestions revenues');

// Mode sombre et téléphone
await p.evaluate(() => (window).__tsena?.setMeta?.('theme', 'dark')); await p.waitForTimeout(300);
await sugg.first().click(); await p.waitForSelector('.ai-send:not(.ai-stop)', { timeout: 15000 });
await p.screenshot({ path: join(shots, 'ia-bulle-sombre.png') });
ok(await p.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'mode sombre appliqué à la bulle');
await p.setViewportSize({ width: 390, height: 800 }); await p.waitForTimeout(300);
const box2 = await p.locator('.ai-panel').boundingBox();
ok(box2 && box2.width >= 389 && box2.height >= 790, 'téléphone : panneau en plein écran', JSON.stringify(box2));
await p.screenshot({ path: join(shots, 'ia-bulle-mobile.png') });
await p.locator('button[aria-label="Fermer l’assistant"]').click();
const fab = await p.locator('.ai-fab').boundingBox();
const nav = await p.locator('.bottom-nav').boundingBox();
ok(fab && nav && fab.y + fab.height <= nav.y + 1, 'téléphone : bulle au-dessus de la barre du bas', JSON.stringify({ fab, nav }));
await p.evaluate(() => (window).__tsena?.setMeta?.('theme', 'light'));

await browser.close(); srv.close(); await local.close(); await online.close(); await sql.end();
console.log(`\n${pass} OK, ${fail} échec(s) — captures : ${shots}`);
process.exit(fail ? 1 : 0);
