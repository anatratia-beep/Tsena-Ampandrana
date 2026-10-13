// Lots et promotions : création, fiche, choix des couleurs à la vente, prix par quantité, lignes « prix du lot ».
import { useState } from 'react';
import { audit, useCan } from '../lib/auth';
import { get, newId, save } from '../lib/db';
import { categoryPath, fmtAr, matchQuery, parseNum, productText, productVariants, stockOf, useCatalog, variantLabel, photoOf, type Product, searchItems } from '../lib/catalog';
import { availableOf, type OrderLine } from '../lib/orders';
import {
  adjustKept, adjustLabel, isLot, itemChoices, itemVariant, lotAvailable, lotCost, lotLines, lotRegular, lotStatus, productTiers,
  type Adjust, type LotItem, type PriceTier,
} from '../lib/lots';
import { Badge, Button, Help, IconButton, Modal, SelectField, TextField, fmtDate, navigate, toast } from '../ui/kit';
import { Icon } from '../ui/icons';
import { Thumb, categoryOptions } from './Products';

export const LOT_STATUS = { open: { label: 'En vente', tone: 'ok' }, soon: { label: 'Pas encore commencée', tone: 'warn' }, ended: { label: 'Promotion terminée', tone: 'neutral' }, off: { label: 'Archivé', tone: 'neutral' } } as const;
/** Photo d'un lot : la sienne, sinon celle du premier article qu'il contient. */
export const lotPhoto = (p: Product) => p.photo ?? (p.lot?.items[0] ? get<Product>('products', p.lot.items[0].productId)?.photo : undefined);
const itemName = (it: LotItem) => get<Product>('products', it.productId)?.name ?? 'Article supprimé';

// ---------- Choix du type à la création ----------
export function NewArticleChooser({ onClose, onArticle, onLot }: { onClose: () => void; onArticle: () => void; onLot: () => void }) {
  return (
    <Modal title="Nouvel article" onClose={onClose}>
      <div className="stack">
        <button type="button" className="type-choice" onClick={onArticle}>
          <Icon name="store" size={26} />
          <span><strong>Article (avec couleurs, tailles…)</strong><span className="small muted">Un article qui a son propre stock, avec ses variantes.</span></span>
        </button>
        <button type="button" className="type-choice" onClick={onLot}>
          <Icon name="package" size={26} />
          <span><strong>Lot ou promotion</strong><span className="small muted">Plusieurs articles vendus ensemble à un prix (ex. pack de 3, « acheté = cadeau offert »). Pas de stock propre : il utilise le stock des articles.</span></span>
        </button>
      </div>
    </Modal>
  );
}

// ---------- Créer / modifier un lot ----------
export function LotForm({ lot, onClose, onSaved }: { lot?: Product; onClose: () => void; onSaved?: (p: Product) => void }) {
  const { products, categories } = useCatalog();
  const [name, setName] = useState(lot?.name ?? '');
  const [code, setCode] = useState(lot?.code ?? '');
  const [categoryId, setCategoryId] = useState(lot?.categoryId ?? '');
  const [price, setPrice] = useState(lot?.priceRetail?.toString() ?? '');
  const [items, setItems] = useState<LotItem[]>(lot?.lot?.items ?? []);
  const [from, setFrom] = useState(lot?.lot?.from ?? '');
  const [to, setTo] = useState(lot?.lot?.to ?? '');
  const [notes, setNotes] = useState(lot?.notes ?? '');
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const found = q.trim().length >= 1 ? searchItems(products.filter((p) => p.active !== false && !isLot(p)), productText, q, true).list.slice(0, 8) : [];
  const draft = { kind: 'lot', priceRetail: parseNum(price), lot: { items } } as Product;
  const regular = lotRegular(draft);
  const cost = lotCost(draft);
  const lp = parseNum(price) ?? 0;
  const set = (id: string, patch: Partial<LotItem>) => setItems(items.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  async function submit() {
    setError(null);
    if (!name.trim()) return setError('Indiquez le nom du lot (ex. « Pack 3 pyjamas »).');
    if (!items.length) return setError('Ajoutez au moins un article dans le lot.');
    if (items.some((x) => !(x.qty > 0))) return setError('Chaque article du lot doit avoir une quantité.');
    if (!(lp > 0)) return setError('Indiquez le prix du lot.');
    const c = (code.trim() || `LOT-${name.trim().normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 8)}`);
    if (products.some((p) => p.id !== lot?.id && p.code.toUpperCase().replace(/\s/g, '') === c.toUpperCase().replace(/\s/g, ''))) return setError('Ce code est déjà utilisé par un autre article.');
    if (from && to && to < from) return setError('La date de fin est avant la date de début.');
    setBusy(true);
    try {
      const data = { kind: 'lot' as const, code: c, name: name.trim(), categoryId: categoryId || undefined, priceRetail: lp, lot: { items, from: from || undefined, to: to || undefined }, notes: notes.trim() || undefined, active: lot?.active ?? true };
      const [p] = await save('products', lot ? { id: lot.id, ...data } : data);
      await audit(lot ? 'Lot modifié' : 'Lot créé', `${c} — ${data.name} (${fmtAr(lp)})`, 'products', p.id);
      toast(lot ? 'Lot enregistré' : 'Lot créé'); onClose(); onSaved?.(p as Product);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <Modal wide title={lot ? `Modifier le lot — ${lot.name}` : 'Nouveau lot ou promotion'} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button busy={busy} onClick={submit}>{lot ? 'Enregistrer' : 'Créer le lot'}</Button></>}>
      <div className="stack">
        <div className="grid-2">
          <TextField label="Nom du lot" required value={name} onChange={setName} placeholder="Ex. Pack 3 pyjamas, Lampe + porte-clé offert" />
          <TextField label="Code" value={code} onChange={setCode} placeholder="Automatique si vide" autoCapitalize="characters" />
          <SelectField label="Page" value={categoryId} onChange={setCategoryId} options={categoryOptions(categories, 'Sans page')} />
          <TextField label="Prix du lot (Ar)" required value={price} onChange={setPrice} inputMode="numeric" />
        </div>

        <div className="card stack-s" style={{ background: 'var(--surface-2)' }}>
          <h3>Articles dans le lot</h3>
          <Help>Ajoutez chaque article avec sa quantité par lot. Couleur ou taille « au choix à la vente » : on la choisit au moment de vendre (ex. 3 pyjamas : 2 roses + 1 bleu). Cochez « Cadeau » pour un article offert.</Help>
          {items.length > 0 && <ul className="list lot-items">{items.map((it) => {
            const vs = itemChoices(it); const p = get<Product>('products', it.productId);
            return (
              <li key={it.id} className="lot-item">
                <Thumb src={p?.photo} size={44} />
                <div className="lot-item-main">
                  <strong>{itemName(it)}</strong>
                  <div className="row lot-item-opts">
                    {vs.length > 1 && <select aria-label={`Variante ${itemName(it)}`} value={it.variantId ?? ''} onChange={(e) => set(it.id, { variantId: e.target.value || undefined })}>
                      <option value="">Au choix à la vente</option>
                      {vs.map((v) => <option key={v.id} value={v.id}>{variantLabel(v)}</option>)}
                    </select>}
                    <label className="small row" style={{ gap: 4 }}>Qté <input className="cell-input qty-input" inputMode="numeric" aria-label={`Quantité ${itemName(it)}`} value={it.qty || ''} onChange={(e) => set(it.id, { qty: Number(e.target.value.replace(/\D/g, '')) || 0 })} /></label>
                    <label className="small row" style={{ gap: 4 }}><input type="checkbox" checked={!!it.gift} onChange={(e) => set(it.id, { gift: e.target.checked || undefined })} /> Cadeau</label>
                  </div>
                </div>
                <IconButton icon="x" label={`Retirer ${itemName(it)}`} onClick={() => setItems(items.filter((x) => x.id !== it.id))} />
              </li>
            );
          })}</ul>}
          <div className="field"><input aria-label="Ajouter un article au lot" placeholder="+ Ajouter un article : rechercher un code ou un nom…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          {found.length > 0 && <ul className="list card" style={{ padding: 0 }}>{found.map((p) => (
            <li key={p.id}><button type="button" className="list-item list-link btn-reset" onClick={() => { setItems([...items, { id: newId(), productId: p.id, qty: 1 }]); setQ(''); }}>
              <Thumb src={p.photo} size={40} />
              <div className="list-item-main"><span className="list-item-title">{p.name}</span><p className="small muted">{p.code} · {fmtAr(p.priceRetail)} · {productVariants(p.id).length} variante(s)</p></div>
            </button></li>
          ))}</ul>}
        </div>

        {items.length > 0 && (
          <div className="summary-box" style={{ maxWidth: 'none' }}>
            <div><span>Articles achetés séparément</span><strong className="num">{fmtAr(regular)}</strong></div>
            <div><span>Prix du lot</span><strong className="num">{fmtAr(lp)}</strong></div>
            {lp > 0 && <div className="summary-total"><span>{regular >= lp ? 'Le client gagne' : 'Le lot coûte plus cher de'}</span><strong className={`num ${regular >= lp ? 'pos' : 'neg'}`}>{fmtAr(Math.abs(regular - lp))}</strong></div>}
            {cost > 0 && lp > 0 && <div><span>Prix de revient (cadeaux compris) · marge</span><strong className={`num ${lp < cost ? 'neg' : ''}`}>{fmtAr(cost)} · {fmtAr(lp - cost)}</strong></div>}
          </div>
        )}

        <div className="grid-2">
          <TextField label="Début de la promotion (facultatif)" type="date" value={from} onChange={setFrom} />
          <TextField label="Fin de la promotion (facultatif)" type="date" value={to} onChange={setTo} hint="Après cette date, le lot n’est plus proposé à la vente (son historique reste)." />
        </div>
        <TextField label="Notes (facultatif)" value={notes} onChange={setNotes} />
        {error && <div className="notice notice-danger"><Icon name="alert" /><span>{error}</span></div>}
      </div>
    </Modal>
  );
}

// ---------- Fiche d'un lot ----------
export function LotDetail({ p, onEdit }: { p: Product; onEdit: () => void }) {
  const can = useCan();
  const st = lotStatus(p);
  const avail = lotAvailable(p, stockOf);
  const regular = lotRegular(p);
  const cost = lotCost(p);
  return (
    <>
      <div className="card product-head">
        <Thumb src={lotPhoto(p)} size={112} alt={p.name} />
        <div className="stack-s" style={{ flex: 1, minWidth: 220 }}>
          <div className="row" style={{ gap: 8 }}><h1 style={{ fontSize: '1.6rem' }}>{p.name}</h1><Badge tone="brand">Lot</Badge><Badge tone={LOT_STATUS[st].tone}>{LOT_STATUS[st].label}</Badge></div>
          <p className="muted">{p.code} · {categoryPath(p.categoryId)}{p.lot?.from || p.lot?.to ? ` · ${p.lot?.from ? `du ${fmtDate(p.lot.from)}` : ''}${p.lot?.to ? ` au ${fmtDate(p.lot.to)}` : ''}` : ''}</p>
          <div className="kv-row">
            <div><span className="small muted">Prix du lot</span><strong className="num">{fmtAr(p.priceRetail)}</strong></div>
            <div><span className="small muted">Séparément</span><strong className="num">{fmtAr(regular)}</strong></div>
            <div><span className="small muted">Le client gagne</span><strong className="num">{fmtAr(regular - (p.priceRetail ?? 0))}</strong></div>
            <div><span className="small muted">Lots possibles (stock)</span><strong className="num">{avail}</strong></div>
            {can('costs.view') && cost > 0 && <div><span className="small muted">Marge</span><strong className="num">{fmtAr((p.priceRetail ?? 0) - cost)}</strong></div>}
          </div>
          {p.notes && <p className="small">{p.notes}</p>}
        </div>
        <div className="page-actions" style={{ alignSelf: 'flex-start' }}>{can('catalog.edit') && <Button variant="ghost" icon="edit" onClick={onEdit}>Modifier</Button>}</div>
      </div>
      <div className="card card-flush">
        <div className="card-pad"><h2>Contenu du lot</h2></div>
        <ul className="list">{(p.lot?.items ?? []).map((it) => {
          const v = itemVariant(it); const ip = get<Product>('products', it.productId);
          const stock = v ? stockOf(v) : itemChoices(it).reduce((t, x) => t + Math.max(0, stockOf(x.id)), 0);
          return (
            <li key={it.id}><a className="list-item list-link" href={`#/articles/${it.productId}`} onClick={(e) => { e.preventDefault(); navigate('/articles/' + it.productId); }}>
              <Thumb src={ip?.photo} size={48} />
              <div className="list-item-main"><span className="list-item-title">{it.qty} × {itemName(it)} {it.gift && <Badge tone="ok">Cadeau</Badge>}</span>
                <p className="small muted">{v ? variantLabel(get('variants', v)) : 'Couleur / taille au choix à la vente'} · {fmtAr(v ? (get<any>('variants', v)?.priceRetail ?? ip?.priceRetail) : ip?.priceRetail)} pièce</p></div>
              <span className={`stock-pill ${stock < it.qty ? 'is-out' : ''}`}>{stock}</span>
            </a></li>
          );
        })}</ul>
      </div>
      <Help>Vendu en lot : les articles ci-dessus sortent du stock. Si le client rend une partie du lot à la livraison, il paie ce qu’il garde au prix normal de chaque article (le prix du lot ne s’applique qu’au lot complet).</Help>
    </>
  );
}

// ---------- Choisir un lot à la vente (nombre de lots, couleurs au choix) ----------
export function LotPicker({ p, reserved, onBack, onClose, onAdd }: { p: Product; reserved: Map<string, number>; onBack?: () => void; onClose: () => void; onAdd: (lines: OrderLine[]) => void }) {
  const [nStr, setNStr] = useState('1');
  const [picks, setPicks] = useState<Record<string, Record<string, string>>>({});
  const n = Math.max(0, Number(nStr) || 0);
  const avail = (vid: string) => availableOf(vid, reserved);
  const max = lotAvailable(p, avail);
  const items = p.lot?.items ?? [];
  const num = (itId: string) => Object.fromEntries(Object.entries(picks[itId] ?? {}).map(([k, v]) => [k, Number(v) || 0]));
  const sumOf = (itId: string) => Object.values(num(itId)).reduce((t, x) => t + x, 0);
  const missing = items.filter((it) => !itemVariant(it) && sumOf(it.id) !== it.qty * n);
  const regular = lotRegular(p) * n;
  return (
    <Modal wide title={p.name} onClose={onClose}
      footer={<>{onBack && <Button variant="ghost" onClick={onBack}>Autre article</Button>}<Button disabled={!n || missing.length > 0} onClick={() => {
        onAdd(lotLines(p, n, Object.fromEntries(items.map((it) => [it.id, num(it.id)])))); onClose();
      }}>{missing.length ? `Choisissez les couleurs (${missing.length})` : `Ajouter ${n > 1 ? `${n} lots` : 'le lot'} — ${fmtAr((p.priceRetail ?? 0) * n)}`}</Button></>}>
      <div className="stack">
        <div className="row" style={{ gap: 12 }}>
          <Thumb src={lotPhoto(p)} size={88} alt={p.name} />
          <div className="stack-s">
            <div><Badge tone="brand">Lot</Badge> <strong>{fmtAr(p.priceRetail)}</strong> le lot <span className="small muted">(séparément {fmtAr(lotRegular(p))})</span></div>
            <span className={`small ${max <= 0 ? 'neg' : 'muted'}`}>{max > 0 ? `${max} lot(s) possible(s) avec le stock` : 'Stock insuffisant pour ce lot'}</span>
            <label className="small row" style={{ gap: 6 }}>Nombre de lots <input className="cell-input qty-input" inputMode="numeric" aria-label="Nombre de lots" value={nStr} onFocus={(e) => e.target.select()} onChange={(e) => setNStr(e.target.value.replace(/\D/g, ''))} /></label>
          </div>
        </div>
        {items.map((it) => {
          const fixed = itemVariant(it);
          const need = it.qty * n;
          return (
            <div key={it.id} className="card stack-s lot-pick">
              <div className="row-between"><strong>{need} × {itemName(it)} {it.gift && <Badge tone="ok">Cadeau</Badge>}</strong>
                {fixed ? <span className={`small ${avail(fixed) < need ? 'neg' : 'muted'}`}>{variantLabel(get('variants', fixed))} · {Math.max(0, avail(fixed))} dispo</span>
                  : <span className={`small ${sumOf(it.id) === need ? 'ok-text' : 'neg'}`}>Choisi : {sumOf(it.id)} / {need}</span>}</div>
              {!fixed && <div className="variant-grid">{itemChoices(it).map((v) => {
                const a = avail(v.id);
                return (
                  <div key={v.id} className={`variant-cell ${a <= 0 ? 'is-out' : ''}`}>
                    {itemChoices(it).some((x) => x.photo) && <Thumb src={photoOf(v)} size={64} zoom alt={variantLabel(v)} />}
                    <span className="small"><strong>{variantLabel(v)}</strong> · <span className={a <= 0 ? 'neg' : 'muted'}>{a > 0 ? `${a} dispo` : 'épuisé'}</span></span>
                    <input className="cell-input" inputMode="numeric" placeholder="0" aria-label={`${itemName(it)} ${variantLabel(v)}`} value={picks[it.id]?.[v.id] ?? ''}
                      onChange={(e) => setPicks({ ...picks, [it.id]: { ...(picks[it.id] ?? {}), [v.id]: e.target.value.replace(/\D/g, '') } })} />
                  </div>
                );
              })}</div>}
            </div>
          );
        })}
        {n > 1 && <p className="small muted">{n} lots : {fmtAr((p.priceRetail ?? 0) * n)} au lieu de {fmtAr(regular)}.</p>}
      </div>
    </Modal>
  );
}

// ---------- Lignes « prix du lot / prix par quantité » ----------
/** Badges sur une ligne d'article qui fait partie d'un lot. */
export function LotTag({ l }: { l: OrderLine }) {
  if (!l.lotKey) return null;
  return <span className="lot-tag"><Badge tone="brand">Lot : {get<Product>('products', l.lotProductId || '')?.name ?? 'lot'}</Badge>{l.gift && <> <Badge tone="ok">Cadeau</Badge></>}</span>;
}
/** Lignes de différence de prix (affichage) ; `lines` avec quantités gardées → nombre de lots complets gardés. */
export function AdjustList({ adjusts, lines, closed }: { adjusts?: Adjust[]; lines: OrderLine[]; closed?: boolean }) {
  if (!adjusts?.length) return null;
  return (
    <ul className="adjust-list">
      {adjusts.map((a) => {
        const k = closed ? adjustKept(a, lines, adjusts) : a.qty;
        return (
          <li key={a.id}>
            <span><Icon name="tag" size={14} /> {adjustLabel(a)}{closed && k < a.qty ? <span className="small neg"> — {k ? `${k} lot(s) complet(s) gardé(s)` : 'lot incomplet : prix normal'}</span> : null}</span>
            <strong className="num">{k * a.unit < 0 ? '− ' : ''}{fmtAr(Math.abs(k * a.unit))}</strong>
          </li>
        );
      })}
    </ul>
  );
}

// ---------- Prix par quantité (fiche article) ----------
export function TierEditor({ tiers, onChange, unit }: { tiers: PriceTier[]; onChange: (t: PriceTier[]) => void; unit?: number }) {
  return (
    <div className="card stack-s" style={{ background: 'var(--surface-2)' }}>
      <h3>Prix par quantité (facultatif)</h3>
      <Help>Ex. 1 pièce {unit ? fmtAr(unit) : '20 000 Ar'}, mais 3 pièces pour 50 000 Ar. Appliqué tout seul à la vente quand le client prend la quantité (couleurs et tailles mélangées). Si le client rend une partie à la livraison, le reste repasse au prix normal.</Help>
      {tiers.map((t, i) => (
        <div key={i} className="row tier-row">
          <input className="cell-input qty-input" inputMode="numeric" aria-label="Nombre de pièces" value={t.qty || ''} onChange={(e) => onChange(tiers.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value.replace(/\D/g, '')) || 0 } : x)))} />
          <span className="small">pièces pour</span>
          <input className="cell-input" style={{ maxWidth: 130 }} inputMode="numeric" aria-label="Prix du paquet (Ar)" value={t.price || ''} onChange={(e) => onChange(tiers.map((x, j) => (j === i ? { ...x, price: parseNum(e.target.value) || 0 } : x)))} />
          <span className="small">Ar{unit && t.qty > 1 && t.price ? <span className="muted"> (au lieu de {fmtAr(unit * t.qty)})</span> : null}</span>
          <IconButton icon="x" label="Retirer ce prix" onClick={() => onChange(tiers.filter((_, j) => j !== i))} />
        </div>
      ))}
      <div><Button variant="ghost" className="btn-sm" icon="plus" onClick={() => onChange([...tiers, { qty: 3, price: 0 }])}>Ajouter un prix par quantité</Button></div>
    </div>
  );
}
export const tierText = (p?: Product) => productTiers(p).slice().reverse().map((t) => `${t.qty} pour ${fmtAr(t.price)}`).join(' · ');
