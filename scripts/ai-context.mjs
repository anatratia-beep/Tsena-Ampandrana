// Régénère docs/AI_CONTEXT.md, la « connaissance du logiciel » donnée à l'assistant IA à chaque conversation.
//   npm run ai:context
// Partie écrite à la main : docs/ai/AI_CONTEXT.template.md (rôle du logiciel, vocabulaire, règles, pas à pas).
// Partie lue dans le code (toujours à jour) : rôles, menus et droits (src/App.tsx), statuts et codes, tables.
// Ensuite : npm run ai:build (ou la mise en ligne automatique) pour mettre la fonction cloud à jour.
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
const MAX_TOKENS = 4000;

// 1. Constantes du code (rôles, statuts, tables), lues en exécutant les modules eux-mêmes.
const dir = mkdtempSync(join(tmpdir(), 'tsena-ctx-'));
const entry = join(dir, 'entry.ts');
writeFileSync(entry, `
export { DEFAULT_ROLES, PERMISSIONS } from ${JSON.stringify(join(root, 'src/lib/permissions.ts'))};
export { ORDER_STATUS, CHANNELS, PAY_METHODS } from ${JSON.stringify(join(root, 'src/lib/orders.ts'))};
export { PURCHASE_STATUS, MOVE_LABELS } from ${JSON.stringify(join(root, 'src/lib/catalog.ts'))};
export { MOVE_TYPES, ACCOUNTS } from ${JSON.stringify(join(root, 'src/lib/money.ts'))};
export { TABLES } from ${JSON.stringify(join(root, 'src/lib/db.ts'))};
`);
const out = join(dir, 'ctx.mjs');
await esbuild.build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'], outfile: out, logLevel: 'error', jsx: 'automatic', nodePaths: [join(root, 'node_modules')], define: { __APP_VERSION__: '"0"', __BUILD_DATE__: '"0"', 'process.env.NODE_ENV': '"production"' } });
const m = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true, force: true });

const permLabel = new Map(m.PERMISSIONS.map((p) => [p.key, p.label]));
const roles = m.DEFAULT_ROLES.map((r) => `- **${r.name}** : ${r.description}`).join('\n');

// 2. Menus : lus dans le tableau NAV de src/App.tsx (chemin, libellé, droit, groupe).
const app = readFileSync(join(root, 'src/App.tsx'), 'utf8');
const nav = [...app.matchAll(/\{\s*path:\s*'([^']+)',\s*label:\s*(['"])(.+?)\2,(?:\s*short:\s*'[^']*',)?\s*icon:\s*'[^']+',(?:\s*perm:\s*'([^']*)',)?\s*group:\s*'([^']*)'/g)]
  .map(([, path, , label, perm, group]) => ({ path, label, perm, group }))
  .filter((n) => n.group !== 'hidden');
const settings = readFileSync(join(root, 'src/pages/Settings.tsx'), 'utf8');
const tabs = [...settings.matchAll(/\{\s*key:\s*'([^']+)',\s*label:\s*'([^']+)',\s*perm:\s*'([^']*)'\s*\}/g)].map(([, , label]) => label);
const groups = [...new Set(nav.map((n) => n.group))];
const menu = groups.map((g) => `- ${g || 'Général'} : ` + nav.filter((n) => n.group === g).map((n) => `${n.label}${n.perm ? ` [${n.perm.split('|').map((p) => permLabel.get(p) ? p : p).join(' ou ')}]` : ''}`).join(' ; ')).join('\n')
  + `\n- Onglets de Paramètres : ${tabs.join(', ')}.`
  + '\n(Entre crochets : droit nécessaire pour voir le menu.)';

// 3. Statuts et codes.
const kv = (o, f = (v) => v) => Object.entries(o).map(([k, v]) => `${k} = ${f(v)}`).join(', ');
const statuts = [
  `- Commande (status) : ${kv(m.ORDER_STATUS, (v) => v.label)}. kind : order (commande) ou exchange (échange).`,
  `- Canal (channel) : ${kv(m.CHANNELS)}.`,
  `- Moyen de paiement (method) : ${kv(m.PAY_METHODS)} ; receivedBy : shop (boutique) ou courier (livreur).`,
  `- Achat fournisseur (status) : ${kv(m.PURCHASE_STATUS, (v) => v.label)}.`,
  `- Mouvement de stock (type, qty + entrée / − sortie) : ${kv(m.MOVE_LABELS)}.`,
  `- Mouvement d'argent (cashMoves.type, amount + entrée / − sortie) : ${kv(m.MOVE_TYPES)}.`,
  `- Comptes (account) : ${kv(m.ACCOUNTS)}.`,
  '- Versement vendeur (handovers.status) : received (reçu) ou cancelled (annulé) ; gap = remis − attendu.',
].join('\n');

// 4. Tables (description courte des principales ; les autres sont seulement nommées).
const DESC = {
  users: 'utilisateurs (fullName, username, roleId, extraRoleIds, pageIds, courierId, active)',
  roles: 'rôles (name, permissions[])',
  settings: 'réglages (id company : nom, téléphones, horaires, taux du dollar ; id ai : assistant IA)',
  audit: "journal d'activité (at, action, details, userId, userName, level)",
  categories: 'pages et sous-catégories (name, parentId vide = page, code, attrs = variantes)',
  products: 'articles (code, name, categoryId, priceRetail, priceWholesale, alertQty, active, kind=lot)',
  variants: 'variantes (productId, sku, color, size, costAvg = prix de revient, priceRetail)',
  stockMoves: 'mouvements de stock (variantId, qty, type, at, refId)',
  suppliers: 'fournisseurs', purchases: 'achats Chine (number, supplierId, date, currency, rate, status, lines, payments)',
  receptions: 'réceptions (items avec unitCost)', zones: 'zones de livraison (name, fee)',
  couriers: 'livreurs (name, phone, active, feeToShop)', customers: 'clients (name, phone, facebook, place)',
  orders: 'commandes et ventes (number, channel, status, lines[variantId, qty, unitPrice, isChoice, qtyKept, qtyReturned], payments[at, amount, method, receivedBy], discount, deliveryFee, feeCharged, courierId, dispatchedAt = départ livreur, returnedAt, createdBy, createdByName, internal)',
  cashMoves: "mouvements d'argent (at, account, amount, type, categoryId, label)",
  financeCategories: 'catégories de dépenses / revenus', recurring: 'charges fixes récurrentes',
  courierSettlements: 'règlements des livreurs (courierId, at, amount)', handovers: 'versements des vendeurs (userId, date, expected, amount, gap)',
  payouts: 'versements de la semaine au patron (weekStart, amount, status)', boosts: 'publicités Facebook (pageId, dailyBudget, status)',
  boostReadings: 'relevés des boosts (date, spend $, messages)', pageMessages: 'messages reçus par page et par jour',
  inventories: 'inventaires', serials: 'numéros de série (garantie)', prospects: 'clients à suivre', dayReports: 'rapports du jour des vendeurs',
};
const tables = m.TABLES.map((t) => (DESC[t] ? `- ${t} : ${DESC[t]}` : null)).filter(Boolean).join('\n')
  + `\n- Autres : ${m.TABLES.filter((t) => !DESC[t] && !['printStations', 'printJobs', 'syncConflicts', 'devices'].includes(t)).join(', ')}.`;

// 5. Assemblage et contrôle de la taille.
const tpl = readFileSync(join(root, 'docs/ai/AI_CONTEXT.template.md'), 'utf8');
const md = '<!-- Fichier GÉNÉRÉ par « npm run ai:context » à partir de docs/ai/AI_CONTEXT.template.md et du code : ne pas modifier à la main. -->\n'
  + tpl.replace('{{ROLES}}', roles).replace('{{MENU}}', menu).replace('{{STATUTS}}', statuts).replace('{{TABLES}}', tables);
writeFileSync(join(root, 'docs/AI_CONTEXT.md'), md);
const tokens = Math.ceil(md.length / 3.2);
console.log(`docs/AI_CONTEXT.md : ${md.length} caractères, environ ${tokens} tokens (limite conseillée ${MAX_TOKENS}).`);
if (tokens > MAX_TOKENS) { console.warn(`⚠️  Trop long : raccourcir docs/ai/AI_CONTEXT.template.md (le contexte du modèle est limité).`); }
process.exit(0);
