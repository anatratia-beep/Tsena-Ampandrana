// Import d'un fichier Excel « à vous » (vos colonnes, vos titres) avec les variantes de la page :
// on indique quelle colonne correspond à chaque variante (Modèle, Couleur, Pointure…) et aux prix / stock,
// les valeurs nouvelles (ex. S6, 36-37) peuvent être ajoutées automatiquement à la page, puis chaque ligne est
// contrôlée avant d'enregistrer. Un fichier peut contenir plusieurs pages (colonne Catégorie / Page).
import { useEffect, useMemo, useRef, useState } from 'react';
import { save } from '../lib/db';
import { audit } from '../lib/auth';
import { fmtAr, normText, useCatalog, type CatAttr, type Category } from '../lib/catalog';
import { FIXED, PHOTO_COL, activeAttrs, parseCategoryFile, rowState, rowsToSave, saveArticles, shortId, suggestCode, type ImportRow } from '../lib/attrs';
import { blobToThumb, colLetter, normHeader, type Cell, type Sheet } from '../lib/xlsx';
import { Badge, Button, Help, SelectField, toast } from '../ui/kit';
import { Icon } from '../ui/icons';

const str = (v: Cell) => (v == null ? '' : String(v).trim());
type FixedKey = 'category' | 'name' | 'cost' | 'retail' | 'wholesale' | 'stock' | 'alert';
const FIXED_LABEL: Record<FixedKey, string> = { category: 'Catégorie / page', name: 'Nom de l’article (facultatif)', cost: 'Prix de revient', retail: 'PV détail', wholesale: 'PV gros', stock: 'Stock', alert: 'Alerte stock bas' };
const FIXED_GUESS: Record<FixedKey, (h: string) => boolean> = {
  category: (h) => ['categorie', 'page', 'category'].includes(h),
  name: (h) => ['nom', 'nom article', 'nom articles', 'nom de l article', 'designation', 'libelle', 'article'].includes(h),
  cost: (h) => h.startsWith('prix de revient') || ['pr', 'pru', 'cout', 'cout de revient', 'revient'].includes(h),
  retail: (h) => h.startsWith('pv detail') || h.startsWith('prix detail') || ['pv det', 'prix de vente', 'pv'].includes(h),
  wholesale: (h) => h.startsWith('pv gros') || h.startsWith('prix de gros') || h === 'pv grs',
  stock: (h) => h.startsWith('stock') || h.startsWith('stk') || h.startsWith('qte') || h.startsWith('quantite'),
  alert: (h) => h.startsWith('alerte'),
};
const ALIASES: Record<string, string[]> = { pointure: ['pt', 'p', 'pointures'], taille: ['t', 'tailles', 'size'], couleur: ['coul', 'couleurs', 'color', 'colori'], modele: ['model', 'mod', 'modeles', 'ref', 'reference'], age: ['ages'], puissance: ['watt', 'w'], type: ['types'] };

/** Ligne des titres : la première (parmi les 12 premières) qui contient au moins 3 textes. */
export function headerRowOf(sh: Sheet) {
  for (let r = 0; r < Math.min(12, sh.rows.length); r++) if ((sh.rows[r] ?? []).filter((c) => typeof c === 'string' && c.trim()).length >= 3) return r;
  return -1;
}
function guessAttr(a: CatAttr, heads: string[]) {
  const n = normHeader(a.name);
  const al = ALIASES[n] ?? [];
  let i = heads.findIndex((h) => h === n || al.includes(h));
  if (i < 0) i = heads.findIndex((h) => h.length >= 3 && (h.startsWith(n) || n.startsWith(h)));
  return i;
}
/** Page correspondant à une valeur de la colonne Catégorie (nom ou code, sans accents ni majuscules). */
export function matchPage(raw: string, pages: Category[]) {
  const n = normText(raw).trim();
  if (!n) return undefined;
  const exact = pages.find((c) => normText(c.name).trim() === n || normText(c.code ?? '') === n);
  if (exact) return exact;
  // Nom approché (ex. « Boxer » pour « Boxer homme ») : seulement s'il n'y a qu'une page possible. Sinon on ne devine pas
  // (« Boxer » pourrait être « Boxer homme » ou « Boxer garçon ») : la ligne attend que vous choisissiez la page.
  const close = pages.filter((c) => normText(c.name).startsWith(n) || n.startsWith(normText(c.name).trim()));
  return close.length === 1 ? close[0] : undefined;
}
/** Ce fichier peut-il être lu avec les variantes d'une page ? (colonne Catégorie qui nomme une page, ou titres = variantes). */
export function looksLikePageFile(sheets: Sheet[], pages: Category[]) {
  for (const sh of sheets) {
    const hr = headerRowOf(sh); if (hr < 0) continue;
    const heads = (sh.rows[hr] ?? []).map((c) => normHeader(c));
    const ci = heads.findIndex(FIXED_GUESS.category);
    if (ci >= 0 && sh.rows.slice(hr + 1).some((r) => matchPage(str(r?.[ci]), pages))) return true;
    if (pages.some((p) => activeAttrs(p).length >= 2 && activeAttrs(p).every((a) => guessAttr(a, heads) >= 0))) return true;
  }
  return false;
}

function MiniPhoto({ blob }: { blob: Blob }) {
  const [url, setUrl] = useState('');
  useEffect(() => { const u = URL.createObjectURL(blob); setUrl(u); return () => URL.revokeObjectURL(u); }, [blob]);
  return url ? <img className="imp-photo" src={url} alt="" /> : null;
}

/** Erreurs d'abord, puis nouveaux et mises à jour, puis doublons probables, puis lignes identiques. */
export const sortRows = (rows: ImportRow[]) => {
  const rank = (r: ImportRow) => (r.errors.length ? 0 : r.twin ? 2 : r.same ? 3 : 1);
  return [...rows].sort((a, b) => rank(a) - rank(b) || a.line - b.line);
};

/** Compteurs du contrôle : nouveaux, mises à jour, identiques ignorés, doublons probables, erreurs. */
export function ImportBadges({ rows, withTwins }: { rows: ImportRow[]; withTwins: boolean }) {
  const ok = rowsToSave(rows, withTwins);
  const same = rows.filter((r) => r.same).length;
  const twins = rows.filter((r) => !r.errors.length && r.twin).length;
  const bad = rows.filter((r) => r.errors.length).length;
  return (
    <div className="row" style={{ gap: 6 }}>
      <Badge tone="ok">{ok.filter((r) => !r.exists).length} nouveau(x)</Badge>
      <Badge tone="brand">{ok.filter((r) => r.exists).length} mise(s) à jour</Badge>
      {same > 0 && <Badge tone="neutral">{same} identique(s) ignoré(s)</Badge>}
      {twins > 0 && <Badge tone="warn">{twins} doublon(s) probable(s){withTwins ? '' : ' ignoré(s)'}</Badge>}
      {bad > 0 && <Badge tone="danger">{bad} ligne(s) en erreur</Badge>}
    </div>
  );
}

/** Nouveaux articles qui existent déjà ailleurs : ignorés par défaut, on peut choisir de les créer quand même. */
export function TwinNotice({ count, withTwins, onChange }: { count: number; withTwins: boolean; onChange: (v: boolean) => void }) {
  if (!count) return null;
  return (
    <div className="notice notice-warn"><Icon name="alert" /><span>
      <strong>{count} article(s) existent déjà dans une autre page</strong> (ou sous un autre code) : ils ne seront pas créés une deuxième fois. Vérifiez que vous avez choisi la bonne page.
      <label className="row small" style={{ gap: 6, marginTop: 6 }}><input type="checkbox" checked={withTwins} onChange={(e) => onChange(e.target.checked)} /> Ce sont des articles différents : les créer quand même</label>
    </span></div>
  );
}

export function MappedImport({ sheets, onDone, onSimple }: { sheets: Sheet[]; onDone: (pageId?: string) => void; onSimple?: () => void }) {
  const { categories } = useCatalog();
  const pages = categories.filter((c) => activeAttrs(c).length).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const sheet = sheets.find((s) => headerRowOf(s) >= 0 && s.name !== 'Mode d\'emploi') ?? sheets[0];
  const hr = Math.max(0, headerRowOf(sheet));
  const headers = (sheet.rows[hr] ?? []).map((c) => str(c));
  const heads = headers.map((h) => normHeader(h));
  const colOpts = [{ value: '-1', label: '— aucune —' }, ...headers.map((h, i) => ({ value: String(i), label: `${colLetter(i)} · ${h || '(sans titre)'}` })).filter((o) => o.label)];
  const [fixed, setFixed] = useState<Record<FixedKey, number>>(() => Object.fromEntries((Object.keys(FIXED_GUESS) as FixedKey[]).map((k) => [k, heads.findIndex(FIXED_GUESS[k])])) as Record<FixedKey, number>);
  const dataRows = useMemo(() => { const out: number[] = []; for (let r = hr + 1; r < sheet.rows.length; r++) if ((sheet.rows[r] ?? []).some((c) => str(c))) out.push(r); return out; }, [sheet, hr]);
  const groupOf = (r: number) => (fixed.category >= 0 ? str(sheet.rows[r]?.[fixed.category]) : '');
  const groups = useMemo(() => { const m = new Map<string, number>(); for (const r of dataRows) { const g = groupOf(r); m.set(g, (m.get(g) ?? 0) + 1); } return [...m.entries()]; }, [dataRows, fixed.category]);
  const [groupPage, setGroupPage] = useState<Record<string, string>>({});
  const pageOfGroup = (g: string) => groupPage[g] ?? (g ? matchPage(g, pages)?.id : pages.length === 1 ? pages[0].id : '') ?? '';
  const [attrCols, setAttrCols] = useState<Record<string, number>>({}); // `${pageId}:${attrId}` → colonne
  const colOfAttr = (p: Category, a: CatAttr) => attrCols[`${p.id}:${a.id}`] ?? guessAttr(a, heads);
  const [addNew, setAddNew] = useState(true);
  const [negZero, setNegZero] = useState(true);
  const [noPrice, setNoPrice] = useState(true);
  const [skip, setSkip] = useState(false);
  const [withTwins, setWithTwins] = useState(false);
  const [busy, setBusy] = useState(false);
  const newIds = useRef(new Map<string, string>()); // identifiants stables des valeurs à ajouter

  const usedPages = [...new Set(groups.map(([g]) => pageOfGroup(g)).filter(Boolean))].map((id) => pages.find((p) => p.id === id)!).filter(Boolean);

  /** Pour chaque page : catégorie complétée (valeurs nouvelles), lignes contrôlées, valeurs ajoutées. */
  const plan = useMemo(() => usedPages.map((p) => {
    const rows = dataRows.filter((r) => pageOfGroup(groupOf(r)) === p.id);
    const attrs = activeAttrs(p);
    const added: { attr: string; label: string }[] = [];
    const cat: Category = { ...p, attrs: (p.attrs ?? []).map((a) => ({ ...a, values: [...a.values] })) };
    if (addNew) for (const a of cat.attrs!.filter((x) => x.active !== false)) {
      const c = colOfAttr(p, a); if (c < 0) continue;
      for (const r of rows) {
        const raw = str(sheet.rows[r]?.[c]); if (!raw) continue;
        const n = normText(raw).replace(/\s+/g, ' ').trim();
        if (a.values.some((v) => normText(v.label).trim() === n || normText(v.code) === n.replace(/\s/g, ''))) continue;
        const key = `${p.id}:${a.id}:${n}`;
        if (!newIds.current.has(key)) newIds.current.set(key, shortId());
        const taken = a.values.map((v) => v.code);
        const code = /\d/.test(raw) && raw.replace(/\s/g, '').length <= 8 ? raw.toUpperCase().replace(/[^A-Z0-9.\-]/g, '') : suggestCode(raw, taken);
        a.values.push({ id: newIds.current.get(key)!, label: raw, code: taken.includes(code) ? suggestCode(raw, taken) : code });
        added.push({ attr: a.name, label: raw });
      }
    }
    // Feuille au format du fichier de la page, puis contrôle ligne par ligne.
    const head: Cell[] = [...attrs.map((a) => a.name), ...FIXED, PHOTO_COL];
    const fx: FixedKey[] = ['name', 'cost', 'retail', 'wholesale', 'stock', 'alert'];
    let negatives = 0;
    const vrows: Cell[][] = [head, ...rows.map((r) => {
      const src = sheet.rows[r] ?? [];
      return [...attrs.map((a) => { const c = colOfAttr(p, a); return c >= 0 ? src[c] ?? null : null; }), ...fx.map((k) => {
        const v = fixed[k] >= 0 ? src[fixed[k]] ?? null : null;
        if (k === 'stock' && negZero && typeof v === 'number' && v < 0) { negatives++; return 0; }
        return v;
      }), null];
    })];
    const photoOf = new Map<number, Blob>();
    for (const im of sheet.images ?? []) {
      const m = (sheet.merges ?? []).find((g) => im.row >= g.r1 && im.row <= g.r2 && im.col >= g.c1 && im.col <= g.c2);
      for (let r = m ? m.r1 : im.row; r <= (m ? m.r2 : im.row); r++) if (!photoOf.has(r)) photoOf.set(r, im.blob);
    }
    const images = rows.flatMap((r, i) => (photoOf.has(r) ? [{ row: i + 1, col: head.length - 1, blob: photoOf.get(r)! }] : []));
    const parsed: ImportRow[] = parseCategoryFile(cat, [{ name: 'Articles', rows: vrows, merges: [], images }], { allowNoPrice: noPrice }).map((x) => ({ ...x, line: rows[x.line - 2] + 1 }));
    const missingCols = attrs.filter((a) => a.required !== false && colOfAttr(p, a) < 0).map((a) => a.name);
    return { p, cat, rows: parsed, added, negatives, missingCols, count: rows.length };
  }), [usedPages.map((p) => p.id).join(), dataRows, fixed, attrCols, groupPage, addNew, negZero, noPrice, categories]);

  const allRows = plan.flatMap((x) => x.rows);
  const bad = allRows.filter((r) => r.errors.length);
  const ok = rowsToSave(allRows, withTwins);
  const same = allRows.filter((r) => r.same).length;
  const twins = allRows.filter((r) => !r.errors.length && r.twin).length;
  const unassigned = groups.filter(([g]) => !pageOfGroup(g)).reduce((t, [, n]) => t + n, 0);
  const canGo = ok.length > 0 && (!bad.length || skip) && plan.every((x) => !x.missingCols.length || x.rows.every((r) => r.errors.length));

  async function run() {
    setBusy(true);
    try {
      let created = 0, updated = 0;
      for (const x of plan) {
        const good = rowsToSave(x.rows, withTwins);
        if (!good.length) continue;
        if (x.added.length) {
          await save('categories', { id: x.p.id, attrs: x.cat.attrs });
          await audit('Variantes', `${x.p.name} : ${x.added.length} valeur(s) ajoutée(s) à l’import (${x.added.map((a) => `${a.attr} ${a.label}`).join(', ')})`, 'categories', x.p.id);
        }
        const thumbs = new Map<Blob, string>();
        for (const r of good) if (r.photo && !thumbs.has(r.photo)) { const t = await blobToThumb(r.photo).catch(() => undefined); if (t) thumbs.set(r.photo, t); }
        const res = await saveArticles(x.cat, good.map((r) => ({ ...r.input!, photo: r.photo ? thumbs.get(r.photo) : undefined })), 'Import Excel');
        created += res.created; updated += res.updated;
      }
      toast(`${created} article(s) créé(s), ${updated} mis à jour${same ? `, ${same} identique(s) ignoré(s)` : ''}`);
      onDone(plan.length === 1 ? plan[0].p.id : undefined);
    } catch (e: any) { toast(e?.message ?? String(e), 'error'); setBusy(false); }
  }

  if (!pages.length) return <div className="card"><p>Aucune page n’a encore de variantes : créez d’abord la page et ses variantes dans <a href="#/pages">Pages et variantes</a>.</p></div>;
  return (
    <div className="stack">
      <div className="card stack">
        <div className="row-between"><h2>Lire votre fichier avec les variantes de la page</h2>{onSimple && <button type="button" className="link-btn" onClick={onSimple}>Importer plutôt en articles simples (couleur / taille)</button>}</div>
        <Help>Votre fichier garde ses propres colonnes. Indiquez ci-dessous quelle colonne correspond à quoi (c’est déjà deviné d’après les titres : vérifiez). Chaque variante de la page (ex. Modèle, Couleur, Pointure) doit avoir sa colonne. Les lignes sont contrôlées avant d’enregistrer ; rien n’est enregistré tant que vous n’avez pas touché « Importer ».</Help>
        <h3>1. Colonnes communes ({dataRows.length} ligne(s) dans « {sheet.name} »)</h3>
        <div className="map-grid">
          {(Object.keys(FIXED_LABEL) as FixedKey[]).map((k) => <SelectField key={k} label={FIXED_LABEL[k]} required={k === 'retail' || k === 'stock'} value={String(fixed[k])} onChange={(v) => setFixed({ ...fixed, [k]: Number(v) })} options={colOpts} />)}
        </div>
        <h3>2. Page de chaque ligne</h3>
        {groups.map(([g, n]) => (
          <div key={g || '_'} className="map-group">
            <span><strong>{g || (fixed.category >= 0 ? '(catégorie vide)' : 'Toutes les lignes')}</strong> <span className="small muted">{n} ligne(s)</span></span>
            <SelectField label="Page" value={pageOfGroup(g)} onChange={(v) => setGroupPage({ ...groupPage, [g]: v })} options={[{ value: '', label: 'Ne pas importer ces lignes' }, ...pages.map((p) => ({ value: p.id, label: p.name }))]} />
          </div>
        ))}
        {unassigned > 0 && <p className="small muted">{unassigned} ligne(s) sans page : elles ne seront pas importées.</p>}
        {usedPages.length > 0 && <h3>3. Colonnes des variantes</h3>}
        {usedPages.map((p) => (
          <div key={p.id} className="stack-s">
            <strong className="small">{p.name}</strong>
            <div className="map-grid">{activeAttrs(p).map((a) => <SelectField key={a.id} label={a.required === false ? `${a.name} (facultatif)` : a.name} required={a.required !== false} value={String(colOfAttr(p, a))} onChange={(v) => setAttrCols({ ...attrCols, [`${p.id}:${a.id}`]: Number(v) })} options={colOpts} />)}</div>
          </div>
        ))}
        <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={addNew} onChange={(e) => setAddNew(e.target.checked)} /> Ajouter à la page les valeurs qui n’existent pas encore (ex. un nouveau modèle ou une nouvelle pointure)</label>
        <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={noPrice} onChange={(e) => setNoPrice(e.target.checked)} /> PV détail vide → importer quand même (prix à compléter plus tard dans la fiche article)</label>
        <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={negZero} onChange={(e) => setNegZero(e.target.checked)} /> Stock négatif dans le fichier → importer 0 (à vérifier à l’inventaire)</label>
        {plan.map((x) => x.added.length > 0 && (
          <div key={x.p.id} className="notice"><Icon name="plus" /><span><strong>{x.p.name}</strong> : {x.added.length} valeur(s) nouvelle(s) seront ajoutées — {Object.entries(x.added.reduce((m, a) => ({ ...m, [a.attr]: [...(m[a.attr] ?? []), a.label] }), {} as Record<string, string[]>)).map(([k, v]) => `${k} : ${v.join(', ')}`).join(' · ')}</span></div>
        ))}
        {(() => { const n = allRows.filter((r) => r.photo).length; const photoCol = heads.some((h) => h.startsWith('photo') || h.startsWith('image') || h === 'sary'); return n > 0
          ? <div className="notice notice-ok"><Icon name="check" /><span><strong>{n} photo(s)</strong> trouvée(s) dans le fichier (images posées sur la ligne ou insérées dans la cellule). Elles seront réduites automatiquement (480 px, environ 40 Ko chacune) pour rester légères.</span></div>
          : photoCol ? <div className="notice"><Icon name="alert" /><span>Aucune photo trouvée dans le fichier. Dans Google Sheets, utilisez « Insertion → Image → Image dans la cellule » (ou sur la cellule), puis « Fichier → Télécharger → Microsoft Excel (.xlsx) ». Les liens d’images (formule IMAGE avec une adresse web) ne contiennent pas la photo.</span></div> : null; })()}
        {plan.map((x) => x.negatives > 0 && <p key={x.p.id + 'n'} className="small muted">{x.p.name} : {x.negatives} stock(s) négatif(s) importé(s) à 0.</p>)}
        {plan.map((x) => x.missingCols.length > 0 && <div key={x.p.id + 'm'} className="notice notice-danger"><Icon name="alert" /><span>{x.p.name} : choisissez la colonne de {x.missingCols.join(', ')}.</span></div>)}
      </div>

      {allRows.length > 0 && (
        <div className="card card-flush">
          <div className="card-pad stack-s">
            <h2>Contrôle : {allRows.length} ligne(s)</h2>
            <ImportBadges rows={allRows} withTwins={withTwins} />
            {same > 0 && same === allRows.length - bad.length && <div className="notice notice-ok"><Icon name="check" /><span>Ce fichier est déjà importé : tous les articles existent avec les mêmes prix et le même stock. Rien à enregistrer.</span></div>}
            <TwinNotice count={twins} withTwins={withTwins} onChange={setWithTwins} />
          </div>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Ligne</th><th>Article</th><th>État</th><th className="t-num">Revient</th><th className="t-num">PV détail</th><th className="t-num">PV gros</th><th className="t-num">Stock</th></tr></thead>
            <tbody>{sortRows(allRows).slice(0, 400).map((r) => (
              <tr key={r.line} className={r.errors.length ? 'row-error' : r.same ? 'muted' : ''}>
                <td className="num">{r.line}</td>
                <td><div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>{r.photo ? <MiniPhoto blob={r.photo} /> : <span className="imp-photo imp-nophoto" />}<div><strong>{r.name || '—'}</strong><div className="small muted">{r.label}</div></div></div></td>
                <td className="small">{r.errors.length ? <span className="neg">{rowState(r)}</span> : r.twin && !withTwins ? <span className="warn-text">{rowState(r)}</span> : rowState(r, withTwins)}</td>
                <td className="t-num">{fmtAr(r.input?.cost)}</td><td className="t-num">{r.input && r.input.retail == null && !r.exists ? <span className="warn-text">à compléter</span> : fmtAr(r.input?.retail)}</td><td className="t-num">{fmtAr(r.input?.wholesale ?? r.input?.retail)}</td><td className="t-num">{r.input?.stock ?? '—'}</td>
              </tr>
            ))}</tbody>
          </table></div>
          <div className="card-pad row">
            {bad.length > 0 && <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} /> Importer seulement les {ok.length} ligne(s) correcte(s)</label>}
            <Button busy={busy} disabled={!canGo} onClick={run}>{ok.length ? `Importer ${ok.length} article(s)` : 'Rien à importer'}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
