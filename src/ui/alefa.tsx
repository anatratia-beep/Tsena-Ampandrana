// Bouton et suivi Alefa dans les livraisons.
import { useEffect, useRef, useState } from 'react';
import { useTable } from '../lib/db';
import { Badge, Button, Modal, SelectField, TextField, toast } from './kit';
import { save } from '../lib/db';
import { audit } from '../lib/auth';
import { useCompany } from '../lib/settings';
import { ALEFA_DEFAULT_URL, ALEFA_TONE, alefaAutoTargets, alefaConf, alefaCsv, alefaLink, alefaOf, alefaTrackUrl, alefaValue, alefaWhere, autoSendAlefa, refreshAlefa, sendToAlefa, useAlefa, type AlefaAuto } from '../lib/alefa';
import { fmtAr } from '../lib/catalog';
import type { Order } from '../lib/orders';

/** Sur une commande : « 🚲 Alefa » si pas encore envoyée, sinon l'étape et le code de réception. */
export function AlefaCell({ order }: { order: Order }) {
  const conf = useAlefa();
  const [busy, setBusy] = useState(false);
  const info = alefaOf(order);
  if (info) {
    return (
      <span className="alefa-cell" title={`Alefa ${info.ref}${info.checkedAt ? ` · vérifié à ${new Date(info.checkedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : ''}`}>
        <Badge tone={ALEFA_TONE[info.step || ''] || 'neutral'}>🚲 {alefaWhere(info)}</Badge>
        {info.pin && <span className="small muted"> code <strong>{info.pin}</strong></span>}
        {info.track && !['delivered', 'cancelled', 'returned'].includes(info.step || '') && <> · <a className="small" href={alefaTrackUrl(info, conf.url)} target="_blank" rel="noopener">📍 Carte</a></>}
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
  const [board, setBoard] = useState(false);
  const sent = all.filter((o) => alefaOf(o)).sort((a, b) => (alefaOf(b)!.sentAt).localeCompare(alefaOf(a)!.sentAt));
  const live = sent.filter((o) => !['delivered', 'cancelled', 'returned'].includes(alefaOf(o)!.step || ''));
  const sendAll = async () => {
    if (!conf.key) { alefaCsv(todo); toast(`Fichier prêt : importez-le dans Alefa → Entana → ⬆ Excel (${todo.length} commande(s))`); return; }
    setBusy(true);
    let ok = 0;
    for (const o of todo) { try { await sendToAlefa(o, conf); ok++; } catch (e) { toast(`${o.number} : ${(e as Error).message}`, 'error'); } }
    setBusy(false);
    toast(`${ok} commande(s) envoyée(s) à Alefa`);
  };
  const addressOfOrder = (o: Order) => o.place || '';
  if (!todo.length && !conf.key) return null;
  return (
    <span className="row" style={{ gap: 6 }}>
      {todo.length > 0 && <Button variant="ghost" busy={busy} onClick={sendAll}>{conf.key ? `🚲 Envoyer ${todo.length} à Alefa` : `🚲 Fichier Alefa (${todo.length})`}</Button>}
      {conf.key && <Button variant="quiet" onClick={() => { setBoard(true); refreshAlefa(all, conf).catch(() => {}); }}>📍 Où sont les livraisons ? ({live.length})</Button>}
      {board && <Modal title="Livraisons Alefa en cours" wide onClose={() => setBoard(false)}>
        <p className="small muted">Mis à jour automatiquement toutes les 30 s. « 📍 Carte » montre le livreur en direct pendant la livraison.</p>
        <div className="stack-s">{(live.length ? live : sent.slice(0, 20)).map((o) => { const i = alefaOf(o)!; return (
          <div key={o.id} className="row" style={{ justifyContent: 'space-between', gap: 8, borderBottom: '1px solid var(--line, #eee)', padding: '6px 0', flexWrap: 'wrap' }}>
            <span><strong>{o.number}</strong> · {o.name || o.facebook || o.phone}<br /><span className="small muted">{addressOfOrder(o)}</span></span>
            <span style={{ textAlign: 'right' }}><Badge tone={ALEFA_TONE[i.step || ''] || 'neutral'}>{alefaWhere(i)}</Badge>
              {i.pin && <span className="small muted"> · code <strong>{i.pin}</strong></span>}
              {i.track && <> · <a className="small" href={alefaTrackUrl(i, conf.url)} target="_blank" rel="noopener">📍 Carte</a></>}</span>
          </div>); })}
          {!sent.length && <p className="muted">Aucune commande envoyée à Alefa.</p>}</div>
      </Modal>}
    </span>
  );
}

/** Paramètres : adresse d'Alefa et clé API (facultative). */
export function AlefaSettingsCard() {
  const c = useCompany();
  const cur = alefaConf(c);
  const [url, setUrl] = useState(cur.url);
  const [key, setKey] = useState(cur.key);
  const [auto, setAuto] = useState<AlefaAuto>(cur.auto);
  const [pickup, setPickup] = useState(cur.pickup);
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState(false);
  return (
    <div className="card stack-s">
      <div><h3>🚲 Livraison Alefa</h3>
        <p className="muted small">Sans clé : le bouton « 🚲 Alefa » ouvre Alefa avec la commande déjà remplie (le vendeur confirme), et plusieurs commandes donnent un fichier à importer dans Alefa.
          Avec une clé API (fournie par le centre Alefa) : envoi direct, étape de livraison et code de réception affichés ici automatiquement. <button type="button" className="link-btn" onClick={() => setHelp(true)}>Comment ça marche ?</button></p></div>
      <TextField label="Adresse d'Alefa" value={url} onChange={setUrl} placeholder={ALEFA_DEFAULT_URL} />
      <TextField label="Clé API Alefa (facultative)" value={key} onChange={setKey} placeholder="ak_…" autoComplete="off" />
      {key.trim() && <SelectField label="Envoi à Alefa" value={auto} onChange={(v) => setAuto(v as AlefaAuto)} options={[
        { value: 'free', label: 'Automatique : commandes à livrer sans livreur de la boutique' },
        { value: 'all', label: 'Automatique : toutes les commandes à livrer' },
        { value: 'off', label: 'Manuel : bouton 🚲 Alefa sur chaque commande' },
      ]} />}
      {key.trim() && <TextField label="Adresse de récupération (boutique)" value={pickup} onChange={setPickup} placeholder="Ampandrana, Antananarivo" />}
      <div className="row" style={{ gap: 6 }}>
        <Button busy={busy} onClick={async () => {
          setBusy(true);
          try {
            if (key.trim()) { const r = await fetch(`${url.replace(/\/+$/, '')}/api/v1/schedule`, { headers: { 'X-API-Key': key.trim() } }); if (!r.ok) throw new Error('Clé API refusée par Alefa'); }
            await save('settings', { id: 'company', alefaUrl: url.trim(), alefaKey: key.trim(), alefaAuto: key.trim() ? auto : 'off', alefaPickup: pickup.trim() } as any, { force: true });
            await audit('Paramètres', `Liaison Alefa ${key.trim() ? 'avec clé API' : 'sans clé (lien)'} enregistrée`, 'settings', 'company');
            toast(key.trim() ? (auto === 'off' ? 'Alefa relié : envoi par bouton, suivi automatique' : 'Alefa relié : les commandes à livrer partent automatiquement, suivi en direct') : 'Alefa relié en mode lien');
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

/** Tâche de fond (toute l'application) : envoi automatique des commandes à livrer et suivi Alefa toutes les 30 s. */
export function useAlefaBackground(enabled: boolean) {
  const conf = useAlefa();
  const orders = useTable<Order>('orders');
  const ref = useRef({ orders, conf });
  ref.current = { orders, conf };
  const pending = alefaAutoTargets(orders, conf).length;
  useEffect(() => {
    if (!enabled || !conf.key) return;
    let lastErr = '';
    const tick = async () => {
      const { orders: os, conf: c } = ref.current;
      const r = await autoSendAlefa(os, c).catch((e) => ({ ok: 0, errors: [(e as Error).message] }));
      if (r.ok) toast(`🚲 ${r.ok} commande(s) envoyée(s) à Alefa`);
      if (r.errors.length && r.errors[0] !== lastErr) { lastErr = r.errors[0]; toast(`Alefa : ${r.errors[0]}`, 'error'); }
      const open = ref.current.orders.filter((o) => alefaOf(o) && !['delivered', 'cancelled', 'returned'].includes(alefaOf(o)!.step || ''));
      if (open.length) await refreshAlefa(open, c).catch(() => {});
    };
    void tick();
    const t = setInterval(tick, 30000);
    return () => clearInterval(t);
  }, [enabled, conf.key, conf.url, conf.auto, pending]);
}
