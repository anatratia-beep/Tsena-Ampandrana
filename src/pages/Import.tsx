// Import Excel : modèles à télécharger, reprise du stock, fichiers de commande Chine, fournisseurs, catégories.
import { useMemo, useState } from 'react';
import { audit, currentUser, useCan } from '../lib/auth';
import { all, get, newId, save, useTable } from '../lib/db';
import {
  addMoves, ensureCategory, findProductByCode, fmtAr, fmtNum, makeSku, nextNumber, normSize, parseNum, productVariants, stockOf, todayYmd, useCatalog,
  type Product, type Purchase, type PurchaseLine, type StockMove, type Variant,
} from '../lib/catalog';
import { lastRate, validateReception, type Supplier } from '../lib/purchases';
import { blobToThumb, downloadBlob, excelDate, fillMerged, normHeader, readXlsx, writeXlsx, type Cell, type Sheet } from '../lib/xlsx';
import { Badge, Button, Empty, PageHead, SelectField, TextField, navigate, toast } from '../ui/kit';
import { Icon } from '../ui/icons';
import { categoryOptions, Thumb } from './Products';
import { activeAttrs, categoryTemplate, parseCategoryFile, rowState, rowsToSave, saveArticles, templateCategory, type ImportRow } from '../lib/attrs';
import { twinFinder } from '../lib/duplicates';
import { pointBefore } from '../lib/restorePoints';
import type { Category } from '../lib/catalog';
import { ImportBadges, MappedImport, TwinNotice, looksLikePageFile, headerRowOf, sortRows } from './ImportMapped';

/** Import du fichier d'une page : contrôle de chaque ligne, puis création / mise à jour des articles. */
function PageImport({ cat, sheets, onDone }: { cat: Category; sheets: Sheet[]; onDone: () => void }) {
  const rows: ImportRow[] = parseCategoryFile(cat, sheets);
  const [skip, setSkip] = useState(false);
  const [withTwins, setWithTwins] = useState(false);
  const [busy, setBusy] = useState(false);
  const bad = rows.filter((r) => r.errors.length);
  const ok = rowsToSave(rows, withTwins);
  const same = rows.filter((r) => r.same);
  const twins = rows.filter((r) => !r.errors.length && r.twin);
  const canGo = ok.length > 0 && (!bad.length || skip);
  return (
    <div className="card card-flush">
      <div className="card-pad stack-s">
        <h2>Page « {cat.name} » : {rows.length} ligne(s) lue(s)</h2>
        <ImportBadges rows={rows} withTwins={withTwins} />
        {bad.length > 0 && <div className="notice notice-danger"><Icon name="alert" /><span>Corrigez les lignes en rouge dans le fichier puis importez-le de nouveau. Vous pouvez aussi importer seulement les lignes correctes.</span></div>}
        {same.length > 0 && same.length === rows.length - bad.length && <div className="notice notice-ok"><Icon name="check" /><span>Ce fichier est déjà importé : tous les articles existent avec les mêmes prix et le même stock. Rien à enregistrer.</span></div>}
        <TwinNotice count={twins.length} withTwins={withTwins} onChange={setWithTwins} />
      </div>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Ligne</th><th>Photo</th><th>Article</th><th>État</th><th className="t-num">Revient</th><th className="t-num">PV détail</th><th className="t-num">PV gros</th><th className="t-num">Stock</th></tr></thead>
        <tbody>{sortRows(rows).map((r) => (
          <tr key={r.line} className={r.errors.length ? 'row-error' : r.same ? 'muted' : ''}>
            <td className="num">{r.line}</td>
            <td>{r.photo ? <PreviewPhoto blob={r.photo} /> : <span className="small muted">—</span>}</td>
            <td><strong>{r.name || '—'}</strong><div className="small muted">{r.label}</div></td>
            <td className="small">{r.errors.length ? <span className="neg">{rowState(r)}</span> : r.twin && !withTwins ? <span className="warn-text">{rowState(r)}</span> : rowState(r, withTwins)}</td>
            <td className="t-num">{fmtAr(r.input?.cost)}</td><td className="t-num">{fmtAr(r.input?.retail)}</td><td className="t-num">{fmtAr(r.input?.wholesale ?? r.input?.retail)}</td><td className="t-num">{r.input?.stock ?? '—'}</td>
          </tr>
        ))}</tbody>
      </table></div>
      <div className="card-pad row">
        {bad.length > 0 && <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} /> Importer seulement les {ok.length} ligne(s) correcte(s)</label>}
        <Button busy={busy} disabled={!canGo} onClick={async () => {
          setBusy(true);
          try {
            const thumbs = new Map<Blob, string>();
            for (const x of ok) if (x.photo && !thumbs.has(x.photo)) { const t = await blobToThumb(x.photo).catch(() => undefined); if (t) thumbs.set(x.photo, t); }
            const r = await saveArticles(cat, ok.map((x) => ({ ...x.input!, photo: x.photo ? thumbs.get(x.photo) : undefined })), 'Import Excel');
            toast(`${r.created} article(s) créé(s), ${r.updated} mis à jour${same.length ? `, ${same.length} identique(s) ignoré(s)` : ''}${thumbs.size ? `, ${ok.filter((x) => x.photo).length} photo(s)` : ''}`); onDone();
          }
          catch (e: any) { toast(e.message, 'error'); setBusy(false); }
        }}>{ok.length ? `Importer ${ok.length} article(s)` : 'Rien à importer'}</Button>
      </div>
    </div>
  );
}

// ---------- Même fichier importé deux fois ----------
// Empreinte du contenu du fichier (pas son nom) : un même fichier renommé est reconnu, un fichier modifié ne l'est pas.
interface ImportLog { id: string; name: string; at: string; byName?: string; kind: string }
async function fileHash(f: File) {
  try {
    const buf = await crypto.subtle.digest('SHA-256', await f.arrayBuffer());
    return [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch { return ''; } // navigateur sans crypto.subtle (page non sécurisée) : pas de contrôle du fichier
}
/** Import déjà fait de ce fichier, depuis le dernier effacement des données (après un effacement, réimporter est normal). */
function previousImport(hash: string): ImportLog | undefined {
  if (!hash) return undefined;
  const log = get<ImportLog & { createdAt: string; updatedAt: string }>('settings', `import_${hash}`);
  const reset = get<{ id: string; at: string; createdAt: string; updatedAt: string }>('settings', 'lastReset')?.at ?? '';
  return log && log.at > reset ? log : undefined;
}
async function rememberImport(hash: string, name: string, kind: string) {
  if (!hash) return;
  await save('settings', { id: `import_${hash}`, name, kind, at: new Date().toISOString(), byName: currentUser()?.fullName });
}

// ---------- Modèles ----------
const TEMPLATES = [
  {
    key: 'articles', title: 'Articles simples (sans variantes de page)', text: 'Ancien mode : une ligne par couleur + taille. Pour une page qui a ses variantes (Modèle, Pointure…), utilisez plutôt le fichier de la page ci-dessus.',
    build: () => writeXlsx([
      { name: 'Articles', columns: [
        { header: 'Catégorie', width: 20, input: true }, { header: 'Code article', width: 13, input: true }, { header: "Nom de l'article", width: 34, input: true },
        { header: 'Couleur', width: 12, input: true }, { header: 'Taille', width: 8, input: true }, { header: 'Code variante', width: 18 },
        { header: 'Stock', width: 9, input: true }, { header: 'Prix de revient (Ar)', width: 15, input: true }, { header: 'PV détail (Ar)', width: 13, input: true }, { header: 'PV gros (Ar)', width: 13, input: true },
      ], rows: [
        ['Boxer homme', 'BXH8', 'Boxer homme coton', 'Bleu', 'L', 'BXH8 Bleu L', 30, 5740, 12000, 10000],
        ['Boxer homme', 'BXH8', 'Boxer homme coton', 'Bleu', 'XL', 'BXH8 Bleu XL', 25, 5740, 12000, 10000],
      ] },
      { name: "Mode d'emploi", columns: [], rows: [], notes: [
        '#Modèle Articles et stock — Trésor en ligne',
        'Une ligne = une variante (une couleur et une taille d’un article).',
        'Les lignes qui ont le même « Code article » forment un seul article avec plusieurs variantes.',
        'Code variante : facultatif. S’il est vide, il est fabriqué avec Code article + Couleur + Taille.',
        'Stock : la quantité que vous avez aujourd’hui. Prix en Ariary, sans espace ni « Ar ».',
        'Couleur et Taille : laissez vide si l’article n’a qu’une version.',
        'Les 2 lignes d’exemple peuvent être effacées. Ne changez pas les titres des colonnes.',
        'Pour ajouter les photos : insérez l’image dans la ligne de l’article (n’importe quelle colonne), elle sera reprise.',
      ] },
    ]),
  },
  {
    key: 'commande', title: 'Commande Chine', text: 'Le même format que vos fichiers de commande : référence, n° de commande, taille, quantités, prix en RMB, prix de vente.',
    build: () => writeXlsx([
      { name: 'Suivi commande', columns: [
        { header: 'REFERENCE', width: 11, input: true }, { header: 'NUMERO DE COMMANDE', width: 22, input: true }, { header: 'NUMERO DE SUIVI', width: 16, input: true }, { header: 'ARTICLE', width: 14 },
        { header: 'LIEN', width: 30, input: true }, { header: 'NOM', width: 8, input: true }, { header: 'QTE COMMANDEE', width: 10, input: true }, { header: 'QTE RECU', width: 9, input: true },
        { header: 'PU (RMB)', width: 9, input: true }, { header: 'FRAIS CHINE (RMB)', width: 11, input: true }, { header: 'REMISE (RMB)', width: 10, input: true }, { header: 'ETAT', width: 12, input: true },
        { header: 'PV DET', width: 9, input: true }, { header: 'PV GRS', width: 9, input: true },
      ], rows: [
        ['PH6', '3306228600473757489', '302109811698', '(photo)', 'https://detail.1688.com/offer/…', 'L', 15, null, 27.48, 115.48, 0, 'Commandé', 48000, 45000],
        ['PH6', null, null, null, null, 'XL', 20, null, 27.48, null, null, null, 48000, 45000],
      ] },
      { name: "Mode d'emploi", columns: [], rows: [], notes: [
        '#Modèle Commande Chine — Trésor en ligne',
        'Une ligne par taille (colonne NOM). Répétez la REFERENCE ou fusionnez les cellules, comme dans vos fichiers actuels.',
        'FRAIS CHINE et REMISE : une seule fois par commande (première ligne).',
        'Le taux du RMB et les tarifs du transit ne sont pas dans ce fichier : ils se saisissent dans Trésor en ligne (taux à l’import, transit à la réception).',
        'Vos anciens fichiers (avec PRIX DE REVIENT, Volume m3, Frais transit…) sont aussi acceptés tels quels.',
      ] },
    ]),
  },
  {
    key: 'fournisseurs', title: 'Fournisseurs', text: 'Nom, boutique 1688, contact WeChat ou téléphone, ville.',
    build: () => writeXlsx([{ name: 'Fournisseurs', columns: [{ header: 'Nom', width: 26, input: true }, { header: 'Boutique / lien', width: 34, input: true }, { header: 'Contact', width: 20, input: true }, { header: 'Ville', width: 14, input: true }, { header: 'Notes', width: 30, input: true }],
      rows: [['Usine pyjamas Guangzhou', 'shop566869krq2495.1688.com', 'WeChat : xxxx', 'Guangzhou', '']] }]),
  },
  {
    key: 'categories', title: 'Catégories', text: 'La liste de vos catégories, avec une catégorie parente si besoin (ex. Enfant › Boxer garçon).',
    build: () => writeXlsx([{ name: 'Catégories', columns: [{ header: 'Catégorie', width: 26, input: true }, { header: 'Catégorie parente', width: 26, input: true }],
      rows: [['Enfant', ''], ['Boxer garçon', 'Enfant'], ['Boxer homme', '']] }]),
  },
];

type Kind = 'articles' | 'commande' | 'fournisseurs' | 'categories' | 'page' | 'mapped';

export function ImportPage() {
  const can = useCan();
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [kind, setKind] = useState<Kind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pageId, setPageId] = useState('');
  const cats = useTable<Category>('categories');
  const [tplCat, setTplCat] = useState('');
  const [simpleOk, setSimpleOk] = useState(false);
  const [repairNote, setRepairNote] = useState<string | null>(null);
  const [hash, setHash] = useState('');
  const [already, setAlready] = useState<ImportLog | undefined>();
  const [again, setAgain] = useState(false);
  const finished = (go: () => void) => { const h = hash, n = file?.name ?? '', k = kind ?? ''; setSheets(null); setAlready(undefined); go(); rememberImport(h, n, k).catch(() => undefined); };

  async function open(f: File) {
    setError(null); setBusy(true); setSheets(null); setKind(null); setFile(f); setRepairNote(null); setAlready(undefined); setAgain(false);
    try {
      const h = await fileHash(f);
      setHash(h); setAlready(previousImport(h));
      const sh = await readXlsx(f, { images: true });
      const rep = (sh as Sheet[] & { repaired?: { missingImages: number } }).repaired;
      if (rep) setRepairNote(`Ce fichier est coupé (téléchargement ou export interrompu, souvent à cause de photos trop lourdes). Tout ce qui était lisible a été récupéré : toutes les lignes${rep.missingImages ? `, mais ${rep.missingImages} photo(s) manquent (elles étaient après la coupure)` : ' et les photos'}. Vous pouvez importer ; les photos manquantes s’ajoutent ensuite dans la fiche article, ou en important de nouveau un fichier complet.`);
      sh.forEach(fillMerged);
      const pageCat = templateCategory(sh);
      if (pageCat) { setSheets(sh); setKind('page'); setPageId(pageCat.id); return; }
      if (sh.some((x) => x.name === 'tsena')) throw new Error('Ce fichier a été fait pour une page qui n’existe plus dans Trésor en ligne (supprimée ?). Téléchargez de nouveau le fichier de la page.');
      const k = detectKind(sh);
      const pages = all<Category>('categories').filter((c) => !c.removed && activeAttrs(c).length);
      // Fichier à vous (vos colonnes) : lu avec les variantes de la page quand il nomme une page ou a les colonnes de ses variantes.
      if (k !== 'commande' && k !== 'fournisseurs' && k !== 'categories' && pages.length && (looksLikePageFile(sh, pages) || (!k && sh.some((x) => headerRowOf(x) >= 0)))) { setSheets(sh); setKind('mapped'); setSimpleOk(k === 'articles'); return; }
      if (!k) throw new Error("Je ne reconnais pas les colonnes de ce fichier. Utilisez un des modèles ci-dessous, ou vérifiez la ligne des titres.");
      setSheets(sh); setKind(k);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  if (!can('catalog.edit')) return <Empty icon="lock" title="Accès réservé au gérant" />;
  return (
    <>
      <PageHead title="Importer depuis Excel" subtitle="Téléchargez un modèle, remplissez-le, puis importez-le. Vos fichiers habituels sont aussi acceptés." />
      <div className="card stack">
        <h2>Importer un fichier</h2>
        <label className="dropzone">
          <Icon name="upload" size={28} />
          <span><strong>Choisir un fichier Excel (.xlsx)</strong><br /><span className="small muted">Fichier de reprise du stock, fichier de commande Chine, modèle Trésor en ligne…</span></span>
          <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => { const f = e.target.files?.[0]; if (f) open(f); e.target.value = ''; }} />
        </label>
        {busy && <p className="small muted">Lecture du fichier…</p>}
        {error && <div className="notice notice-danger"><Icon name="alert" /><span>{error}</span></div>}
        {repairNote && <div className="notice notice-warn"><Icon name="alert" /><span>{repairNote}</span></div>}
        {already && sheets && <div className="notice notice-warn"><Icon name="alert" /><span>
          <strong>Ce fichier a déjà été importé</strong> le {new Date(already.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}{already.byName ? ` par ${already.byName}` : ''}{already.name !== file?.name ? ` (sous le nom « ${already.name} »)` : ''}.
          {kind === 'commande' ? ' L’importer de nouveau créerait une deuxième commande.' : ' Les articles déjà enregistrés à l’identique seront ignorés : seuls les changements seront enregistrés.'}
          {kind === 'commande' && <label className="row small" style={{ gap: 6, marginTop: 6 }}><input type="checkbox" checked={again} onChange={(e) => setAgain(e.target.checked)} /> C’est une autre commande : l’importer quand même</label>}
        </span></div>}
      </div>
      {sheets && kind === 'page' && get<Category>('categories', pageId) && <PageImport cat={get<Category>('categories', pageId)!} sheets={sheets} onDone={() => finished(() => navigate(`/articles?cat=${pageId}`))} />}
      {sheets && kind === 'mapped' && <MappedImport sheets={sheets} onSimple={simpleOk ? () => setKind('articles') : undefined} onDone={(pid) => finished(() => navigate(pid ? `/articles?cat=${pid}` : '/articles'))} />}
      {sheets && kind === 'articles' && file && <ArticlesImport sheets={sheets} fileName={file.name} onDone={() => finished(() => navigate('/articles'))} />}
      {sheets && kind === 'commande' && file && <OrderImport sheets={sheets} fileName={file.name} blocked={!!already && !again} onDone={(id) => finished(() => navigate('/achats/' + id))} />}
      {sheets && kind === 'fournisseurs' && <SimpleImport kind="fournisseurs" sheets={sheets} onDone={() => setSheets(null)} />}
      {sheets && kind === 'categories' && <SimpleImport kind="categories" sheets={sheets} onDone={() => setSheets(null)} />}

      <div className="card stack">
        <div><h2>Stock de départ d’une page (avec ses variantes)</h2>
          <ol className="small steps-list">
            <li><strong>Créez la page et ses variantes</strong> dans <a href="#/pages">Pages et variantes</a> (ex. page « Sandale » : Modèle, Couleur, Pointure). Les valeurs (S5, Rose, 37…) peuvent rester incomplètes.</li>
            <li><strong>Deux façons de remplir :</strong> <em>a.</em> téléchargez le fichier de la page ci-dessous (une colonne par variante, avec liste déroulante) ; ou <em>b.</em> gardez <strong>votre propre fichier Excel</strong> tel qu’il est (une ligne par article : modèle, couleur, pointure, stock, prix…).</li>
            <li><strong>Importez-le</strong> en haut de cette page : vous indiquez quelle colonne correspond à chaque variante (déjà deviné d’après les titres), les valeurs nouvelles sont ajoutées à la page, et chaque ligne est contrôlée avant d’enregistrer.</li>
            <li>Pour une <strong>autre page</strong> (autres variantes), même chose : un fichier peut même contenir plusieurs pages si une colonne « Catégorie » indique la page de chaque ligne.</li>
          </ol></div>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 240px' }}><SelectField label="Page" required value={tplCat} onChange={setTplCat} options={[{ value: '', label: 'Choisir la page…' }, ...cats.filter((c) => activeAttrs(c).length).map((c) => ({ value: c.id, label: c.name }))]} /></div>
          <Button icon="download" disabled={!tplCat} onClick={async () => { const c = get<Category>('categories', tplCat)!; downloadBlob(await categoryTemplate(c), `Tresor-en-ligne-${(c.code || 'page').toLowerCase()}-articles.xlsx`); }}>Télécharger le fichier de la page</Button>
        </div>
        {!cats.some((c) => activeAttrs(c).length) && <p className="small muted">Aucune page n’a encore de variantes.</p>}
      </div>

      <div className="card stack">
        <div><h2>Autres modèles à remplir</h2><p className="small muted">Colonnes jaunes à remplir, une ligne d’exemple et un onglet « Mode d’emploi » dans chaque fichier.</p></div>
        <ul className="list">
          {TEMPLATES.map((t) => (
            <li key={t.key} className="list-item" style={{ padding: '12px 0' }}>
              <span className="avatar"><Icon name="download" size={18} /></span>
              <div className="list-item-main"><span className="list-item-title">{t.title}</span><p className="small muted">{t.text}</p></div>
              <Button variant="ghost" icon="download" onClick={async () => downloadBlob(await t.build(), `Tresor-en-ligne-modele-${t.key}.xlsx`)}>Télécharger</Button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

// ---------- Reconnaissance des colonnes ----------
type ColMap = Record<string, number>;
const ARTICLE_COLS: Record<string, string[]> = {
  code: ['code', 'code variante', 'reference variante'],
  model: ['modele', 'code article', 'code modele'],
  name: ['nom de l article', 'nom', 'designation', 'article', 'libelle'],
  category: ['categorie'],
  color: ['couleur'],
  size: ['taille'],
  stock: ['stock'],
  cost: ['prix de revient', 'cout', 'cout de revient', 'prix de revient ar', 'pru'],
  pv: ['pv detail', 'prix detail', 'prix de vente', 'pv det', 'pv detail ar', 'prix de vente detail'],
  pvg: ['pv gros', 'prix de gros', 'pv grs', 'pv gros ar'],
};
const ORDER_COLS: Record<string, string[]> = {
  ref: ['reference'], order: ['numero de commande'], tracking: ['numero de suivi'], link: ['lien'], size: ['nom'],
  qty: ['qte commandee'], received: ['qte recu', 'qte recue'], pu: ['pu rmb', 'pu'], fees: ['frais chine rmb', 'frais chine'],
  discount: ['remise rmb', 'remise'], buyAr: ['prix d achat chine ar'], state: ['etat'], obs: ['obs'], volume: ['volume m3'],
  transit: ['frais transit'], cost: ['prix de revient'], pv: ['pv det'], pvg: ['pv grs'], article: ['article'],
};

function findHeader(sheet: Sheet, spec: Record<string, string[]>, required: string[]): { row: number; map: ColMap } | null {
  for (let r = 0; r < Math.min(12, sheet.rows.length); r++) {
    const map: ColMap = {};
    (sheet.rows[r] || []).forEach((cell, c) => {
      const h = normHeader(cell);
      if (!h) return;
      for (const [k, names] of Object.entries(spec)) {
        if (map[k] != null && k !== 'volume') continue;
        if (names.some((n) => h === n || (k === 'stock' && h.startsWith('stock')) || (k === 'cost' && h.startsWith('prix de revient')) || (k === 'transit' && h === 'frais transit'))) { map[k] = c; break; }
      }
    });
    if (required.every((k) => map[k] != null)) return { row: r, map };
  }
  return null;
}

function detectKind(sheets: Sheet[]): Kind | null {
  for (const s of sheets) {
    if (findHeader(s, ORDER_COLS, ['ref', 'size', 'qty', 'pu'])) return 'commande';
    const a = findHeader(s, ARTICLE_COLS, ['stock']);
    if (a && (a.map.code != null || a.map.model != null)) return 'articles';
    const h = (s.rows[0] || []).map(normHeader);
    if (h.includes('nom') && (h.includes('contact') || h.includes('boutique lien'))) return 'fournisseurs';
    if (h[0] === 'categorie' && h.filter(Boolean).length <= 2) return 'categories';
  }
  return null;
}

const str = (v: Cell) => (v == null ? '' : String(v).trim());

// ---------- Import articles + stock ----------
interface ArtRow { line: number; code: string; model: string; name: string; category: string; color: string; size: string; stock: number; cost?: number; pv?: number; pvg?: number; photoRow: number }

function cleanName(name: string, color: string, size: string) {
  let n = name.replace(/\s*taille\s*[\w/]+/i, ' ');
  for (const t of [size, color, size.replace('2XL', 'XXL').replace('3XL', 'XXXL')]) if (t) n = n.replace(new RegExp(`\\s+${t.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\s*$`, 'i'), '');
  return n.replace(/\s+/g, ' ').trim();
}

function ArticlesImport({ sheets, fileName, onDone }: { sheets: Sheet[]; fileName: string; onDone: () => void }) {
  const { categories } = useCatalog();
  const [defaultCat, setDefaultCat] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const sheet = sheets.find((s) => findHeader(s, ARTICLE_COLS, ['stock']))!;
  const { row: hr, map } = findHeader(sheet, ARTICLE_COLS, ['stock'])!;
  const rows: ArtRow[] = [];
  for (let r = hr + 1; r < sheet.rows.length; r++) {
    const x = sheet.rows[r] || [];
    const g = (k: string) => (map[k] != null ? x[map[k]] : null);
    const model = str(g('model')) || str(g('code')).split(/\s+/)[0];
    const code = str(g('code'));
    if (!model && !code) continue;
    if (/^(total|sous total)/i.test(str(g('name')) || model)) continue;
    const color = str(g('color'));
    const size = normSize(str(g('size')));
    rows.push({ line: r + 1, model: model || code, code: code || makeSku(model, color, size), name: str(g('name')), category: str(g('category')), color, size,
      stock: parseNum(g('stock') as any) ?? 0, cost: parseNum(g('cost') as any), pv: parseNum(g('pv') as any), pvg: parseNum(g('pvg') as any), photoRow: r });
  }
  // Regroupement par article.
  const groups = new Map<string, ArtRow[]>();
  for (const r of rows) { const k = r.model.toUpperCase().replace(/\s+/g, ''); if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(r); }
  const warnings: string[] = [];
  const seen = new Map<string, number>();
  for (const r of rows) {
    const k = r.code.toUpperCase().replace(/\s+/g, '');
    if (seen.has(k)) warnings.push(`Ligne ${r.line} : code ${r.code} en double (ligne ${seen.get(k)}) — les stocks seront additionnés.`); else seen.set(k, r.line);
    if (r.stock < 0) warnings.push(`Ligne ${r.line} : ${r.code} a un stock négatif (${r.stock}) — importé à 0, à vérifier à l’inventaire.`);
    if (r.stock > 0 && !r.cost) warnings.push(`Ligne ${r.line} : ${r.code} sans prix de revient — valeur du stock à 0.`);
    if (!r.name) warnings.push(`Ligne ${r.line} : ${r.code} sans nom — le code servira de nom.`);
  }
  const existing = [...groups.keys()].filter((k) => findProductByCode(k)).length;
  const [withTwins, setWithTwins] = useState(false);
  // Pour chaque article du fichier : identique à l'existant (ignoré), ou nouveau mais déjà présent comme article d'une page.
  const status = useMemo(() => {
    const twins = twinFinder();
    const out = new Map<string, { same?: boolean; twin?: ReturnType<typeof twins.forSimpleArticle>; restock: number }>();
    for (const [k, list] of groups) {
      const prod = findProductByCode(list[0].model);
      if (!prod) { out.set(k, { twin: twins.forSimpleArticle(list[0].model), restock: 0 }); continue; }
      const qty = new Map<string, number>();
      for (const r of list) { const sk = r.code.toUpperCase().replace(/\s+/g, ''); qty.set(sk, (qty.get(sk) ?? 0) + Math.max(0, r.stock)); }
      const vs = productVariants(prod.id);
      let restock = 0, missing = 0;
      for (const [sk, q] of qty) { const v = vs.find((x) => x.sku.toUpperCase().replace(/\s+/g, '') === sk); if (!v) missing++; else if (stockOf(v.id) !== q) restock++; }
      out.set(k, { same: !missing && !restock, restock });
    }
    return out;
  }, [sheet]);
  const sameCount = [...status.values()].filter((x) => x.same).length;
  const twinKeys = [...status.entries()].filter(([, x]) => x.twin).map(([k]) => k);
  const restockCount = [...status.values()].reduce((t, x) => t + x.restock, 0);
  const toImport = [...groups.keys()].filter((k) => !status.get(k)?.same && (withTwins || !status.get(k)?.twin));
  const totalStock = rows.reduce((s, r) => s + Math.max(0, r.stock), 0);
  const totalValue = rows.reduce((s, r) => s + Math.max(0, r.stock) * (r.cost ?? 0), 0);
  const photos = new Map<number, Blob>();
  for (const im of sheet.images) if (!photos.has(im.row)) photos.set(im.row, im.blob);
  const preview = [...groups.values()].slice(0, 12);

  async function run() {
    setBusy(true);
    try {
      const catCache = new Map<string, string>();
      const newProducts: Partial<Product>[] = [];
      const newVariants: Partial<Variant>[] = [];
      const updVariants: Partial<Variant>[] = [];
      const moves: Omit<StockMove, 'id' | 'createdAt' | 'updatedAt' | 'at'>[] = [];
      await pointBefore(`import Excel (${fileName})`);
      let i = 0;
      for (const key of toImport) {
        const list = groups.get(key)!;
        i++;
        if (i % 20 === 0) { setProgress(`${i} / ${groups.size} articles…`); await new Promise((r) => setTimeout(r)); }
        const first = list[0];
        const names = list.map((r) => cleanName(r.name, r.color, r.size)).filter(Boolean);
        const name = names.sort((a, b) => names.filter((x) => x === b).length - names.filter((x) => x === a).length || a.length - b.length)[0] || first.model;
        const catName = list.find((r) => r.category)?.category;
        let categoryId = defaultCat || undefined;
        if (catName) { if (!catCache.has(catName)) catCache.set(catName, await ensureCategory(catName)); categoryId = catCache.get(catName); }
        const pv = list.find((r) => r.pv)?.pv; const pvg = list.find((r) => r.pvg)?.pvg;
        const photoBlob = list.map((r) => photos.get(r.photoRow)).find(Boolean);
        const photo = photoBlob ? await blobToThumb(photoBlob).catch(() => undefined) : undefined;
        // Plusieurs couleurs avec chacune sa photo : chaque couleur garde la sienne (compressée une seule fois).
        const colorPhoto = new Map<string, string>();
        const colors = [...new Set(list.map((r) => r.color.toLowerCase()))];
        if (colors.length > 1) {
          for (const c of colors) {
            const b = list.filter((r) => r.color.toLowerCase() === c).map((r) => photos.get(r.photoRow)).find(Boolean);
            // La première couleur utilise la photo de l'article : rien à stocker en plus.
            if (b && b !== photoBlob) { const ph = await blobToThumb(b).catch(() => undefined); if (ph) colorPhoto.set(c, ph); }
          }
        }
        let prod = findProductByCode(first.model);
        let productId: string;
        if (prod) {
          productId = prod.id;
          await save('products', { id: prod.id, priceRetail: prod.priceRetail ?? pv, priceWholesale: prod.priceWholesale ?? pvg, categoryId: prod.categoryId ?? categoryId, photo: prod.photo ?? photo });
        } else {
          productId = newId();
          newProducts.push({ id: productId, code: first.model, name, categoryId, priceRetail: pv, priceWholesale: pvg, photo, active: true, alertQty: 3 });
        }
        const existingVariants = prod ? productVariants(prod.id) : [];
        const existingIds = new Set(existingVariants.map((v) => v.id));
        const bySku = new Map<string, Partial<Variant> & { _stock: number }>();
        const colorTaken = new Set<string>(); // une seule copie de la photo par couleur
        const takePhoto = (color: string) => { const k = color.toLowerCase(); if (colorTaken.has(k)) return undefined; const ph = colorPhoto.get(k); if (ph) colorTaken.add(k); return ph; };
        for (const r of list) {
          const k = r.code.toUpperCase().replace(/\s+/g, '');
          const cur = bySku.get(k);
          if (cur) { cur._stock += Math.max(0, r.stock); continue; }
          const ex = existingVariants.find((v) => v.sku.toUpperCase().replace(/\s+/g, '') === k);
          const v: Partial<Variant> & { _stock: number } = ex
            ? { id: ex.id, _stock: Math.max(0, r.stock), costAvg: ex.costAvg ?? r.cost, photo: ex.photo ?? takePhoto(r.color) }
            : { id: newId(), productId, sku: r.code, color: r.color || undefined, size: r.size || undefined, costAvg: r.cost, active: true, _stock: Math.max(0, r.stock), photo: takePhoto(r.color),
                priceRetail: r.pv && pv && r.pv !== pv ? r.pv : undefined, priceWholesale: r.pvg && pvg && r.pvg !== pvg ? r.pvg : undefined };
          (ex ? updVariants : newVariants).push(v);
          bySku.set(k, v);
        }
        for (const v of bySku.values()) {
          // Stock du fichier = stock de départ : une variante existante est remise à cette quantité (jamais additionnée).
          if (existingIds.has(v.id!)) { const d = v._stock - stockOf(v.id!); if (d) moves.push({ variantId: v.id!, qty: d, type: 'inventory', unitCost: v.costAvg, reason: `Import ${fileName} : stock remis à ${v._stock}` }); }
          else if (v._stock > 0) moves.push({ variantId: v.id!, qty: v._stock, type: 'initial', unitCost: v.costAvg, reason: `Import ${fileName}` });
        }
      }
      setProgress('Enregistrement…');
      const strip = (v: any) => { const { _stock, ...rest } = v; return rest; };
      if (newProducts.length) await save('products', newProducts);
      if (newVariants.length) await save('variants', newVariants.map(strip));
      if (updVariants.length) await save('variants', updVariants.map(strip));
      await addMoves(moves);
      const initial = moves.filter((m) => m.type === 'initial').reduce((s, m) => s + m.qty, 0);
      const reset = new Set(moves.filter((m) => m.type === 'inventory').map((m) => m.variantId)).size;
      await audit('Import Excel', `${fileName} : ${newProducts.length} article(s) créé(s), ${newVariants.length} variante(s), ${initial} pièce(s) en stock initial${reset ? `, ${reset} stock(s) remis à la quantité du fichier` : ''}${sameCount ? `, ${sameCount} identique(s) ignoré(s)` : ''}`);
      toast(`Import terminé : ${newProducts.length} article(s) créé(s)${reset ? `, ${reset} stock(s) remis à jour` : ''}${sameCount ? `, ${sameCount} identique(s) ignoré(s)` : ''}`);
      onDone();
    } catch (e: any) { toast(e.message, 'error'); } finally { setBusy(false); setProgress(''); }
  }

  return (
    <div className="card stack">
      <div className="row-between"><h2>Articles et stock — {fileName}</h2><Badge tone="brand">Feuille « {sheet.name} »</Badge></div>
      <div className="kv-row">
        <div><span className="small muted">Articles</span><strong className="num">{groups.size}{existing ? ` (${existing} déjà existants)` : ''}</strong></div>
        <div><span className="small muted">Variantes</span><strong className="num">{rows.length}</strong></div>
        <div><span className="small muted">Stock initial</span><strong className="num">{fmtNum(totalStock)} pcs</strong></div>
        <div><span className="small muted">Valeur</span><strong className="num">{fmtAr(totalValue)}</strong></div>
        <div><span className="small muted">Photos</span><strong className="num">{photos.size}</strong></div>
      </div>
      {map.category == null && <SelectField label="Catégorie à donner aux articles (le fichier n’en a pas)" value={defaultCat} onChange={setDefaultCat} options={categoryOptions(categories)} />}
      {existing > 0 && <div className="notice"><Icon name="alert" /><span>{existing} article(s) existent déjà{sameCount ? ` (${sameCount} identique(s) : ignoré(s))` : ''}. Leurs nouvelles variantes seront ajoutées, et le stock est <strong>remplacé</strong> par la quantité du fichier, jamais additionné{restockCount ? ` (${restockCount} variante(s) à remettre à jour)` : ''}.</span></div>}
      {sameCount > 0 && sameCount === groups.size && <div className="notice notice-ok"><Icon name="check" /><span>Ce fichier est déjà importé : tous les articles existent avec le même stock. Rien à enregistrer.</span></div>}
      <TwinNotice count={twinKeys.length} withTwins={withTwins} onChange={setWithTwins} />
      {twinKeys.length > 0 && <p className="small muted">{twinKeys.slice(0, 20).map((k) => { const t = status.get(k)!.twin!; return `${groups.get(k)![0].model} → « ${t.name} » (page ${t.page})`; }).join(' · ')}{twinKeys.length > 20 ? '…' : ''}</p>}
      {warnings.length > 0 && (
        <details className="warn-box">
          <summary><strong>{warnings.length} point(s) à vérifier</strong> — l’import peut se faire quand même</summary>
          <ul className="small">{warnings.slice(0, 80).map((w, i) => <li key={i}>{w}</li>)}</ul>
          {warnings.length > 80 && <p className="small muted">… et {warnings.length - 80} autres.</p>}
        </details>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Article</th><th>Variantes</th><th className="t-num">Stock</th><th className="t-num">PV détail</th></tr></thead>
          <tbody>
            {preview.map((list) => (
              <tr key={list[0].model}>
                <td><div className="row" style={{ gap: 10, flexWrap: 'nowrap' }}><PreviewPhoto blob={list.map((r) => photos.get(r.photoRow)).find(Boolean)} /><div><strong>{list[0].model}</strong><div className="small muted">{cleanName(list[0].name, list[0].color, list[0].size) || '—'}</div></div></div></td>
                <td className="small">{list.map((r) => [r.color, r.size].filter(Boolean).join(' ') || 'unique').join(', ')}</td>
                <td className="t-num num">{list.reduce((s, r) => s + Math.max(0, r.stock), 0)}</td>
                <td className="t-num">{fmtAr(list.find((r) => r.pv)?.pv)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {groups.size > preview.length && <p className="small muted">… et {groups.size - preview.length} autres articles.</p>}
      <div className="row-between">
        <span className="small muted">{progress}</span>
        <Button icon="check" busy={busy} disabled={!toImport.length} onClick={run}>{toImport.length ? `Importer ${toImport.length} article(s)` : 'Rien à importer'}</Button>
      </div>
    </div>
  );
}

function PreviewPhoto({ blob }: { blob?: Blob }) {
  const [src] = useState(() => (blob ? URL.createObjectURL(blob) : undefined));
  return <Thumb src={src} size={36} />;
}

// ---------- Import d'un fichier de commande Chine ----------
const MONTHS: Record<string, number> = { janv: 1, janvier: 1, fev: 2, fevrier: 2, mars: 3, avr: 4, avril: 4, mai: 5, juin: 6, juil: 7, juillet: 7, aout: 8, sept: 9, septembre: 9, oct: 10, octobre: 10, nov: 11, novembre: 11, dec: 12, decembre: 12 };
function parseFileName(name: string) {
  const base = name.replace(/\.xlsx$/i, '').replace(/^[0-9a-f]{8}-/i, '');
  const n = base.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const m = /(\d{1,2})\s*_?([a-z]+)\s*_?(\d{4})/.exec(n);
  let date: string | undefined;
  if (m && MONTHS[m[2]]) date = `${m[3]}-${String(MONTHS[m[2]]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const after = m ? base.slice(n.indexOf(m[3]) + 4) : base;
  const family = after.replace(/[_-]+/g, ' ').replace(/^commande\s*/i, '').trim();
  return { date, family: family ? family.charAt(0).toUpperCase() + family.slice(1) : '' };
}

function OrderImport({ sheets, fileName, blocked, onDone }: { sheets: Sheet[]; fileName: string; blocked?: boolean; onDone: (purchaseId: string) => void }) {
  const { categories } = useCatalog();
  const suppliers = all<Supplier>('suppliers');
  const sheet = sheets.find((s) => findHeader(s, ORDER_COLS, ['ref', 'size', 'qty', 'pu']))!;
  const { row: hr, map } = findHeader(sheet, ORDER_COLS, ['ref', 'size', 'qty', 'pu'])!;
  const fromName = parseFileName(fileName);
  // Lecture des lignes (référence et n° de commande reportés vers le bas).
  const rows: { line: number; ref: string; order: string; tracking: string; link: string; size: string; qty: number; received?: number; pu: number; fees?: number; discount?: number; buyAr?: number; state: string; obs?: string; volume?: number; transit?: number; cost?: number; pv?: number; pvg?: number; row: number }[] = [];
  let ref = '', order = '', tracking = '', link = '';
  for (let r = hr + 1; r < sheet.rows.length; r++) {
    const x = sheet.rows[r] || [];
    const g = (k: string) => (map[k] != null ? x[map[k]] : null);
    const qty = parseNum(g('qty') as any);
    if (!qty || !str(g('size'))) continue;
    ref = str(g('ref')) || ref; order = str(g('order')) || order; tracking = str(g('tracking')) || tracking; link = str(g('link')) || link;
    rows.push({ line: r + 1, row: r, ref, order, tracking, link, size: normSize(str(g('size'))), qty, received: parseNum(g('received') as any), pu: parseNum(g('pu') as any) ?? 0,
      fees: parseNum(g('fees') as any), discount: parseNum(g('discount') as any), buyAr: parseNum(g('buyAr') as any), state: str(g('state')), obs: excelDate(g('obs')),
      volume: parseNum(g('volume') as any), transit: parseNum(g('transit') as any), cost: parseNum(g('cost') as any), pv: parseNum(g('pv') as any), pvg: parseNum(g('pvg') as any) });
  }
  const refs = [...new Set(rows.map((r) => r.ref))];
  const orders = [...new Set(rows.map((r) => r.order || '—'))];
  const totalQty = rows.reduce((s, r) => s + r.qty, 0);
  const totalReceived = rows.reduce((s, r) => s + (r.received ?? 0), 0);
  const fees = rows.reduce((s, r) => s + (r.fees ?? 0), 0);
  const discount = rows.reduce((s, r) => s + (r.discount ?? 0), 0);
  const feeUnit = totalQty ? fees / totalQty : 0;
  const rateRow = rows.find((r) => r.buyAr && r.pu);
  const detectedRate = rateRow ? Math.round((rateRow.buyAr! / (rateRow.pu + feeUnit)) * 100) / 100 : undefined;
  const isReceived = rows.some((r) => /recu|reçu/i.test(r.state)) || totalReceived > 0;
  const receivedDate = rows.find((r) => r.obs)?.obs;
  const transitTotal = rows.reduce((s, r) => s + (r.transit ?? 0), 0);
  const volume = rows.reduce((s, r) => s + (r.volume ?? 0), 0);
  const photos = new Map<string, Blob>();
  for (const im of sheet.images) { const rr = rows.find((x) => x.row === im.row) || rows.find((x) => x.row > im.row - 1 && x.row <= im.row + 1); if (rr && !photos.has(rr.ref)) photos.set(rr.ref, im.blob); }

  const [family, setFamily] = useState(fromName.family || 'Article');
  const [catId, setCatId] = useState(() => categories.find((c) => c.name.toLowerCase() === (fromName.family || '').toLowerCase())?.id ?? '__new');
  const [newCat, setNewCat] = useState(fromName.family || '');
  const [rate, setRate] = useState(String(detectedRate ?? lastRate('rmb') ?? ''));
  const [date, setDate] = useState(fromName.date ?? todayYmd());
  const [supplierId, setSupplierId] = useState('');
  const [mode, setMode] = useState<'pending' | 'history' | 'stock'>(isReceived ? 'history' : 'pending');
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const categoryId = catId === '__new' ? (newCat.trim() ? await ensureCategory(newCat) : undefined) : catId || undefined;
      const variantFor = new Map<string, string>();
      const newVariants: Partial<Variant>[] = [];
      const costUpdates: Partial<Variant>[] = [];
      for (const ref of refs) {
        const list = rows.filter((r) => r.ref === ref);
        const pv = list.find((r) => r.pv)?.pv, pvg = list.find((r) => r.pvg)?.pvg;
        let prod = findProductByCode(ref);
        const photoBlob = photos.get(ref);
        const photo = photoBlob ? await blobToThumb(photoBlob).catch(() => undefined) : undefined;
        if (!prod) {
          const [p] = await save('products', { code: ref, name: `${family} ${ref}`.trim(), categoryId, priceRetail: pv, priceWholesale: pvg, link: list[0].link || undefined, photo, active: true, alertQty: 3 });
          prod = p as Product;
        } else {
          await save('products', { id: prod.id, priceRetail: pv ?? prod.priceRetail, priceWholesale: pvg ?? prod.priceWholesale, photo: prod.photo ?? photo, link: prod.link ?? (list[0].link || undefined) });
        }
        const existing = [...productVariants(prod.id)];
        for (const r of list) {
          let v = existing.find((x) => (x.size || '') === r.size && !x.color) || existing.find((x) => (x.size || '') === r.size);
          if (!v) {
            const nv = { id: newId(), productId: prod.id, sku: makeSku(ref, undefined, r.size), size: r.size || undefined, active: true } as Variant;
            newVariants.push(nv); existing.push(nv); v = nv;
          }
          variantFor.set(`${ref}|${r.size}|${r.line}`, v.id);
          if (mode === 'history' && r.cost) costUpdates.push({ id: v.id, costAvg: Math.round(r.cost * 100) / 100 });
        }
      }
      if (newVariants.length) await save('variants', newVariants);
      if (costUpdates.length) await save('variants', costUpdates);

      let firstId = '';
      for (const ord of orders) {
        const list = rows.filter((r) => (r.order || '—') === ord);
        const lines: PurchaseLine[] = list.map((r) => ({ id: newId(), variantId: variantFor.get(`${r.ref}|${r.size}|${r.line}`)!, qtyOrdered: r.qty, qtyReceived: mode === 'history' ? (r.received ?? r.qty) : 0, unitPrice: r.pu }));
        const status = mode === 'pending' ? 'ordered' : 'arrived';
        const [p] = await save('purchases', {
          number: nextNumber('CMD', 'purchases'), supplierId: supplierId || undefined, orderRef: ord === '—' ? undefined : ord, trackingNo: list[0].tracking || undefined, link: list[0].link || undefined,
          date, currency: 'RMB', rate: parseNum(rate) || 0, chinaFees: list.reduce((s, r) => s + (r.fees ?? 0), 0), discount: list.reduce((s, r) => s + (r.discount ?? 0), 0),
          status: mode === 'history' ? 'received' : status, statusDates: { ordered: date, ...(mode !== 'pending' && receivedDate ? { received: receivedDate } : {}) },
          lines, payments: [], notes: `Importé depuis ${fileName}`,
        });
        firstId ||= p.id;
        if (mode === 'stock') {
          const purchase = p as Purchase;
          const transit = list.reduce((s, r) => s + (r.transit ?? 0), 0);
          const vol = list.reduce((s, r) => s + (r.volume ?? 0), 0);
          const items = purchase.lines.map((l) => {
            const r = list.find((x) => variantFor.get(`${x.ref}|${x.size}|${x.line}`) === l.variantId)!;
            const qty = r.received ?? r.qty;
            const goods = (l.unitPrice + feeUnit - (totalQty ? discount / totalQty : 0)) * (purchase.rate || 0);
            const recQty = list.reduce((s, x) => s + (x.received ?? x.qty), 0) || 1;
            const share = transit / recQty;
            return { purchaseId: purchase.id, lineId: l.id, variantId: l.variantId, qty, goodsUnitAr: Math.round(goods * 100) / 100, transitUnitAr: Math.round(share * 100) / 100, unitCost: Math.round((goods + share) * 100) / 100 };
          });
          await validateReception({ number: nextNumber('REC', 'receptions'), date: receivedDate ?? todayYmd(), purchaseIds: [purchase.id], allocation: 'quantity', transitTotalAr: transit, items,
            invoice: { mode: 'sea', billedQty: vol, tariff: vol ? transit / vol : 0, tariffCurrency: 'MGA', fx: 1, otherFees: [] }, notes: `Importé depuis ${fileName}` });
        }
      }
      await audit('Import commande Chine', `${fileName} : ${refs.length} article(s), ${totalQty} pièce(s) (${mode === 'pending' ? 'en attente' : mode === 'stock' ? 'reçue et ajoutée au stock' : 'historique'})`);
      toast('Commande importée');
      onDone(firstId);
    } catch (e: any) { toast(e.message, 'error'); } finally { setBusy(false); }
  }

  return (
    <div className="card stack">
      <div className="row-between"><h2>Commande Chine — {fileName.replace(/^[0-9a-f]{8}-/i, '')}</h2><Badge tone={isReceived ? 'ok' : 'brand'}>{isReceived ? 'Reçue d’après le fichier' : 'En attente d’après le fichier'}</Badge></div>
      <div className="kv-row">
        <div><span className="small muted">Références</span><strong>{refs.join(', ')}</strong></div>
        <div><span className="small muted">Pièces</span><strong className="num">{fmtNum(totalQty)}{totalReceived ? ` (${fmtNum(totalReceived)} reçues)` : ''}</strong></div>
        <div><span className="small muted">N° de commande</span><strong>{orders.join(', ')}</strong></div>
        <div><span className="small muted">Photos</span><strong className="num">{photos.size}</strong></div>
        {transitTotal > 0 && <div><span className="small muted">Transit du fichier</span><strong className="num">{fmtAr(transitTotal)}{volume ? ` (${fmtNum(volume, 2)} m³)` : ''}</strong></div>}
      </div>
      <div className="grid-2">
        <TextField label="Nom des articles" value={family} onChange={setFamily} hint={`Les articles s’appelleront « ${family} ${refs[0]} », etc.`} />
        <SelectField label="Catégorie" value={catId} onChange={setCatId} options={[...categoryOptions(categories), { value: '__new', label: '+ Nouvelle catégorie…' }]} />
        {catId === '__new' && <TextField label="Nouvelle catégorie" value={newCat} onChange={setNewCat} />}
        <TextField label="Taux : 1 ¥ = … Ar" required value={rate} onChange={setRate} inputMode="decimal" hint={detectedRate ? `Trouvé dans le fichier : ${detectedRate}` : 'Le taux utilisé pour cette commande.'} />
        <TextField label="Date de commande" type="date" value={date} onChange={setDate} />
        <SelectField label="Fournisseur" value={supplierId} onChange={setSupplierId} options={[{ value: '', label: 'Non indiqué' }, ...suppliers.map((s) => ({ value: s.id, label: s.name }))]} />
      </div>
      <fieldset className="radio-group">
        <legend><strong>Que faire de cette commande ?</strong></legend>
        <label><input type="radio" checked={mode === 'pending'} onChange={() => setMode('pending')} /> <span><strong>En attente d’arrivée</strong><br /><span className="small muted">Les pièces apparaissent « en arrivage ». Le stock augmentera à la réception, avec la facture du transit.</span></span></label>
        <label><input type="radio" checked={mode === 'history'} onChange={() => setMode('history')} /> <span><strong>Déjà reçue et déjà comptée dans mon stock</strong><br /><span className="small muted">Gardée comme historique. Le stock ne change pas. Le prix de revient du fichier devient le coût de l’article.</span></span></label>
        <label><input type="radio" checked={mode === 'stock'} onChange={() => setMode('stock')} /> <span><strong>Déjà reçue, à ajouter au stock maintenant</strong><br /><span className="small muted">Les quantités reçues entrent en stock, avec le transit du fichier ({fmtAr(transitTotal)}).</span></span></label>
      </fieldset>
      <div className="row-between">
        <span className="small muted">{refs.length} article(s) · {rows.length} ligne(s)</span>
        <Button icon="check" busy={busy} disabled={!parseNum(rate) || blocked} onClick={run}>Importer la commande</Button>
      </div>
    </div>
  );
}

// ---------- Fournisseurs, catégories ----------
function SimpleImport({ kind, sheets, onDone }: { kind: 'fournisseurs' | 'categories'; sheets: Sheet[]; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const rows = sheets[0].rows.slice(1).filter((r) => str(r?.[0]));
  return (
    <div className="card stack">
      <h2>{kind === 'fournisseurs' ? 'Fournisseurs' : 'Catégories'} : {rows.length} ligne(s)</h2>
      <p className="small">{rows.slice(0, 15).map((r) => str(r[0])).join(', ')}{rows.length > 15 ? '…' : ''}</p>
      <div><Button icon="check" busy={busy} onClick={async () => {
        setBusy(true);
        if (kind === 'fournisseurs') {
          const ex = new Set(all<Supplier>('suppliers').map((s) => s.name.toLowerCase()));
          const list = rows.filter((r) => !ex.has(str(r[0]).toLowerCase())).map((r) => ({ name: str(r[0]), shop: str(r[1]) || undefined, contact: str(r[2]) || undefined, city: str(r[3]) || undefined, notes: str(r[4]) || undefined }));
          if (list.length) await save('suppliers', list);
          toast(`${list.length} fournisseur(s) ajouté(s)`);
        } else {
          for (const r of rows) {
            const parent = str(r[1]) ? await ensureCategory(str(r[1])) : undefined;
            await ensureCategory(str(r[0]), parent);
          }
          toast(`${rows.length} catégorie(s) importée(s)`);
        }
        setBusy(false); onDone();
      }}>Importer</Button></div>
    </div>
  );
}

export { get };
