// Articles et stock → Pages et variantes : chaque page (catégorie) avec ses variantes libres, et création des
// articles à partir des valeurs (un article ou toutes les combinaisons d'un coup). Modèle Excel par page.
import { useMemo, useRef, useState } from 'react';
import { compressPhoto, photoBytes } from '../lib/images';
import { audit, useCan } from '../lib/auth';
import { get, remove, save, useTable } from '../lib/db';
import { categoryPath, fmtAr, normText, parseNum, type AttrValue, type CatAttr, type Category, type Product } from '../lib/catalog';
import {
  ATTR_PRESETS, ATTR_SUGGESTIONS, activeAttrs, activeValues, articleId, articleParts, categoryTemplate, combinations, findArticle,
  makeAttr, saveArticles, shortId, suggestCatCode, suggestCode, usageOf, type Selection,
} from '../lib/attrs';
import { downloadBlob } from '../lib/xlsx';
import { resizeImage } from '../lib/settings';
import { pageRemovalInfo, removePage, restorePage } from '../lib/pages';
import { Help, Button, Confirm, Empty, IconButton, Modal, PageHead, Req, SelectField, TextField, navigate, toast } from '../ui/kit';
import { Icon } from '../ui/icons';

const fileName = (c: Category) => `Tresor-en-ligne-${(c.code || suggestCatCode(c.name)).toLowerCase()}-articles.xlsx`;

export function CategoriesPage() {
  const can = useCan();
  const cats = useTable<Category>('categories');
  const products = useTable<Product>('products');
  const [edit, setEdit] = useState<Category | 'new' | null>(null);
  const [build, setBuild] = useState<Category | null>(null);
  const [del, setDel] = useState<Category | null>(null);
  const list = [...cats].filter((c) => !c.removed).sort((a, b) => categoryPath(a.id).localeCompare(categoryPath(b.id), 'fr'));
  const removedPages = cats.filter((c) => c.removed && !c.parentId).sort((a, b) => (b.removedAt ?? '').localeCompare(a.removedAt ?? ''));
  const count = (id: string) => products.filter((p) => p.categoryId === id && p.active !== false).length;
  const editable = can('catalog.edit');
  return (
    <>
      <PageHead title="Pages et variantes" subtitle="Une page Facebook = une catégorie. Définissez d’abord ses variantes et leurs valeurs, puis créez les articles."
        actions={editable && <Button icon="plus" onClick={() => setEdit('new')}>Nouvelle page</Button>} />
      {list.length === 0 ? (
        <div className="card"><Empty icon="tag" title="Aucune page pour l’instant">
          <p className="small muted">Exemple : page « Lampe rechargeable » avec les variantes Modèle, Type et Puissance.</p>
          {editable && <Button icon="plus" onClick={() => setEdit('new')}>Créer la première page</Button>}
        </Empty></div>
      ) : (
        <div className="cat-grid">
          {list.map((c) => {
            const attrs = activeAttrs(c);
            const n = count(c.id);
            return (
              <div key={c.id} className="card stack-s cat-card">
                <div className="row-between" style={{ alignItems: 'flex-start' }}>
                  <div className="row" style={{ minWidth: 0, gap: 10, flexWrap: 'nowrap', alignItems: 'center' }}>
                    {!c.parentId && <span className="page-logo" title={c.logo ? 'Logo de la page' : 'Pas encore de logo'}>{c.logo ? <img src={c.logo} alt="" /> : <Icon name="store" size={18} />}</span>}
                    <div style={{ minWidth: 0 }}>
                    <h3 style={{ margin: 0 }}>{categoryPath(c.id)}</h3>
                    <p className="small muted">Code {c.code || '—'} · {n} article(s){!c.parentId && c.ticketName ? ` · ticket : ${c.ticketName}` : ''}</p>
                    </div>
                  </div>
                  {editable && <IconButton icon="edit" label="Modifier la page et ses variantes" onClick={() => setEdit(c)} />}
                </div>
                {attrs.length === 0 ? <p className="small muted">Aucune variante définie.</p> : (
                  <ul className="attr-sum">
                    {attrs.map((a) => <li key={a.id}><strong>{a.name}</strong>{a.required === false && <span className="muted small"> (facultatif)</span>} : <span className="small">{activeValues(a).map((v) => v.code).join(' · ') || <em className="muted">aucune valeur</em>}</span></li>)}
                  </ul>
                )}
                <div className="row cat-actions">
                  {editable && <Button icon="plus" disabled={!attrs.length} onClick={() => setBuild(c)}>Créer des articles</Button>}
                  <Button variant="ghost" onClick={() => navigate(`/articles?cat=${c.id}`)}>Voir les articles</Button>
                  {editable && <Button variant="ghost" icon="download" disabled={!attrs.length} onClick={async () => downloadBlob(await categoryTemplate(c), fileName(c))}>Excel à remplir</Button>}
                  {editable && !c.parentId && <IconButton icon="trash" label={`Supprimer la page ${c.name}`} onClick={() => setDel(c)} />}
                  {editable && c.parentId && n === 0 && !cats.some((x) => x.parentId === c.id) && <IconButton icon="trash" label="Supprimer la catégorie" onClick={() => setDel(c)} />}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {edit && <CategoryEditor cat={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
      {build && <ArticleBuilder cat={build} onClose={() => setBuild(null)} />}
      {del && !del.parentId && <DeletePage c={del} onClose={() => setDel(null)} />}
      {del && del.parentId && <Confirm title="Supprimer la catégorie" danger confirmLabel="Supprimer" message={<p>La catégorie « {del.name} » sera supprimée (elle n’a aucun article).</p>}
        onClose={() => setDel(null)} onConfirm={async () => { await remove('categories', del.id); await audit('Catégorie supprimée', del.name); }} />}
      {removedPages.length > 0 && (
        <details className="card removed-pages">
          <summary><strong>Pages supprimées ({removedPages.length})</strong> <span className="small muted">— rien n’est perdu : restaurez-les quand vous voulez</span></summary>
          <ul className="list">{removedPages.map((c) => (
            <li key={c.id} className="list-item">
              <span className="page-logo">{c.logo ? <img src={c.logo} alt="" /> : <Icon name="store" size={18} />}</span>
              <div className="list-item-main"><span className="list-item-title">{c.name}</span>
                <p className="small muted">Supprimée{c.removedAt ? ` le ${new Date(c.removedAt).toLocaleDateString('fr-FR')}` : ''}{c.removedBy ? ` par ${c.removedBy}` : ''} · {products.filter((p) => p.removedWithPage === c.id).length} article(s) rangé(s) avec elle</p></div>
              {editable && <Button variant="ghost" icon="refresh" onClick={async () => { await restorePage(c.id); toast(`Page « ${c.name} » restaurée`); }}>Restaurer</Button>}
            </li>
          ))}</ul>
        </details>
      )}
    </>
  );
}

/** Supprimer une page : elle et ses articles sont rangés de côté, l'historique reste ; restaurable. */
function DeletePage({ c, onClose }: { c: Category; onClose: () => void }) {
  const info = pageRemovalInfo(c.id);
  if (info.pending.length) return (
    <Modal title={`Supprimer la page « ${c.name} » ?`} onClose={onClose} footer={<Button onClick={onClose}>Compris</Button>}>
      <div className="notice notice-danger"><Icon name="alert" /><div className="stack-s"><strong>Impossible pour le moment</strong>
        <span className="small">{info.pending.length} commande(s) pas encore terminée(s) contiennent des articles de cette page : {info.pending.slice(0, 10).join(', ')}{info.pending.length > 10 ? '…' : ''}. Terminez-les (livrées, refusées) ou annulez-les d’abord.</span></div></div>
    </Modal>
  );
  return (
    <Confirm title={`Supprimer la page « ${c.name} » ?`} confirmLabel="Supprimer la page" typeToConfirm="SUPPRIMER" onClose={onClose}
      message={<div className="stack-s">
        <p>La page et ses <strong>{info.articles} article(s)</strong> ne seront plus proposés à la vente ni dans les listes.</p>
        <p className="small"><strong>Rien n’est effacé :</strong> les ventes, le chiffre d’affaires, les boosts, les récapitulatifs et le journal gardent son nom et ses chiffres. Vous pouvez la restaurer à tout moment (en bas de cet écran, « Pages supprimées »).</p>
        {info.stockPcs > 0 && <div className="notice"><Icon name="alert" /><span>Il reste <strong>{info.stockPcs} pièce(s)</strong> en stock (valeur {fmtAr(info.stockValue)}). Elles restent comptées dans la valeur du stock, mais ne seront plus en vente.</span></div>}
      </div>}
      onConfirm={async () => { await removePage(c.id); toast(`Page « ${c.name} » supprimée (restaurable)`); }} />
  );
}

// ---------- Éditeur d'une page et de ses variantes ----------
function CategoryEditor({ cat, onClose }: { cat?: Category; onClose: () => void }) {
  const cats = useTable<Category>('categories');
  const [name, setName] = useState(cat?.name ?? '');
  const [code, setCode] = useState(cat?.code ?? '');
  const [parentId, setParentId] = useState(cat?.parentId ?? '');
  const [attrs, setAttrs] = useState<CatAttr[]>(() => JSON.parse(JSON.stringify(cat?.attrs ?? [])));
  const [preset, setPreset] = useState('');
  const [logo, setLogo] = useState<string | undefined>(cat?.logo);
  const [ticketName, setTicketName] = useState(cat?.ticketName ?? '');
  const [slogan, setSlogan] = useState(cat?.slogan ?? '');
  const [phone, setPhone] = useState(cat?.phone ?? '');
  const [footer, setFooter] = useState(cat?.ticketFooter ?? '');
  const logoRef = useRef<HTMLInputElement>(null);
  const products = useTable<Product>('products').filter((p) => cat && p.categoryId === cat.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoCode = suggestCatCode(name);
  const setAttr = (id: string, patch: Partial<CatAttr>) => setAttrs(attrs.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  const move = (i: number, d: number) => { const n = [...attrs]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; setAttrs(n); };
  const used = (a: CatAttr, v?: AttrValue) => (cat ? usageOf(cat.id, a.id, v?.id) : 0);
  const applyPreset = (k: string) => { setPreset(k); const p = ATTR_PRESETS.find((x) => x.key === k)!; setAttrs(p.attrs.map((a) => makeAttr(a.name, a.values))); };

  async function submit() {
    setError(null);
    if (!name.trim()) return setError('Indiquez le nom de la page.');
    const c = (code.trim() || autoCode).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (cats.some((x) => x.id !== cat?.id && (x.code || '').toUpperCase() === c)) return setError(`Le code ${c} est déjà utilisé par une autre page.`);
    const names = attrs.map((a) => a.name.trim().toLowerCase());
    if (attrs.some((a) => !a.name.trim())) return setError('Chaque variante doit avoir un nom.');
    if (new Set(names).size !== names.length) return setError('Deux variantes ont le même nom.');
    for (const a of attrs) {
      const codes = a.values.map((v) => v.code.trim().toUpperCase());
      if (a.values.some((v) => !v.label.trim() || !v.code.trim())) return setError(`${a.name} : chaque valeur doit avoir un libellé et un code court.`);
      if (new Set(codes).size !== codes.length) return setError(`${a.name} : deux valeurs ont le même code court.`);
    }
    setBusy(true);
    const brand = parentId ? { logo: undefined, ticketName: undefined, slogan: undefined, phone: undefined, ticketFooter: undefined }
      : { logo, ticketName: ticketName.trim() || undefined, slogan: slogan.trim() || undefined, phone: phone.trim() || undefined, ticketFooter: footer.trim() || undefined };
    const data = { name: name.trim(), code: c, parentId: parentId || undefined, ...brand, attrs: attrs.map((a) => ({ ...a, name: a.name.trim(), values: a.values.map((v) => ({ ...v, label: v.label.trim(), code: v.code.trim().toUpperCase() })) })) };
    try {
      if (cat) { await save('categories', { id: cat.id, ...data }); await audit('Page modifiée', `${data.name} : ${data.attrs.map((a) => `${a.name} (${a.values.length})`).join(', ')}`, 'categories', cat.id); toast('Page enregistrée'); onClose(); }
      else { const [n] = await save('categories', data); await audit('Page créée', data.name, 'categories', n.id); toast('Page créée — vous pouvez maintenant créer ses articles'); onClose(); }
    } catch (e: any) { setError(e.message); setBusy(false); }
  }

  return (
    <Modal wide title={cat ? `Page « ${cat.name} »` : 'Nouvelle page'} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button busy={busy} onClick={submit}>{cat ? 'Enregistrer' : 'Créer la page'}</Button></>}>
      <div className="stack">
        <div className="grid-2">
          <TextField label="Nom de la page (catégorie)" required value={name} onChange={setName} placeholder="Ex. Lampe rechargeable" />
          <TextField label="Code court de la page" value={code} onChange={(v) => setCode(v.toUpperCase())} placeholder={autoCode} hint={`Début du code des articles (ex. ${code || autoCode}-LP1-B22-7W).`} />
        </div>
        {cat && products.length > 0 && <div className="notice"><Icon name="alert" /><span>Cette page a déjà <strong>{products.length} article(s)</strong>. Changer un <strong>libellé</strong> change ce qui s’affiche pour ces articles ; changer un <strong>code court</strong> ne renomme pas les articles déjà créés. Une variante ou une valeur utilisée ne peut pas être supprimée : elle se désactive.</span></div>}
        {(parentId || cats.some((x) => x.parentId)) && (
          <SelectField label="Rangée dans (facultatif)" value={parentId} onChange={setParentId} options={[{ value: '', label: 'Aucune — c’est une page' }, ...cats.filter((x) => x.id !== cat?.id && !x.parentId).map((x) => ({ value: x.id, label: x.name }))]} />
        )}
        {!parentId && (
          <div className="card stack-s page-brand" style={{ background: 'var(--surface-2)' }}>
            <strong>Logo et ticket de la page</strong>
            <Help>Les tickets de caisse, bons de livraison et étiquettes des ventes de cette page portent son nom, son logo, son téléphone et son message, à la place de ceux de la société. Une commande avec des articles de plusieurs pages prend la page qui pèse le plus dans la commande. Laissez vide pour reprendre ceux de la société.</Help>
            <div className="row" style={{ alignItems: 'center', gap: 12 }}>
              <div className="logo-preview">{logo ? <img src={logo} alt="Logo de la page" /> : <Icon name="store" size={28} />}</div>
              <Button variant="ghost" icon="upload" onClick={() => logoRef.current?.click()}>{logo ? 'Changer le logo' : 'Ajouter le logo de la page'}</Button>
              {logo && <Button variant="quiet" onClick={() => setLogo(undefined)}>Retirer</Button>}
              <input ref={logoRef} type="file" accept="image/*" hidden aria-label="Logo de la page" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { try { setLogo(await resizeImage(f)); } catch (err: any) { toast(err.message, 'error'); } } e.target.value = ''; }} />
            </div>
            <div className="grid-2">
              <TextField label="Nom sur le ticket" value={ticketName} onChange={setTicketName} placeholder={name || 'Nom de la page'} hint="Vide = nom de la page." />
              <TextField label="Téléphone de la page" value={phone} onChange={setPhone} type="tel" inputMode="tel" placeholder="Vide = téléphone de la société" />
            </div>
            <div className="grid-2">
              <TextField label="Slogan (facultatif)" value={slogan} onChange={setSlogan} />
              <TextField label="Message en bas du ticket" value={footer} onChange={setFooter} placeholder="Vide = message de la société" />
            </div>
          </div>
        )}
        {!cat && (
          <div className="stack-s">
            <strong className="small">Partir d’un modèle de variantes (tout reste modifiable) :</strong>
            <div className="row" style={{ gap: 6 }}>{ATTR_PRESETS.map((p) => <button key={p.key} type="button" className="chip" aria-pressed={preset === p.key} onClick={() => applyPreset(p.key)}>{p.label}</button>)}</div>
          </div>
        )}

        <div className="stack-s">
          <div className="row-between"><h3 style={{ margin: 0 }}>Variantes de la page ({attrs.filter((a) => a.active !== false).length})</h3></div>
          <Help>Autant de variantes que nécessaire, dans l’ordre du nom de l’article. Chaque valeur a un libellé complet et un code court qui forme le nom (LP1 B22 7W).</Help>
          {attrs.map((a, i) => <AttrCard key={a.id} a={a} index={i} total={attrs.length} usedAttr={used(a)} usedValue={(v) => used(a, v)}
            onChange={(p) => setAttr(a.id, p)} onMove={(d) => move(i, d)} onRemove={() => setAttrs(attrs.filter((x) => x.id !== a.id))} />)}
          <div className="row" style={{ gap: 6, alignItems: 'center' }}>
            <span className="small muted">Ajouter :</span>
            {ATTR_SUGGESTIONS.filter((s) => !attrs.some((a) => a.name.toLowerCase() === s.toLowerCase())).map((s) => <button key={s} type="button" className="chip" onClick={() => setAttrs([...attrs, makeAttr(s)])}>+ {s}</button>)}
            <button type="button" className="chip" onClick={() => setAttrs([...attrs, makeAttr('')])}>+ Autre…</button>
          </div>
        </div>
        {error && <div className="notice notice-danger"><Icon name="alert" /><span>{error}</span></div>}
      </div>
    </Modal>
  );
}

function AttrCard({ a, index, total, usedAttr, usedValue, onChange, onMove, onRemove }: {
  a: CatAttr; index: number; total: number; usedAttr: number; usedValue: (v: AttrValue) => number;
  onChange: (p: Partial<CatAttr>) => void; onMove: (d: number) => void; onRemove: () => void;
}) {
  const [label, setLabel] = useState('');
  const [bulk, setBulk] = useState(false);
  const off = a.active === false;
  const setVal = (id: string, p: Partial<AttrValue>) => onChange({ values: a.values.map((v) => (v.id === id ? { ...v, ...p } : v)) });
  const moveVal = (i: number, d: number) => { const n = [...a.values]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; onChange({ values: n }); };
  const add = (labels: string[]) => {
    const vals = [...a.values];
    for (const l of labels.map((x) => x.trim()).filter(Boolean)) {
      if (vals.some((v) => v.label.toLowerCase() === l.toLowerCase())) continue;
      vals.push({ id: shortId(), label: l, code: suggestCode(l, vals.map((v) => v.code)) });
    }
    onChange({ values: vals }); setLabel('');
  };
  return (
    <div className={`attr-card ${off ? 'is-off' : ''}`}>
      <div className="row attr-head">
        <span className="slot-badge">{index + 1}</span>
        <input className="cell-input attr-name" aria-label="Nom de la variante" placeholder="Nom de la variante (ex. Modèle)" value={a.name} onChange={(e) => onChange({ name: e.target.value })} />
        <label className="row small" style={{ gap: 4 }}><input type="checkbox" checked={a.required !== false} onChange={(e) => onChange({ required: e.target.checked })} /> obligatoire</label>
        <IconButton icon="chevronUp" label="Monter" disabled={index === 0} onClick={() => onMove(-1)} />
        <IconButton icon="chevronDown" label="Descendre" disabled={index === total - 1} onClick={() => onMove(1)} />
        {usedAttr ? <Button variant="quiet" onClick={() => onChange({ active: off })}>{off ? 'Réactiver' : 'Désactiver'}</Button>
          : <IconButton icon="trash" label="Supprimer la variante" onClick={onRemove} />}
      </div>
      {!off && <>
        {a.values.length > 0 && (
          <div className="attr-values">
            <div className="attr-val attr-val-head small muted"><span>Libellé complet</span><span>Code court</span><span /></div>
            {a.values.map((v, i) => {
              const u = usedValue(v);
              return (
                <div key={v.id} className="attr-val" style={{ opacity: v.active === false ? .5 : 1 }}>
                  <input className="cell-input" aria-label="Libellé" value={v.label} onChange={(e) => setVal(v.id, { label: e.target.value })} />
                  <input className="cell-input code-input" aria-label="Code court" value={v.code} onChange={(e) => setVal(v.id, { code: e.target.value.toUpperCase().replace(/\s/g, '') })} />
                  <span className="attr-val-actions">
                    {u ? <span className="small muted" title="Articles qui utilisent cette valeur">{u} art.</span> : null}
                    <IconButton icon="chevronUp" label="Monter" disabled={i === 0} onClick={() => moveVal(i, -1)} />
                    {u ? <Button variant="quiet" onClick={() => setVal(v.id, { active: v.active === false })}>{v.active === false ? 'Réactiver' : 'Désactiver'}</Button>
                      : <IconButton icon="x" label="Retirer la valeur" onClick={() => onChange({ values: a.values.filter((x) => x.id !== v.id) })} />}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {bulk ? (
          <div className="stack-s">
            <textarea className="cell-input" rows={4} placeholder={'Une valeur par ligne, ex.\nLP1 (simple batterie)\nLP2 (double batterie)'} value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Plusieurs valeurs" />
            <div className="row"><Button variant="ghost" disabled={!label.trim()} onClick={() => { add(label.split(/\n|;/)); setBulk(false); }}>Ajouter ces valeurs</Button><Button variant="quiet" onClick={() => setBulk(false)}>Annuler</Button></div>
          </div>
        ) : (
          <form className="row" onSubmit={(e) => { e.preventDefault(); add([label]); }}>
            <input className="cell-input" style={{ flex: '1 1 200px' }} aria-label={`Nouvelle valeur pour ${a.name || 'la variante'}`} placeholder="Nouvelle valeur (ex. LP1 (simple batterie), 7 W, Bleu marine)" value={label} onChange={(e) => setLabel(e.target.value)} />
            {label.trim() && <span className="small muted">code : <strong>{suggestCode(label, a.values.map((v) => v.code))}</strong></span>}
            <Button type="submit" variant="ghost" icon="plus" disabled={!label.trim()}>Ajouter</Button>
            <Button type="button" variant="quiet" onClick={() => setBulk(true)}>Plusieurs d’un coup</Button>
          </form>
        )}
      </>}
      {off && <p className="small muted">Variante désactivée : elle n’est plus proposée pour les nouveaux articles ({usedAttr} article(s) la gardent).</p>}
    </div>
  );
}

// ---------- Création des articles d'une page ----------
interface Line { key: string; sel: Selection; on: boolean; exists: boolean; name: string; cost: string; retail: string; wholesale: string; stock: string }

export function ArticleBuilder({ cat: initial, onClose }: { cat?: Category; onClose: () => void }) {
  const cats = useTable<Category>('categories');
  useTable('products');
  const [catId, setCatId] = useState(initial?.id ?? '');
  const cat = cats.find((c) => c.id === catId);
  const attrs = activeAttrs(cat);
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [edits, setEdits] = useState<Record<string, Partial<Line>>>({});
  const [all4, setAll4] = useState({ cost: '', retail: '', wholesale: '', stock: '' });
  const [photo, setPhoto] = useState<string>();
  const photoRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const toggle = (aid: string, vid: string) => { const cur = picked[aid] ?? []; setPicked({ ...picked, [aid]: cur.includes(vid) ? cur.filter((x) => x !== vid) : [...cur, vid] }); };
  const lines: Line[] = useMemo(() => {
    if (!cat) return [];
    return combinations(cat, picked).map((sel) => {
      const key = articleId(cat.id, sel);
      const ex = findArticle(cat.id, sel);
      const base: Line = { key, sel, on: !ex, exists: !!ex, name: ex?.name ?? articleParts(cat, sel).name, cost: '', retail: '', wholesale: '', stock: '' };
      return { ...base, ...edits[key] };
    });
  }, [cat, picked, edits]);
  const setLine = (key: string, p: Partial<Line>) => setEdits({ ...edits, [key]: { ...edits[key], ...p } });
  const applyAll = () => {
    const n = { ...edits };
    for (const l of lines) if (!l.exists) n[l.key] = { ...n[l.key], ...Object.fromEntries(Object.entries(all4).filter(([, v]) => v !== '')) };
    setEdits(n);
  };
  const chosen = lines.filter((l) => l.on && !l.exists);
  const missing = chosen.filter((l) => !parseNum(l.retail));
  const missingAttr = attrs.filter((a) => a.required !== false && !(picked[a.id] ?? []).length);

  return (
    <Modal wide title={cat ? `Créer des articles — ${cat.name}` : 'Créer des articles'} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button busy={busy} disabled={!chosen.length || missing.length > 0} onClick={async () => {
        setBusy(true);
        try {
          const r = await saveArticles(cat!, chosen.map((l) => ({ sel: l.sel, name: l.name.trim() || undefined, cost: parseNum(l.cost), retail: parseNum(l.retail), wholesale: parseNum(l.wholesale) ?? parseNum(l.retail), stock: parseNum(l.stock), photo })), 'Création');
          toast(`${r.created} article(s) créé(s)`); onClose();
        } catch (e: any) { toast(e.message, 'error'); setBusy(false); }
      }}>Créer {chosen.length || ''} article(s)</Button></>}>
      <div className="stack">
        {!initial && <SelectField label="Page (catégorie)" required value={catId} onChange={(v) => { setCatId(v); setPicked({}); setEdits({}); }} options={[{ value: '', label: 'Choisir la page…' }, ...cats.map((c) => ({ value: c.id, label: categoryPath(c.id) + (activeAttrs(c).length ? '' : ' (sans variantes)') }))]} />}
        {cat && !attrs.length && <div className="notice"><Icon name="alert" /><span>Cette page n’a pas encore de variantes. Définissez-les d’abord dans <a href="#/pages">Pages et variantes</a>.</span></div>}
        {cat && attrs.length > 0 && <>
          <Help>1. Cochez une ou plusieurs valeurs par variante : un article est proposé pour chaque combinaison. 2. Décochez celles qui n’existent pas, saisissez les prix et le stock.</Help>
          {attrs.map((a) => (
            <div key={a.id} className="stack-s">
              <strong className="small">{a.name}{a.required === false ? ' (facultatif)' : <Req />}</strong>
              <div className="row" style={{ gap: 6 }}>
                {activeValues(a).map((v) => <button key={v.id} type="button" className="chip" aria-pressed={(picked[a.id] ?? []).includes(v.id)} title={v.label} onClick={() => toggle(a.id, v.id)}>{normText(v.label).replace(/\s/g, '').startsWith(normText(v.code)) ? v.label : <>{v.code}<span className="chip-sub"> · {v.label}</span></>}</button>)}
                {activeValues(a).length > 1 && <button type="button" className="chip chip-quiet" onClick={() => setPicked({ ...picked, [a.id]: (picked[a.id] ?? []).length === activeValues(a).length ? [] : activeValues(a).map((v) => v.id) })}>{(picked[a.id] ?? []).length === activeValues(a).length ? 'Aucune' : 'Toutes'}</button>}
                {!activeValues(a).length && <span className="small muted">Aucune valeur : ajoutez-en dans la page.</span>}
              </div>
            </div>
          ))}
          {missingAttr.length > 0 && <p className="small muted">À choisir : {missingAttr.map((a) => a.name).join(', ')}.</p>}
          {lines.length > 0 && <>
            <div className="card-sub stack-s">
              <strong className="small">Remplir toutes les lignes nouvelles :</strong>
              <div className="row builder-all">
                <input className="cell-input" inputMode="numeric" placeholder="Prix de revient" aria-label="Prix de revient pour toutes" value={all4.cost} onChange={(e) => setAll4({ ...all4, cost: e.target.value })} />
                <input className="cell-input" inputMode="numeric" placeholder="PV détail" aria-label="PV détail pour toutes" value={all4.retail} onChange={(e) => setAll4({ ...all4, retail: e.target.value })} />
                <input className="cell-input" inputMode="numeric" placeholder="PV gros" aria-label="PV gros pour toutes" value={all4.wholesale} onChange={(e) => setAll4({ ...all4, wholesale: e.target.value })} />
                <input className="cell-input" inputMode="numeric" placeholder="Stock" aria-label="Stock pour toutes" value={all4.stock} onChange={(e) => setAll4({ ...all4, stock: e.target.value })} />
                <Button variant="ghost" onClick={applyAll}>Appliquer</Button>
              </div>
              <div className="row" style={{ alignItems: 'center', gap: 8 }}>
                <Button variant="ghost" icon="upload" onClick={() => photoRef.current?.click()}>{photo ? 'Changer la photo' : 'Photo des articles créés'}</Button>
                {photo && <><img src={photo} alt="Photo" style={{ height: 48, borderRadius: 8 }} /><span className="small muted">{Math.max(1, Math.round(photoBytes(photo) / 1024))} Ko</span><Button variant="quiet" onClick={() => setPhoto(undefined)}>Retirer</Button></>}
                <span className="small muted">Facultatif : la même photo pour tous les articles créés ici. Chaque article peut ensuite avoir sa propre photo (fiche → Modifier).</span>
                <input ref={photoRef} type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) { try { setPhoto(await compressPhoto(f)); } catch (err: any) { toast(err?.message ?? 'Photo illisible', 'error'); } } e.target.value = ''; }} />
              </div>
            </div>
            <div className="table-wrap"><table className="table builder-table">
              <thead><tr><th></th><th>Article</th><th className="t-num">Prix de revient</th><th className="t-num">PV détail</th><th className="t-num">PV gros</th><th className="t-num">Stock</th></tr></thead>
              <tbody>{lines.map((l) => {
                const parts = articleParts(cat, l.sel);
                return (
                  <tr key={l.key} style={{ opacity: l.on || l.exists ? 1 : .5 }}>
                    <td><input type="checkbox" aria-label={`Créer ${parts.name}`} checked={l.on} disabled={l.exists} onChange={(e) => setLine(l.key, { on: e.target.checked })} /></td>
                    <td><input className="cell-input" aria-label="Nom de l’article" value={l.name} disabled={l.exists} onChange={(e) => setLine(l.key, { name: e.target.value })} />
                      <div className="small muted">{parts.code}{l.exists ? ' · existe déjà' : ''}<br />{parts.label}</div></td>
                    {(['cost', 'retail', 'wholesale', 'stock'] as const).map((k) => <td key={k}><input className="cell-input num-input" inputMode="numeric" aria-label={`${k} ${parts.name}`} disabled={l.exists || !l.on} value={l[k]} placeholder={k === 'wholesale' ? '= détail' : k === 'stock' ? '0' : ''} onChange={(e) => setLine(l.key, { [k]: e.target.value })} /></td>)}
                  </tr>
                );
              })}</tbody>
            </table></div>
            <p className="small muted">{lines.length} combinaison(s) · {chosen.length} à créer{lines.some((l) => l.exists) ? ` · ${lines.filter((l) => l.exists).length} existe(nt) déjà` : ''}{missing.length ? ` · PV détail manquant sur ${missing.length} ligne(s)` : ''}</p>
          </>}
        </>}
      </div>
    </Modal>
  );
}

/** Résumé des valeurs d'un article (pour la fiche article). */
export function AttrBadges({ p }: { p: Product }) {
  let c = p.categoryId ? get<Category>('categories', p.categoryId) : undefined;
  while (c && !c.attrs?.length && c.parentId) c = get<Category>('categories', c.parentId);
  if (!c?.attrs || !p.attrs) return null;
  return (
    <div className="row" style={{ gap: 6 }}>
      {c.attrs.map((a) => { const v = a.values.find((x) => x.id === p.attrs![a.id]); return v ? <span key={a.id} className="attr-pill"><span className="muted">{a.name}</span> {v.label}</span> : null; })}
    </div>
  );
}
