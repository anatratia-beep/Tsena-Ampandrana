// Bouton et suivi Alefa dans les livraisons.
import { useEffect, useState } from 'react';
import { useTable } from '../lib/db';
import { Badge, Button, Modal, TextField, toast } from './kit';
import { save } from '../lib/db';
import { audit } from '../lib/auth';
import { useCompany } from '../lib/settings';
import { ALEFA_DEFAULT_URL, ALEFA_TONE, alefaConf, alefaCsv, alefaLink, alefaOf, alefaValue, refreshAlefa, sendToAlefa, useAlefa } from '../lib/alefa';
import { fmtAr } from '../lib/catalog';
import type { Order } from '../lib/orders';

/** Sur une commande : « 🚲 Alefa » si pas encore envoyée, sinon l'étape et le code de réception. */
export function AlefaCell({ order }: { order: Order }) {
  const conf = useAlefa();
  const [busy, setBusy] = useState(false);
  const info = alefaOf(order);
  if (info) {
    return (
      <span className="alefa-cell" title={`Alefa ${info.ref}${info.courier ? ` · ${info.courier}` : ''}`}>
        <Badge tone={ALEFA_TONE[info.step || ''] || 'neutral'}>🚲 {info.label || info.step || info.ref}</Badge>
        {info.pin && <span className="small muted"> code <strong>{info.pin}</strong></span>}
      </span>
    );
  }
  const go = async () => {
    if (!conf.key) { window.open(alefaLink(order, conf.url), '_blank', 'noopener'); return; }
    setBusy(true);
    try { const i = await sendToAlefa(order, conf); toast(`Envoyée à Alefa : ${i.ref} · ${i.label || ''} · code ${i.pin || '—'}`); }
    catch (e) { toast((e as Error).message, 'error'); }
    setBusy(false);
  };
  return <Button variant="ghost" busy={busy} onClick={go} title={`Envoyer à Alefa (${fmtAr(alefaValue(order))} + frais Alefa)`}>🚲 Alefa</Button>;
}

/** Barre d'outils : envoyer plusieurs commandes (API ou fichier CSV) et actualiser le suivi. */
export function AlefaToolbar({ orders }: { orders: Order[] }) {
  const conf = useAlefa();
  const all = useTable<Order>('orders');
  const [busy, setBusy] = useState(false);
  const todo = orders.filter((o) => !alefaOf(o));
  // Suivi automatique toutes les 60 s quand une clé est configurée.
  useEffect(() => {
    if (!conf.key) return;
    const tick = () => refreshAlefa(all, conf).catch(() => {});
    tick();
    const t = setInterval(tick, 60000);
    return () => clearInterval(t);
  }, [conf.key, conf.url, all.filter((o) => alefaOf(o)).length]);
  const sendAll = async () => {
    if (!conf.key) { alefaCsv(todo); toast(`Fichier prêt : importez-le dans Alefa → Entana → ⬆ Excel (${todo.length} commande(s))`); return; }
    setBusy(true);
    let ok = 0;
    for (const o of todo) { try { await sendToAlefa(o, conf); ok++; } catch (e) { toast(`${o.number} : ${(e as Error).message}`, 'error'); } }
    setBusy(false);
    toast(`${ok} commande(s) envoyée(s) à Alefa`);
  };
  if (!todo.length && !conf.key) return null;
  return (
    <span className="row" style={{ gap: 6 }}>
      {todo.length > 0 && <Button variant="ghost" busy={busy} onClick={sendAll}>{conf.key ? `🚲 Envoyer ${todo.length} à Alefa` : `🚲 Fichier Alefa (${todo.length})`}</Button>}
      {conf.key && <Button variant="quiet" onClick={() => refreshAlefa(all, conf).then((n) => toast(n ? `${n} suivi(s) Alefa mis à jour` : 'Suivi Alefa à jour'))}>↻ Suivi Alefa</Button>}
    </span>
  );
}

/** Paramètres : adresse d'Alefa et clé API (facultative). */
export function AlefaSettingsCard() {
  const c = useCompany();
  const cur = alefaConf(c);
  const [url, setUrl] = useState(cur.url);
  const [key, setKey] = useState(cur.key);
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState(false);
  return (
    <div className="card stack-s">
      <div><h3>🚲 Livraison Alefa</h3>
        <p className="muted small">Sans clé : le bouton « 🚲 Alefa » ouvre Alefa avec la commande déjà remplie (le vendeur confirme), et plusieurs commandes donnent un fichier à importer dans Alefa.
          Avec une clé API (fournie par le centre Alefa) : envoi direct, étape de livraison et code de réception affichés ici automatiquement. <button type="button" className="link-btn" onClick={() => setHelp(true)}>Comment ça marche ?</button></p></div>
      <TextField label="Adresse d'Alefa" value={url} onChange={setUrl} placeholder={ALEFA_DEFAULT_URL} />
      <TextField label="Clé API Alefa (facultative)" value={key} onChange={setKey} placeholder="ak_…" autoComplete="off" />
      <div className="row" style={{ gap: 6 }}>
        <Button busy={busy} onClick={async () => {
          setBusy(true);
          try {
            if (key.trim()) { const r = await fetch(`${url.replace(/\/+$/, '')}/api/v1/schedule`, { headers: { 'X-API-Key': key.trim() } }); if (!r.ok) throw new Error('Clé API refusée par Alefa'); }
            await save('settings', { id: 'company', alefaUrl: url.trim(), alefaKey: key.trim() } as any, { force: true });
            await audit('Paramètres', `Liaison Alefa ${key.trim() ? 'avec clé API' : 'sans clé (lien)'} enregistrée`, 'settings', 'company');
            toast(key.trim() ? 'Alefa relié : envoi direct et suivi activés' : 'Alefa relié en mode lien');
          } catch (e) { toast((e as Error).message, 'error'); }
          setBusy(false);
        }}>Enregistrer</Button>
      </div>
      {help && <Modal title="Alefa : livraison à vélo" onClose={() => setHelp(false)}>
        <ol className="small" style={{ paddingLeft: 18, lineHeight: 1.6 }}>
          <li>Dans <b>Livraisons → En attente de livraison</b>, chaque commande a un bouton <b>🚲 Alefa</b>.</li>
          <li>Le client paie au livreur Alefa le montant des articles restant dû + les frais Alefa (3 000 Ar par défaut). Les frais de livraison de la commande ne sont pas ajoutés.</li>
          <li>Le client reçoit un <b>code à 4 chiffres</b> à donner au livreur : c'est la preuve de livraison.</li>
          <li>Le centre Alefa vous reverse la valeur des articles livrés au retour du livreur.</li>
        </ol>
      </Modal>}
    </div>
  );
}
