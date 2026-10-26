// Page publique de garantie : ouverte quand un client scanne le QR code d'une pièce (…?s=NUMÉRO).
// Aucune connexion : elle demande au cloud seulement le produit, la date d'achat et la fin de garantie.
import { useEffect, useState } from 'react';
import { getMeta } from '../lib/db';

interface Info { serial: string; status: string; soldAt?: string; product?: string; warrantyMonths?: number; company?: string; phone?: string }
type State = { kind: 'loading' } | { kind: 'ok'; info: Info } | { kind: 'unknown' } | { kind: 'error'; msg: string };

/** Adresse et clé publique du cloud : fichier garantie.json publié avec le site, sinon le cloud de cet appareil. */
async function cloudConfig(): Promise<{ url: string; key: string } | null> {
  try { const r = await fetch('./garantie.json', { cache: 'no-store' }); if (r.ok) { const j = await r.json(); if (j?.url && j?.key) return { url: String(j.url).replace(/\/+$/, ''), key: j.key }; } } catch { /* pas de fichier */ }
  const c = getMeta<any>('cloud', null);
  return c?.url && c?.anonKey ? { url: c.url, key: c.anonKey } : null;
}

export function WarrantyPage({ serial }: { serial: string }) {
  const [st, setSt] = useState<State>({ kind: 'loading' });
  useEffect(() => {
    (async () => {
      const cfg = await cloudConfig();
      if (!cfg) return setSt({ kind: 'error', msg: 'La vérification de garantie n’est pas encore activée pour cette boutique.' });
      try {
        const r = await fetch(`${cfg.url}/rest/v1/rpc/warranty_lookup`, { method: 'POST', headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_serial: serial }) });
        if (!r.ok) return setSt({ kind: 'error', msg: r.status === 404 ? 'La vérification de garantie n’est pas encore activée pour cette boutique.' : `Vérification impossible pour le moment (${r.status}).` });
        const info = await r.json();
        setSt(info?.serial ? { kind: 'ok', info } : { kind: 'unknown' });
      } catch { setSt({ kind: 'error', msg: 'Pas de connexion internet : réessayez dans un instant.' }); }
    })();
  }, [serial]);

  const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '—');
  let body;
  if (st.kind === 'loading') body = <p className="muted">Vérification…</p>;
  else if (st.kind === 'error') body = <div className="notice"><span>{st.msg}</span></div>;
  else if (st.kind === 'unknown') body = <div className="notice notice-danger"><span>Le numéro <strong>{serial}</strong> est inconnu. Vérifiez l’étiquette ou contactez la boutique.</span></div>;
  else {
    const i = st.info;
    const end = i.soldAt && i.warrantyMonths ? (() => { const d = new Date(i.soldAt!); d.setMonth(d.getMonth() + Number(i.warrantyMonths)); return d; })() : undefined;
    const valid = end ? end >= new Date() : false;
    body = <>
      <div className={`notice ${i.status !== 'sold' ? '' : end ? (valid ? 'notice-ok' : 'notice-danger') : ''}`}><span>
        {i.status !== 'sold' ? 'Ce produit n’a pas encore été vendu.' : end ? (valid ? <><strong>Garantie valable</strong> jusqu’au {day(end.toISOString())}.</> : <><strong>Garantie terminée</strong> depuis le {day(end.toISOString())}.</>) : 'Produit vendu sans garantie.'}
      </span></div>
      <dl className="warranty-list">
        <dt>Produit</dt><dd>{i.product ?? '—'}</dd>
        <dt>Numéro de série</dt><dd className="num">{i.serial}</dd>
        {i.status === 'sold' && <><dt>Date d’achat</dt><dd>{day(i.soldAt)}</dd></>}
        {i.warrantyMonths ? <><dt>Durée de garantie</dt><dd>{i.warrantyMonths} mois</dd></> : null}
      </dl>
    </>;
  }
  const company = st.kind === 'ok' ? st.info.company : undefined;
  const phone = st.kind === 'ok' ? st.info.phone : undefined;
  return (
    <div className="auth-main" style={{ minHeight: '100dvh' }}>
      <div className="auth-card stack">
        <div><p className="small muted" style={{ margin: 0 }}>{company ?? 'Boutique'}</p><h1 style={{ margin: 0 }}>Garantie</h1></div>
        {body}
        {phone && <p className="small">Une question ? Appelez la boutique : <a href={`tel:${phone.replace(/\s/g, '')}`}>{phone}</a></p>}
        <a className="small muted" href={location.pathname}>Personnel de la boutique : ouvrir Trésor en ligne</a>
      </div>
    </div>
  );
}
