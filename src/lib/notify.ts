// Notifications : calculées à partir des données (charges à payer, choix à préciser, stock bas, semaines à verser,
// conflits de synchronisation, sauvegarde). Un problème réglé disparaît tout seul. Chacune peut être fermée (×) : elle
// revient plus tard selon son importance (urgente : 1 h, importante : 2 h, information : 5 h), reportée (1 h, 3 h,
// demain, pas aujourd'hui) ou masquée « ne plus afficher » tant qu'aucun nouveau problème n'apparaît.
// Réglage propre à chaque appareil.
import { useMemo } from 'react';
import { useCan } from './auth';
import { getMeta, setMeta, useMeta, useTable } from './db';
import { productStock, type Product } from './catalog';
import { hasPendingChoice, type Order } from './orders';
import { courierBalance, dueRecurring, mondayOf, today, type Recurring } from './money';
import type { Courier } from './orders';
import { unpaidWeeks } from './payouts';
import { dueProspects } from './prospects';
import { reportsDue } from '../pages/BossReport';
import { currentUser } from './auth';
import { fmtAr } from './catalog';
import { allPages, boostDues, boostOwners, deadlineText, pageName } from './boosts';

export type Level = 'urgent' | 'important' | 'info';
export const SNOOZE_H: Record<Level, number> = { urgent: 1, important: 2, info: 5 };
export const LEVEL_LABEL: Record<Level, string> = { urgent: 'Urgent', important: 'Important', info: 'Information' };
export interface Notif { id: string; level: Level; title: string; text?: string; href?: string; due?: ReturnType<typeof dueRecurring>[number] }

type Snoozes = Record<string, string>;
export function snooze(id: string, hours: number | 'today') {
  const until = hours === 'today' ? (() => { const d = new Date(); d.setHours(23, 59, 59, 0); return d; })() : new Date(Date.now() + hours * 3600_000);
  const cur = { ...getMeta<Snoozes>('notifSnooze', {}) };
  for (const [k, v] of Object.entries(cur)) if (v < new Date().toISOString()) delete cur[k]; // ménage
  cur[id] = until.toISOString();
  return setMeta('notifSnooze', cur);
}
export const unsnooze = (id: string) => { const cur = { ...getMeta<Snoozes>('notifSnooze', {}) }; delete cur[id]; return setMeta('notifSnooze', cur); };
/** Report jusqu'à demain matin (8 h). */
export function snoozeTomorrow(id: string) {
  const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(8, 0, 0, 0);
  return snooze(id, (d.getTime() - Date.now()) / 3600_000);
}

// « Ne plus afficher » : la notification est masquée tant que le problème reste le même. Si la situation change
// (nouveau problème, nombre différent, autre article…), sa signature change et elle réapparaît.
type Hidden = Record<string, { at: string; title: string }>;
export const notifSig = (n: Pick<Notif, 'id' | 'title'>) => `${n.id}|${n.title}`;
export function hideNotif(n: Notif) {
  const cur = { ...getMeta<Hidden>('notifHidden', {}) };
  cur[notifSig(n)] = { at: new Date().toISOString(), title: n.title };
  // Ménage : on garde les 300 plus récentes.
  const keep = Object.entries(cur).sort((a, b) => b[1].at.localeCompare(a[1].at)).slice(0, 300);
  return setMeta('notifHidden', Object.fromEntries(keep));
}
export function unhideNotif(sig: string) { const cur = { ...getMeta<Hidden>('notifHidden', {}) }; delete cur[sig]; return setMeta('notifHidden', cur); }
export const hiddenNotifs = () => getMeta<Hidden>('notifHidden', {});

/** Toutes les notifications de l'utilisateur connecté, avec l'heure de rappel si elles sont reportées. */
export function useNotifications() {
  const can = useCan();
  const orders = useTable<Order>('orders'); const moves = useTable('cashMoves'); const recs = useTable<Recurring>('recurring');
  const products = useTable<Product>('products'); const sm = useTable('stockMoves'); const conflicts = useTable<any>('syncConflicts'); const payouts = useTable('payouts'); const prospects = useTable('prospects'); const couriers = useTable<Courier>('couriers'); const settles = useTable('courierSettlements'); const auditRows = useTable<any>('audit'); const readings = useTable('boostReadings'); const boostsT = useTable('boosts');
  const snoozes = useMeta<Snoozes>('notifSnooze', {});
  const hidden = useMeta<Hidden>('notifHidden', {});
  const reportSent = useMeta<Record<string, string>>('reportSent', {});
  const lastFile = useMeta<string | null>('lastFileBackup', null); const lastCloud = useMeta<string | null>('lastCloudBackup', null);
  // Le temps passe : les charges « à telle heure » apparaissent sans autre changement (rafraîchi chaque minute par le composant).
  const minute = Math.floor(Date.now() / 60000);
  const list = useMemo(() => {
    const out: Notif[] = [];
    if (can('expenses.manage')) {
      // Une seule notification par charge fixe (la plus ancienne échéance non payée), même s'il y en a plusieurs.
      const byRec = new Map<string, ReturnType<typeof dueRecurring>>();
      for (const d of dueRecurring()) { if (!byRec.has(d.r.id)) byRec.set(d.r.id, []); byRec.get(d.r.id)!.push(d); }
      for (const [rid, ds] of byRec) {
        const d = ds[0];
        out.push({ id: `due:${rid}:${d.period}`, level: 'urgent', title: `${d.r.label} ${d.r.kind === 'income' ? 'à encaisser' : 'à payer'} : ${fmtAr(d.r.amount)}`, text: `Échéance du ${new Date(d.date + 'T12:00:00').toLocaleDateString('fr-FR')}${d.r.time ? ` à ${d.r.time}` : ''}${ds.length > 1 ? ` · ${ds.length} échéances en attente` : ''}`, href: '#/depenses', due: d });
      }
    }
    if (can('couriers.settle')) {
      // Frais de livraison différés : à payer au livreur au plus vite (urgent le soir, ou s'il les a réclamés).
      for (const c of couriers) {
        const owed = -courierBalance(c.id).carry;
        if (owed <= 0) continue;
        const evening = new Date().getHours() >= 17;
        out.push({ id: `frais:${c.id}:${today()}${c.feeClaimAt ? ':r' + c.feeClaimAt : ''}`, level: c.feeClaimAt || evening ? 'urgent' : 'important', title: `${c.feeClaimAt ? `${c.name} réclame ses frais` : `Frais de livraison à payer à ${c.name}`} : ${fmtAr(owed)}`, text: c.feeClaimAt ? `Réclamé le ${new Date(c.feeClaimAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}` : 'Frais différés : à régler au plus tard à la clôture du soir', href: '#/livraisons/retour' });
      }
    }
    if (can('deliveries.manage')) {
      const ch = orders.filter((o) => hasPendingChoice(o));
      if (ch.length) out.push({ id: 'choix', level: 'urgent', title: `${ch.length} livraison(s) avec un choix à préciser`, text: ch.slice(0, 4).map((o) => o.number).join(', '), href: can('deliveries.menu') ? '#/livraisons/retour' : '#/commandes/livraison' });
    }
    if (can('orders.create')) {
      // Clients à suivre dont l'heure de relance est passée (les siens ; le gérant voit tout).
      const due = dueProspects(can('users.manage') ? undefined : currentUser()?.id);
      if (due.length) out.push({ id: 'suivre', level: 'important', title: `${due.length} client(s) à relancer`, text: due.slice(0, 4).map((p) => p.fbName).join(', '), href: '#/commandes/suivre' });
    }
    if (can('reports.view')) {
      // Rapports au patron à envoyer : du jour (le soir), de la semaine (lundi), du mois (le 1er), de l'année (1er janvier).
      for (const d of reportsDue()) if (!reportSent[d.key]) out.push({ id: 'rapport:' + d.key, level: d.kind === 'day' ? 'info' : 'important', title: `Rapport ${d.kind === 'day' ? 'du jour' : d.kind === 'week' ? 'de la semaine' : d.kind === 'month' ? 'du mois' : "de l'année"} à envoyer au patron`, text: d.label, href: `#/rapports/patron?p=${d.kind}&a=${d.anchor}` });
    }
    if (can('payout.validate')) {
      const w = unpaidWeeks(today(), mondayOf);
      if (w.length) out.push({ id: 'versement', level: 'important', title: `${w.length} semaine(s) terminée(s) pas encore versée(s) au patron`, text: `Dernière : ${fmtAr(w[0].expected)} à verser`, href: '#/recapitulatif' });
    }
    if (can('catalog.view')) {
      const act = products.filter((p) => p.active !== false && p.kind !== 'lot');
      let out0 = 0, low = 0;
      for (const p of act) { const s = productStock(p.id); if (s <= 0) out0++; else if (s <= (p.alertQty ?? 3)) low++; }
      if (out0 + low) out.push({ id: 'stock', level: 'important', title: `Stock : ${low ? `${low} article(s) presque épuisé(s)` : ''}${low && out0 ? ', ' : ''}${out0 ? `${out0} en rupture` : ''}`, href: '#/stock' });
    }
    {
      // Compte boost du jour (les boosts tournent tous les jours) : rappel à ceux qui le font, alerte au gérant / super-admin.
      const me = currentUser();
      if (can('boosts.enter') && me) {
        const mine = allPages().filter((p) => me.roleId === 'role-manager' || can('users.manage') || (me.pageIds ?? []).includes(p.id)).map((p) => p.id);
        const dues = boostDues(new Date(), mine);
        const late = dues.filter((d) => d.late), soon = dues.filter((d) => !d.late);
        if (late.length) out.push({ id: `boost-late:${late.map((d) => d.pageId + d.date).join(',')}`, level: 'urgent', title: `Faites votre compte boost : ${late.length} en retard`, text: late.slice(0, 4).map((d) => `${pageName(d.pageId)} (${new Date(`${d.date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' })})`).join(', '), href: '#/boosts/suivi' });
        else if (soon.length) out.push({ id: `boost-soon:${soon[0].date}`, level: 'important', title: `Compte boost à faire avant ${deadlineText(soon[0].date)}`, text: [...new Set(soon.map((d) => pageName(d.pageId)))].slice(0, 5).join(', '), href: '#/boosts/suivi' });
      }
      if (can('records.correct')) {
        const late = boostDues(new Date()).filter((d) => d.late);
        if (late.length) out.push({ id: `boost-team:${late.map((d) => d.pageId + d.date).join(',')}`, level: 'urgent', title: `Compte boost pas fait à l’heure : ${late.length} page(s)`, text: late.slice(0, 4).map((d) => `${pageName(d.pageId)} — ${boostOwners(d.pageId).map((u) => u.fullName).join(', ') || 'personne désignée'}`).join(' · '), href: '#/boosts/suivi' });
      }
    }
    if (can('records.correct')) {
      // Actions importantes (annulation, correction, suppression, restauration…) à vérifier par le super-admin / gérant.
      const todo = auditRows.filter((r) => r.review === 'todo').sort((a, b) => b.at.localeCompare(a.at));
      if (todo.length) out.push({ id: `audit:${todo[0].id}`, level: 'urgent', title: `${todo.length} action(s) importante(s) à vérifier`, text: todo.slice(0, 3).map((r) => `${r.action} (${r.userName}, ${new Date(r.at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })})`).join(' · '), href: '#/journal' });
    }
    if (can('users.manage')) {
      const open = conflicts.filter((c) => !c.resolved).length;
      if (open) out.push({ id: 'conflits', level: 'important', title: `${open} conflit(s) de synchronisation à vérifier`, href: '#/parametres/cloud' });
    }
    if (can('backup.manage')) {
      const last = [lastFile, lastCloud].filter(Boolean).sort().pop();
      if (!last || Date.now() - new Date(last).getTime() > 7 * 86400_000) out.push({ id: 'sauvegarde', level: 'info', title: last ? 'Pas de sauvegarde depuis plus de 7 jours' : 'Aucune sauvegarde faite', href: '#/parametres/sauvegarde' });
    }
    const rank: Record<Level, number> = { urgent: 0, important: 1, info: 2 };
    return out.sort((a, b) => rank[a.level] - rank[b.level]);
  }, [orders, moves, recs, products, sm, conflicts, payouts, prospects, couriers, settles, auditRows, readings, boostsT, reportSent, lastFile, lastCloud, minute]);
  const now = new Date().toISOString();
  return list.filter((n) => !hidden[notifSig(n)]).map((n) => ({ ...n, until: snoozes[n.id] && snoozes[n.id] > now ? snoozes[n.id] : undefined }));
}
