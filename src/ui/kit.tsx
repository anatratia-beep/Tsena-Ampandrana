// Composants d'interface réutilisables : boutons, champs, fenêtres, notifications, navigation.
import { useEffect, useId, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Icon, type IconName } from './icons';

// ---- Navigation (adresse après le #, compatible GitHub Pages et hors ligne) ----
const routeSubs = new Set<() => void>();
// Historique des pages visitées : sert à la flèche « Retour » quand on est passé d'un écran à un autre par un lien
// (et pas par le menu). Un clic dans le menu repart de zéro.
let trail: string[] = [];
let lastRoute = location.hash.slice(1) || '/';
let viaMenu = false;
export const markMenuNav = () => { viaMenu = true; };
const section = (r: string) => '/' + (r.split('?')[0].split('/')[1] || '');
window.addEventListener('hashchange', () => {
  const cur = location.hash.slice(1) || '/';
  if (viaMenu) trail = [];
  else if (trail[trail.length - 1] === cur) trail.pop();                 // retour arrière
  else if (section(cur) !== section(lastRoute)) trail.push(lastRoute);    // changement d'écran par un lien
  viaMenu = false; lastRoute = cur;
  routeSubs.forEach((f) => f());
});
/** Écran précédent (si on est arrivé ici par un lien depuis un autre écran). */
export function useBackTarget(): string | undefined { useRoute(); return trail[trail.length - 1]; }
export function useRoute(): string {
  return useSyncExternalStore((cb) => { routeSubs.add(cb); return () => routeSubs.delete(cb); }, () => location.hash.slice(1) || '/');
}
export function navigate(path: string) { location.hash = path; }

// ---- Notifications ----
interface Toast { id: number; text: string; kind: 'ok' | 'error' | 'info' }
let toasts: Toast[] = [];
const toastSubs = new Set<() => void>();
export function toast(text: string, kind: Toast['kind'] = 'ok') {
  const t = { id: Date.now() + Math.random(), text, kind };
  toasts = [...toasts.slice(-2), t];
  toastSubs.forEach((f) => f());
  setTimeout(() => { toasts = toasts.filter((x) => x !== t); toastSubs.forEach((f) => f()); }, kind === 'error' ? 6000 : 3500);
}
export function Toasts() {
  const list = useSyncExternalStore((cb) => { toastSubs.add(cb); return () => toastSubs.delete(cb); }, () => toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <Icon name={t.kind === 'error' ? 'alert' : 'check'} size={18} />
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}

// ---- Boutons ----
type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' | 'quiet'; icon?: IconName; busy?: boolean; block?: boolean };
export function Button({ variant = 'primary', icon, busy, block, children, className = '', disabled, ...rest }: BtnProps) {
  return (
    <button className={`btn btn-${variant} ${block ? 'btn-block' : ''} ${className}`} disabled={disabled || busy} {...rest}>
      {busy ? <span className="spinner" aria-hidden /> : icon ? <Icon name={icon} size={18} /> : null}
      {children && <span>{children}</span>}
    </button>
  );
}
export function IconButton({ icon, label, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string }) {
  return (
    <button className="icon-btn" aria-label={label} title={label} {...rest}>
      <Icon name={icon} />
    </button>
  );
}

// ---- Champs ----
/** Champ obligatoire : petite étoile rouge après le libellé (règle commune à toute l'application). */
export const Req = () => <span className="req" aria-hidden />; // l’étoile vient du CSS : le libellé reste « propre » (lecteurs d’écran, tests)
export function Field({ label, hint, error, children, required }: { label: string; hint?: ReactNode; error?: string | null; children: (id: string) => ReactNode; required?: boolean }) {
  const id = useId();
  return (
    <div className={`field ${error ? 'has-error' : ''}`}>
      <label htmlFor={id}>{label}{required && <Req />}</label>
      {children(id)}
      {error ? <p className="field-error">{error}</p> : hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  );
}
export function TextField({ label, hint, error, value, onChange, required, ...rest }: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> & { label: string; hint?: ReactNode; error?: string | null; value: string; onChange: (v: string) => void }) {
  return <Field label={label} hint={hint} error={error} required={required}>{(id) => <input id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-required={required || undefined} {...rest} />}</Field>;
}
export function PasswordField({ label, hint, error, value, onChange, autoComplete = 'current-password', autoFocus, required }: { label: string; hint?: ReactNode; error?: string | null; value: string; onChange: (v: string) => void; autoComplete?: string; autoFocus?: boolean; required?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      {(id) => (
        <div className="input-with-btn">
          <input id={id} type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} autoFocus={autoFocus} />
          <button type="button" className="input-btn" onClick={() => setShow(!show)} aria-label={show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}>
            <Icon name={show ? 'eyeOff' : 'eye'} size={18} />
          </button>
        </div>
      )}
    </Field>
  );
}
/** Au-delà de ce nombre d'options, une liste déroulante devient une liste avec recherche. */
export const SEARCH_AT = 12;
const fold = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
/** Liste déroulante avec recherche (longues listes : clients, articles, zones, catégories…). */
export function SearchSelect({ id, value, onChange, options, label }: { id?: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const cur = options.find((o) => o.value === value);
  const words = fold(q).split(/\s+/).filter(Boolean);
  const shown = options.filter((o) => words.every((w) => fold(o.label).includes(w)));
  const pick = (v: string) => { onChange(v); setOpen(false); setQ(''); };
  return (
    <div className="multipick">
      <button id={id} type="button" className="multipick-btn" aria-expanded={open} aria-haspopup="listbox" aria-label={label} onClick={() => setOpen(!open)}>
        <span>{cur?.label ?? '— Choisir —'}</span><Icon name="chevronDown" size={16} />
      </button>
      {open && (
        <div className="multipick-pop" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } }}>
          <input autoFocus className="cell-input" placeholder="Rechercher…" aria-label={`Rechercher${label ? ' — ' + label : ''}`} value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && shown[0]) { e.preventDefault(); pick(shown[0].value); } }} />
          <div className="multipick-list" role="listbox">
            {shown.map((o) => <button key={o.value} type="button" role="option" aria-selected={o.value === value} className={`multipick-item ss-item ${o.value === value ? 'is-on' : ''}`} onClick={() => pick(o.value)}>{o.label}</button>)}
            {!shown.length && <p className="small muted" style={{ padding: 8 }}>Aucun résultat</p>}
          </div>
        </div>
      )}
    </div>
  );
}
/** Filtre en tête de liste : liste déroulante simple, ou avec recherche si elle est longue. */
export function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  if (options.length > SEARCH_AT) return <SearchSelect label={label} value={value} onChange={onChange} options={options} />;
  return <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>;
}
export function SelectField({ label, hint, value, onChange, options, required }: { label: string; hint?: ReactNode; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; required?: boolean }) {
  if (options.length > SEARCH_AT) return <Field label={label} hint={hint} required={required}>{(id) => <SearchSelect id={id} label={label} value={value} onChange={onChange} options={options} />}</Field>;
  return (
    <Field label={label} hint={hint} required={required}>
      {(id) => (
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
    </Field>
  );
}
/**
 * Choix unique : boutons côte à côte quand il y a peu d'options (≤ max), sinon liste déroulante
 * (règle commune à toute l'application : une longue liste ne doit pas prendre toute la place).
 */
export function Choice({ label, value, onChange, options, max = 4, hideLabel }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; max?: number; hideLabel?: boolean }) {
  if (options.length <= max) return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
  const sel = <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>;
  return hideLabel ? <div className="field choice-select">{sel}</div> : <div className="field choice-select"><label>{label}</label>{sel}</div>;
}

/**
 * Choix multiple : pastilles quand il y a peu d'options (≤ max), sinon une liste déroulante à cases à cocher,
 * avec recherche quand la liste est longue.
 */
export function MultiPick({ label, values, onChange, options, max = 6, empty = 'Aucun' }: { label: string; values: string[]; onChange: (v: string[]) => void; options: { value: string; label: string }[]; max?: number; empty?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const toggle = (v: string) => onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v]);
  if (options.length <= max) return (
    <div className="row" style={{ gap: 6 }} role="group" aria-label={label}>
      {options.map((o) => <button key={o.value} type="button" className="chip" aria-pressed={values.includes(o.value)} onClick={() => toggle(o.value)}>{o.label}</button>)}
    </div>
  );
  const chosen = options.filter((o) => values.includes(o.value));
  const n = q.trim().toLowerCase();
  const shown = options.filter((o) => !n || o.label.toLowerCase().includes(n));
  return (
    <div className="multipick">
      <button type="button" className="multipick-btn" aria-expanded={open} aria-label={label} onClick={() => setOpen(!open)}>
        <span>{chosen.length === 0 ? empty : chosen.length <= 2 ? chosen.map((o) => o.label).join(', ') : `${chosen.length} choisis : ${chosen.slice(0, 2).map((o) => o.label).join(', ')}…`}</span>
        <Icon name="chevronDown" size={16} />
      </button>
      {open && (
        <div className="multipick-pop">
          {options.length > 8 && <input autoFocus className="cell-input" placeholder="Rechercher…" aria-label={`Rechercher dans ${label}`} value={q} onChange={(e) => setQ(e.target.value)} />}
          <div className="multipick-list">
            {shown.map((o) => <label key={o.value} className="multipick-item"><input type="checkbox" checked={values.includes(o.value)} onChange={() => toggle(o.value)} /> {o.label}</label>)}
          </div>
          <div className="row-between"><button type="button" className="link-btn" style={{ paddingLeft: 0 }} onClick={() => onChange(values.length ? [] : options.map((o) => o.value))}>{values.length ? 'Tout décocher' : 'Tout cocher'}</button><button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>OK</button></div>
        </div>
      )}
    </div>
  );
}
/** Remise en Ar ou en % : le montant en Ar calculé s'affiche dessous. */
export function DiscountField({ value, unit, onChange, onUnit, amount }: { value: string; unit: 'ar' | 'pct'; onChange: (v: string) => void; onUnit: (u: 'ar' | 'pct') => void; amount: number }) {
  return (
    <Field label="Remise" hint={unit === 'pct' && amount ? `= ${amount.toLocaleString('fr-FR')} Ar` : undefined}>
      {(id) => (
        <div className="input-with-unit">
          <input id={id} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder="0" />
          <select aria-label="Unité de la remise" value={unit} onChange={(e) => onUnit(e.target.value as 'ar' | 'pct')}><option value="ar">Ar</option><option value="pct">%</option></select>
        </div>
      )}
    </Field>
  );
}
/** Texte d'aide : 2 lignes, puis « Voir plus » pour lire la suite (ne prend plus toute la place). */
export function Help({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const long = typeof children === 'string' ? children.length > 110 : true;
  if (!long) return <p className="small muted help">{children}</p>;
  return <div className={`small muted help ${open ? '' : 'is-closed'}`}><span className="help-text">{children}</span> <button type="button" className="link-btn" onClick={() => setOpen(!open)}>{open ? 'Voir moins' : 'Voir plus'}</button></div>;
}
export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className={`toggle ${disabled ? 'is-disabled' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden><span className="toggle-thumb" /></span>
      <span>{label}</span>
    </label>
  );
}

// ---- Fenêtre (modale) ----
export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    document.body.classList.add('no-scroll');
    return () => { window.removeEventListener('keydown', k); document.body.classList.remove('no-scroll'); };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <h2>{title}</h2>
          <IconButton icon="x" label="Fermer" onClick={onClose} />
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

/** Confirmation d'une action risquée ; pour les plus graves, il faut taper un mot. */
export function Confirm({ title, message, confirmLabel, danger, typeToConfirm, onConfirm, onClose }: { title: string; message: ReactNode; confirmLabel: string; danger?: boolean; typeToConfirm?: string; onConfirm: () => Promise<void> | void; onClose: () => void }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = !typeToConfirm || typed.trim().toUpperCase() === typeToConfirm;
  return (
    <Modal title={title} onClose={onClose} footer={
      <>
        <Button variant="ghost" onClick={onClose}>Annuler</Button>
        <Button variant={danger ? 'danger' : 'primary'} busy={busy} disabled={!ok} onClick={async () => {
          setBusy(true);
          try { await onConfirm(); onClose(); } catch (e: any) { toast(e.message, 'error'); } finally { setBusy(false); }
        }}>{confirmLabel}</Button>
      </>
    }>
      <div className="stack">
        {danger && <div className="notice notice-danger"><Icon name="alert" /><span><strong>Action risquée.</strong> Vérifiez bien avant de confirmer : elle peut être difficile ou impossible à défaire. Elle est notée dans le journal d’activité avec votre nom.</span></div>}
        <div>{message}</div>
        {typeToConfirm && <TextField label={`Pour confirmer, tapez ${typeToConfirm}`} value={typed} onChange={setTyped} autoFocus />}
      </div>
    </Modal>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'ok' | 'warn' | 'danger' | 'brand' }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function PageHead({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={28} />
      <p className="empty-title">{title}</p>
      {children}
    </div>
  );
}

export const fmtDateTime = (iso?: string) => iso ? new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
export const fmtDate = (iso?: string) => iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
export function timeAgo(iso?: string) {
  if (!iso) return 'jamais';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  return `le ${fmtDate(iso)}`;
}

/** Résultats approchants cachés (ex. « PH60 », « PH61 » quand on cherche « PH6 ») : bouton pour les afficher aussi. */
export function MoreMatches({ n, onShow }: { n: number; onShow: () => void }) {
  if (!n) return null;
  return <p className="small muted more-matches">Résultats exacts seulement. <button type="button" className="link-btn" onClick={onShow}>Voir aussi {n} résultat(s) approchant(s)</button></p>;
}
