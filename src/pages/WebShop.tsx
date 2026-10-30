// « Boutique en ligne » : modifier le site des clients depuis Tsena (comme l'administration Shopify).
// Les articles, prix, photos et stock se modifient comme d'habitude dans Articles / Stock : ici, la vitrine.
import { useRef, useState } from 'react';
import { useTable } from '../lib/db';
import { useCan } from '../lib/auth';
import type { Category } from '../lib/catalog';
import { useCompany } from '../lib/settings';
import { SHOP_URL, resizeHero, saveWebShopGlobal, saveWebShopPage, shopUrlOf, useWebShop, type CardMode, type WebShopGlobal, type WebShopPage } from '../lib/webshop';
import { Badge, Button, Choice, Field, Help, Modal, PageHead, TextField, Toggle, toast } from '../ui/kit';
import { Icon } from '../ui/icons';

const COLORS = ['#5B3DB0', '#241F35', '#17695A', '#1D5FA8', '#8A2E6B', '#B5402A', '#9C7E45', '#2F6B2A', '#3C4A57'];

function Area({ label, value, onChange, rows = 3, placeholder, hint }: { label: string; value: string; onChange: (v: string) => void; rows?: number; placeholder?: string; hint?: string }) {
  return <Field label={label} hint={hint}>{(id) => <textarea id={id} rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />}</Field>;
}
async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); toast('Adresse copiée'); } catch { toast(text); }
}

export function WebShopPage() {
  const can = useCan();
  const cats = useTable<Category>('categories');
  const shop = useWebShop();
  const g = shop.global;
  const [editPage, setEditPage] = useState<Category | null>(null);
  const [editGlobal, setEditGlobal] = useState(false);
  const pages = cats.filter((c) => !c.parentId && !c.removed).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const allowed = can('settings.company');
  const mode: CardMode = g.cardMode || 'test';

  return (
    <div className="stack">
      <PageHead title="Boutique en ligne" subtitle="La vitrine de vos pages pour les clients. Les articles, prix, photos et stock viennent d’Articles et Stock."
        actions={<Button variant="ghost" icon="share" onClick={() => window.open(SHOP_URL, '_blank', 'noopener')}>Voir le site</Button>} />

      <div className="card stack-s">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div className="stack-s" style={{ gap: 2 }}>
            <strong>Réglages communs</strong>
            <span className="small muted">Mentions légales, paiement par carte ({mode === 'on' ? 'activé' : mode === 'test' ? 'en essai' : 'désactivé'}), bandeau, conditions de vente, livraison, « À propos ».</span>
          </div>
          {allowed && <Button variant="ghost" icon="edit" onClick={() => setEditGlobal(true)}>Modifier</Button>}
        </div>
      </div>

      <div className="card stack-s">
        <strong>Pages du site</strong>
        <Help>Chaque page de Tsena a sa boutique. Cliquez sur « Modifier » pour changer son titre, sa photo d’accueil, sa couleur, ses liens Facebook, ou pour la masquer du site. Copiez son adresse pour la mettre sur la page Facebook (bouton « Acheter »).</Help>
        <div className="webshop-list">
          {pages.map((c) => {
            const s = shop.page(c.id);
            const hidden = s.published === false;
            return (
              <div key={c.id} className="webshop-row">
                <span className="page-logo">{c.logo ? <img src={c.logo} alt="" /> : <Icon name="store" size={18} />}</span>
                <div className="webshop-name">
                  <strong>{s.title || c.ticketName || c.name}</strong>
                  <span className="small muted">{hidden ? 'Masquée du site' : `?page=${String(c.code || c.id).toLowerCase()}`}{s.hero ? ' · photo d’accueil' : ''}{s.facebook || s.messenger ? ' · Facebook' : ''}{mode !== 'off' && s.card === false ? ' · sans carte' : ''}</span>
                </div>
                {hidden ? <Badge tone="warn">Masquée</Badge> : <Badge tone="ok">En ligne</Badge>}
                <div className="row" style={{ gap: 6 }}>
                  {!hidden && <Button variant="quiet" icon="share" onClick={() => copy(shopUrlOf(c.code, c.id))}>Copier l’adresse</Button>}
                  {!hidden && <Button variant="quiet" icon="eye" onClick={() => window.open(shopUrlOf(c.code, c.id), '_blank', 'noopener')}>Voir</Button>}
                  {allowed && <Button variant="ghost" icon="edit" onClick={() => setEditPage(c)}>Modifier</Button>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {editGlobal && <GlobalForm g={g} onClose={() => setEditGlobal(false)} />}
      {editPage && <PageForm cat={editPage} s={shop.page(editPage.id)} cardMode={mode} onClose={() => setEditPage(null)} />}
    </div>
  );
}

function GlobalForm({ g, onClose }: { g: WebShopGlobal; onClose: () => void }) {
  const company = useCompany();
  const [f, setF] = useState({
    cardMode: (g.cardMode || 'test') as CardMode, cardMin: String(g.cardMin ?? 3000),
    company: g.company || '', email: g.email || '', nif: g.nif || '', stat: g.stat || '',
    returnDays: String(g.returnDays ?? 7), cardEntity: g.cardEntity ?? 'OASIS OF STYLE LLC',
    announce: g.announce || '', termsExtra: g.termsExtra || '', about: g.about || '', deliveryNote: g.deliveryNote || '',
  });
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      await saveWebShopGlobal({ ...f, cardMin: Math.max(3000, Number(f.cardMin.replace(/\D/g, '')) || 3000), returnDays: Math.max(0, Number(f.returnDays) || 7) });
      toast('Réglages du site enregistrés — visibles sur le site après synchronisation'); onClose();
    } catch (e: any) { toast(e.message, 'error'); setBusy(false); }
  }
  return (
    <Modal wide title="Réglages communs du site" onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button busy={busy} onClick={submit}>Enregistrer</Button></>}>
      <div className="stack">
        <div className="card stack-s" style={{ background: 'var(--surface-2)' }}>
          <strong>Paiement par carte (Stripe)</strong>
          <Choice label="Paiement par carte" value={f.cardMode} onChange={(v) => setF({ ...f, cardMode: v as CardMode })}
            options={[{ value: 'off', label: 'Désactivé' }, { value: 'test', label: 'Essai (lien &test=carte)' }, { value: 'on', label: 'Activé pour tous' }]} />
          <Help>« Essai » : seul le lien se terminant par &test=carte affiche la carte. Passez à « Activé pour tous » seulement quand la clé Stripe réelle (rk_live) est installée dans Supabase. Chaque page peut aussi refuser la carte (Modifier la page).</Help>
          <div className="grid-2">
            <TextField label="Montant minimum par carte (Ar)" value={f.cardMin} onChange={set('cardMin')} inputMode="numeric" hint="Stripe refuse les paiements de moins d’environ 0,50 $ : 3 000 Ar au minimum." />
            <TextField label="Société qui encaisse par carte" value={f.cardEntity} onChange={set('cardEntity')} hint="Affichée dans les conditions de vente." />
          </div>
        </div>

        <div className="card stack-s" style={{ background: 'var(--surface-2)' }}>
          <strong>Mentions légales</strong>
          <Help>Affichées dans les conditions de vente, la politique de confidentialité et la page Contact. Vide = informations de la fiche Société (Paramètres).</Help>
          <div className="grid-2">
            <TextField label="Raison sociale" value={f.company} onChange={set('company')} placeholder={company.name} />
            <TextField label="E-mail de contact" value={f.email} onChange={set('email')} type="email" placeholder="contact@…" />
          </div>
          <div className="grid-2">
            <TextField label="NIF" value={f.nif} onChange={set('nif')} placeholder={company.nif || ''} />
            <TextField label="STAT" value={f.stat} onChange={set('stat')} placeholder={company.stat || ''} />
          </div>
          <TextField label="Délai pour signaler un article défectueux (jours)" value={f.returnDays} onChange={set('returnDays')} inputMode="numeric" />
        </div>

        <div className="card stack-s" style={{ background: 'var(--surface-2)' }}>
          <strong>Textes du site</strong>
          <Area label="Bandeau du haut" value={f.announce} onChange={set('announce')} rows={3} placeholder={'Une phrase par ligne, ex.\nLivraison offerte dès 100 000 Ar\nNouveautés chaque semaine'} hint="Vide = bandeau automatique (livraison, paiement à la réception, suivi)." />
          <Area label="Précisions sur la livraison" value={f.deliveryNote} onChange={set('deliveryNote')} rows={3} hint="Ajoutées à la page Livraison et retours (délais, province, coopératives…)." />
          <Area label="Conditions particulières" value={f.termsExtra} onChange={set('termsExtra')} rows={4} hint="Ajoutées à la fin des conditions générales de vente." />
          <Area label="À propos de nous" value={f.about} onChange={set('about')} rows={5} hint="Si rempli, une page « À propos » apparaît sur le site (histoire, engagement, équipe…)." />
        </div>
      </div>
    </Modal>
  );
}

function PageForm({ cat, s, cardMode, onClose }: { cat: Category; s: WebShopPage; cardMode: CardMode; onClose: () => void }) {
  const [f, setF] = useState({
    published: s.published !== false, title: s.title || '', tagline: s.tagline || '', hero: s.hero || '', accent: s.accent || '',
    facebook: s.facebook || '', messenger: s.messenger || '', pixel: s.pixel || '', card: s.card !== false, announce: s.announce || '',
  });
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });
  const heroRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setError(null);
    const fb = f.facebook.trim();
    if (fb && !/^https?:\/\//i.test(fb)) return setError('L’adresse Facebook doit commencer par https:// (ex. https://facebook.com/votrepage).');
    if (f.pixel.trim() && !/^\d{6,20}$/.test(f.pixel.trim())) return setError('L’identifiant du Pixel ne contient que des chiffres.');
    if (f.accent && !/^#[0-9a-fA-F]{6}$/.test(f.accent)) return setError('Couleur invalide.');
    setBusy(true);
    try {
      await saveWebShopPage(cat.id, cat.name, { ...f, messenger: f.messenger.replace(/^https?:\/\/(m\.me|www\.facebook\.com|facebook\.com)\//i, '').replace(/^@/, '').replace(/\/$/, '') });
      toast('Page du site enregistrée — visible sur le site après synchronisation'); onClose();
    } catch (e: any) { setError(e.message); setBusy(false); }
  }
  const url = shopUrlOf(cat.code, cat.id);
  return (
    <Modal wide title={`Site — ${cat.name}`} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button busy={busy} onClick={submit}>Enregistrer</Button></>}>
      <div className="stack">
        {error && <div className="notice notice-danger"><Icon name="alert" /><span>{error}</span></div>}
        <Toggle checked={f.published} onChange={(v) => setF({ ...f, published: v })} label="Page visible sur le site" />
        <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <code className="small" style={{ wordBreak: 'break-all' }}>{url}</code>
          <Button variant="quiet" icon="share" onClick={() => copy(url)}>Copier</Button>
        </div>

        <div className="card stack-s" style={{ background: 'var(--surface-2)' }}>
          <strong>Accueil</strong>
          <div className="grid-2">
            <TextField label="Titre" value={f.title} onChange={set('title')} placeholder={cat.ticketName || cat.name} hint="Vide = nom de la page." />
            <TextField label="Phrase d’accueil" value={f.tagline} onChange={set('tagline')} placeholder={cat.slogan || 'Ex. Talons et escarpins livrés à Tana'} />
          </div>
          <div className="row" style={{ alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div className="logo-preview" style={{ width: 96, height: 128, borderRadius: '48px 48px 6px 6px' }}>{f.hero ? <img src={f.hero} alt="Photo d’accueil" style={{ objectFit: 'cover' }} /> : (cat.logo ? <img src={cat.logo} alt="" /> : <Icon name="store" size={28} />)}</div>
            <div className="stack-s">
              <div className="row" style={{ gap: 6 }}>
                <Button variant="ghost" icon="upload" onClick={() => heroRef.current?.click()}>{f.hero ? 'Changer la photo' : 'Ajouter une photo d’accueil'}</Button>
                {f.hero && <Button variant="quiet" onClick={() => setF({ ...f, hero: '' })}>Retirer</Button>}
              </div>
              <span className="small muted">Une belle photo verticale (portrait). Sans photo : le logo de la page.</span>
            </div>
            <input ref={heroRef} type="file" accept="image/*" hidden aria-label="Photo d’accueil" onChange={async (e) => { const file = e.target.files?.[0]; if (file) { try { const h = await resizeHero(file); setF((x) => ({ ...x, hero: h })); } catch (err: any) { toast(err.message, 'error'); } } e.target.value = ''; }} />
          </div>
          <Field label="Couleur de la page">{() => (
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button type="button" className="chip" aria-pressed={!f.accent} onClick={() => setF({ ...f, accent: '' })}>Par défaut</button>
              {COLORS.map((c) => <button key={c} type="button" aria-label={`Couleur ${c}`} aria-pressed={f.accent.toLowerCase() === c.toLowerCase()} onClick={() => setF({ ...f, accent: c })}
                style={{ width: 32, height: 32, borderRadius: '50%', background: c, border: f.accent.toLowerCase() === c.toLowerCase() ? '3px solid var(--ink)' : '2px solid var(--surface)', boxShadow: '0 0 0 1px var(--line-strong)', cursor: 'pointer' }} />)}
              <input type="color" aria-label="Autre couleur" value={f.accent || '#5B3DB0'} onChange={(e) => setF({ ...f, accent: e.target.value })} style={{ width: 40, height: 32, border: 0, background: 'none' }} />
            </div>
          )}</Field>
          <TextField label="Bandeau du haut (cette page)" value={f.announce} onChange={set('announce')} placeholder="Vide = bandeau commun. Ex. Promo -20 % ce week-end" />
        </div>

        <div className="card stack-s" style={{ background: 'var(--surface-2)' }}>
          <strong>Facebook</strong>
          <div className="grid-2">
            <TextField label="Adresse de la page Facebook" value={f.facebook} onChange={set('facebook')} placeholder="https://facebook.com/votrepage" />
            <TextField label="Nom Messenger" value={f.messenger} onChange={set('messenger')} placeholder="votrepage" hint="Le nom après facebook.com/ : affiche le bouton « Écrire sur Messenger »." />
          </div>
          <TextField label="Pixel Meta (publicités)" value={f.pixel} onChange={set('pixel')} inputMode="numeric" placeholder="Ex. 1234567890123456" hint="Gestionnaire d’événements Meta → votre Pixel → identifiant (chiffres). Mesure les ventes de vos publicités." />
        </div>

        {cardMode !== 'off' && (
          <div className="card stack-s" style={{ background: 'var(--surface-2)' }}>
            <strong>Paiement par carte</strong>
            <Toggle checked={f.card} onChange={(v) => setF({ ...f, card: v })} label="Accepter la carte bancaire sur cette page" />
            <Help>Désactivez-la pour les produits que vous n’avez pas déclarés à Stripe (ex. produits intimes) : ces clients paient à la réception.</Help>
          </div>
        )}
      </div>
    </Modal>
  );
}
