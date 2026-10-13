// Notifications à l'écran : bandeau en haut des pages (les plus importantes), cloche avec le nombre, et page
// « Notifications » avec la liste complète (actives, reportées, masquées).
// × = « plus tard » : la notification revient après 1 h (urgente), 2 h (importante) ou 5 h (information).
import { useEffect, useState } from 'react';
import { LEVEL_LABEL, SNOOZE_H, hideNotif, hiddenNotifs, snooze, snoozeTomorrow, unhideNotif, unsnooze, useNotifications, type Notif } from '../lib/notify';
import { useMeta } from '../lib/db';
import { PayDue } from '../pages/Expenses';
import { Button, IconButton, PageHead } from './kit';
import { Icon } from './icons';

function useTick() { const [, set] = useState(0); useEffect(() => { const t = setInterval(() => set((x) => x + 1), 60_000); return () => clearInterval(t); }, []); }

/** Texte long coupé, avec « voir plus » / « voir moins ». */
export function Clamp({ text, max = 110, strong }: { text: string; max?: number; strong?: boolean }) {
  const [open, setOpen] = useState(false);
  const long = text.length > max;
  const shown = !long || open ? text : text.slice(0, text.lastIndexOf(' ', max) > max * 0.6 ? text.lastIndexOf(' ', max) : max).trimEnd() + '…';
  const T = strong ? 'strong' : 'span';
  return (
    <T className={strong ? 'notif-title' : 'small notif-text'}>
      {shown}
      {long && <> <button type="button" className="link-btn" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'voir moins' : 'voir plus'}</button></>}
    </T>
  );
}

const when = (iso: string) => {
  const d = new Date(iso); const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

function Item({ n, onPay, full }: { n: Notif & { until?: string }; onPay: (n: Notif) => void; full?: boolean }) {
  const [menu, setMenu] = useState(false);
  return (
    <div className={`notif notif-${n.level} ${n.until ? 'is-snoozed' : ''}`}>
      <Icon name={n.level === 'info' ? 'cloud' : n.level === 'urgent' ? 'alert' : 'bell'} />
      <div className="notif-main">
        <Clamp text={n.title} max={full ? 140 : 80} strong />
        {n.text && <Clamp text={n.text} max={full ? 160 : 70} />}
        {n.until && <span className="small muted">Reportée — revient {when(n.until)}</span>}
        {full && menu && !n.until && (
          <div className="row notif-snooze" style={{ gap: 4 }}>
            <Button variant="ghost" className="btn-sm" onClick={() => { snooze(n.id, 1); setMenu(false); }}>Dans 1 h</Button>
            <Button variant="ghost" className="btn-sm" onClick={() => { snooze(n.id, 3); setMenu(false); }}>Dans 3 h</Button>
            <Button variant="ghost" className="btn-sm" onClick={() => { snooze(n.id, 'today'); setMenu(false); }}>Pas aujourd’hui</Button>
            <Button variant="ghost" className="btn-sm" onClick={() => { snoozeTomorrow(n.id); setMenu(false); }}>Demain 8 h</Button>
          </div>
        )}
      </div>
      <div className="notif-actions">
        {n.due && n.due.r.kind === 'expense' && <Button onClick={() => onPay(n)}>Payer</Button>}
        {n.href && <a className="btn btn-ghost" href={n.href}>Ouvrir</a>}
        {n.until ? <Button variant="quiet" onClick={() => unsnooze(n.id)}>Réafficher</Button> : full ? <>
          <Button variant="ghost" icon="clock" aria-expanded={menu} onClick={() => setMenu(!menu)}>Plus tard</Button>
          <Button variant="danger" icon="trash" onClick={() => hideNotif(n)} title="Masquée tant que le problème reste le même ; réapparaît si un nouveau problème arrive">Ne plus afficher</Button>
        </> : <IconButton icon="x" label={`Fermer (revient dans ${SNOOZE_H[n.level]} h)`} onClick={() => snooze(n.id, SNOOZE_H[n.level])} />}
      </div>
    </div>
  );
}

/** Bandeau : au plus 3 notifications non reportées. */
export function NotifBar() {
  useTick();
  const list = useNotifications().filter((n) => !n.until);
  const [pay, setPay] = useState<Notif | null>(null);
  // Sur téléphone, une seule (la plus importante) pour laisser la place à la page ; les autres sont dans la cloche.
  const [narrow, setNarrow] = useState(() => matchMedia('(max-width: 600px)').matches);
  useEffect(() => { const m = matchMedia('(max-width: 600px)'); const f = () => setNarrow(m.matches); m.addEventListener?.('change', f); return () => m.removeEventListener?.('change', f); }, []);
  if (!list.length || location.hash.startsWith('#/notifications')) return null;
  const max = narrow ? 1 : 3;
  return (
    <div className="notif-bar" role="status">
      {list.slice(0, max).map((n) => <Item key={n.id} n={n} onPay={setPay} />)}
      {list.length > max && <a className="small muted notif-more" href="#/notifications"><Icon name="bell" size={14} /> + {list.length - max} autre(s) notification(s) : tout voir</a>}
      {pay?.due && <PayDue d={pay.due} onClose={() => setPay(null)} />}
    </div>
  );
}

/** Cloche avec le nombre de notifications actives : ouvre la page Notifications. */
export function NotifBell() {
  useTick();
  const active = useNotifications().filter((n) => !n.until);
  return (
    <a className="bell" href="#/notifications" aria-label={`Notifications (${active.length})`}>
      <Icon name="bell" />{active.length > 0 && <span className={`bell-count ${active.some((n) => n.level === 'urgent') ? 'is-urgent' : ''}`}>{active.length}</span>}
    </a>
  );
}

/** Nombre de notifications actives (pour le menu). */
export function useNotifCount() { return useNotifications().filter((n) => !n.until).length; }

/** Page « Notifications » : consulter, reporter, masquer, réafficher. */
export function NotificationsPage() {
  useTick();
  const all = useNotifications();
  useMeta('notifHidden', {});
  const hidden = Object.entries(hiddenNotifs()).sort((a, b) => b[1].at.localeCompare(a[1].at));
  const active = all.filter((n) => !n.until), later = all.filter((n) => n.until);
  const [pay, setPay] = useState<Notif | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  return (
    <div className="stack">
      <PageHead title="Notifications" subtitle="Un problème réglé disparaît tout seul. « Plus tard » la fait revenir à l’heure choisie. « Ne plus afficher » la masque tant que le problème reste le même : si un nouveau problème apparaît, elle revient."
        actions={active.length > 1 && <Button variant="danger" icon="trash" onClick={async () => { if (confirm(`Masquer les ${active.length} notifications actives ? Elles reviendront seulement en cas de nouveau problème.`)) for (const n of active) await hideNotif(n); }}>Tout masquer</Button>} />
      {active.length === 0 && <div className="card"><p className="muted">Rien à signaler pour l’instant.</p></div>}
      {(['urgent', 'important', 'info'] as const).map((lv) => active.some((n) => n.level === lv) && (
        <div key={lv} className="stack-s"><h3>{LEVEL_LABEL[lv]} <span className="small muted">({active.filter((n) => n.level === lv).length})</span></h3>
          {active.filter((n) => n.level === lv).map((n) => <Item key={n.id} n={n} onPay={setPay} full />)}
        </div>
      ))}
      {later.length > 0 && <div className="stack-s"><h3>Reportées <span className="small muted">({later.length})</span></h3>{later.map((n) => <Item key={n.id} n={n} onPay={setPay} full />)}</div>}
      {hidden.length > 0 && (
        <div className="stack-s">
          <Button variant="quiet" onClick={() => setShowHidden(!showHidden)}>{showHidden ? 'Cacher' : 'Voir'} les notifications masquées ({hidden.length})</Button>
          {showHidden && <ul className="list">{hidden.map(([sig, h]) => (
            <li key={sig} className="list-item"><div className="list-item-main"><p className="list-item-title">{h.title}</p><p className="small muted">Masquée {when(h.at)}</p></div>
              <Button variant="ghost" onClick={() => unhideNotif(sig)}>Réafficher</Button></li>
          ))}</ul>}
        </div>
      )}
      {pay?.due && <PayDue d={pay.due} onClose={() => setPay(null)} />}
    </div>
  );
}
