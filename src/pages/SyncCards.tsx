// Suivi de la synchronisation : appareils reliés (lettre de numérotation) et conflits de modification.
import { useState } from 'react';
import { audit, useCan } from '../lib/auth';
import { get, getMeta, save, useMeta, useTable, type BaseRecord, type TableName } from '../lib/db';
import type { DeviceRec } from '../lib/sync';
import { Help, Badge, Button, Empty, fmtDateTime, timeAgo, toast } from '../ui/kit';

const TABLES: Record<string, string> = {
  orders: 'Commande', customers: 'Client', products: 'Article', variants: 'Variante', categories: 'Catégorie', couriers: 'Livreur', zones: 'Zone',
  purchases: 'Achat', receptions: 'Réception', cashMoves: 'Mouvement de trésorerie', users: 'Utilisateur', roles: 'Rôle', settings: 'Paramètres',
  suppliers: 'Fournisseur', boosts: 'Boost', boostReadings: 'Résultat de boost', pageMessages: 'Messages réels', courierSettlements: 'Versement livreur', payouts: 'Versement au patron', serials: 'Numéro de série',
};
const FIELDS: Record<string, string> = {
  status: 'statut', name: 'nom', phone: 'téléphone', place: 'lieu', notes: 'observations', discount: 'remise', deliveryFee: 'frais de livraison',
  courierId: 'livreur', zoneId: 'zone', lines: 'articles', priceRetail: 'prix détail', priceWholesale: 'prix de gros', costAvg: 'prix de revient',
  amount: 'montant', label: 'libellé', active: 'actif', fullName: 'nom', roleId: 'rôle', count: 'nombre', messages: 'messages', spend: 'dépense',
  slot: 'numéro', code: 'code', alertQty: 'seuil d’alerte', deleted: 'suppression', feeCharged: 'frais facturés',
};
const show = (v: any): string => {
  if (v == null || v === '') return '(vide)';
  if (typeof v === 'boolean') return v ? 'Oui' : 'Non';
  if (Array.isArray(v)) return `${v.length} élément(s)`;
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 80);
  return String(v).slice(0, 120);
};
const recLabel = (tbl: string, id: string) => {
  const r = get<BaseRecord>(tbl as TableName, id);
  return r ? (r.number || r.name || r.fullName || r.label || r.code || r.phone || id.slice(0, 8)) : `${id.slice(0, 8)} (supprimé)`;
};
const devName = (id?: string) => {
  if (!id) return '';
  const d = get<DeviceRec>('devices', id);
  return d ? `${d.name || 'appareil'} (${d.code})` : 'autre appareil';
};

export function DevicesCard() {
  const devices = useTable<DeviceRec>('devices');
  const me = getMeta<string>('deviceId', '');
  const code = useMeta<string>('deviceCode', '');
  const list = [...devices].sort((a, b) => a.code.localeCompare(b.code));
  return (
    <div className="card card-flush">
      <div className="card-pad"><h3>Appareils reliés</h3>
        <p className="small muted">Chaque appareil a sa lettre : les numéros qu’il crée la portent (ex. C-{code || 'A'}0012). Deux vendeurs hors ligne ne peuvent donc jamais créer le même numéro.</p></div>
      {list.length === 0 ? <p className="card-pad small muted">La lettre de cet appareil sera attribuée à la première synchronisation.</p> : (
        <ul className="list">{list.map((d) => (
          <li key={d.id} className="list-item">
            <span className="slot-badge">{d.code}</span>
            <div className="list-item-main"><span className="list-item-title">{d.name || 'Appareil sans nom'}{d.id === me ? ' — cet appareil' : ''}</span><p className="small muted">Vu {timeAgo(d.lastSeen)}</p></div>
          </li>
        ))}</ul>
      )}
    </div>
  );
}

interface ConflictRec extends BaseRecord { tbl: string; recId: string; field: string; kept: any; lost: any; keptBy?: string; lostBy?: string; keptDev?: string; lostDev?: string; keptAt: string; lostAt: string; resolved?: boolean; resolution?: string }

export function ConflictsCard() {
  const can = useCan();
  const all = useTable<ConflictRec>('syncConflicts');
  const [showAll, setShowAll] = useState(false);
  const open = all.filter((c) => !c.resolved).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const done = all.filter((c) => c.resolved).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 20);
  const list = showAll ? [...open, ...done] : open;
  const admin = can('users.manage');
  const close = async (c: ConflictRec, resolution: string) => { await save('syncConflicts', { id: c.id, resolved: true, resolution }); };
  return (
    <div className="card card-flush">
      <div className="card-pad row-between">
        <div><h3>Conflits de synchronisation {open.length > 0 && <Badge tone="warn">{open.length} à vérifier</Badge>}</h3>
          <Help>Quand la même information est modifiée sur deux appareils avant la synchronisation, la modification la plus récente est gardée partout. L’autre valeur n’est pas perdue : elle est notée ici et peut être rétablie.</Help></div>
        {done.length > 0 && <Button variant="quiet" onClick={() => setShowAll(!showAll)}>{showAll ? 'Masquer les conflits réglés' : 'Voir aussi les conflits réglés'}</Button>}
      </div>
      {list.length === 0 ? <Empty icon="check" title="Aucun conflit à vérifier">Toutes les modifications ont été fusionnées sans conflit.</Empty> : (
        <ul className="list">{list.map((c) => {
          const scalar = c.lost == null || typeof c.lost !== 'object';
          return (
            <li key={c.id} className="list-item" style={{ alignItems: 'flex-start', opacity: c.resolved ? .6 : 1 }}>
              <div className="list-item-main stack-s">
                <span className="list-item-title">{TABLES[c.tbl] ?? c.tbl} {recLabel(c.tbl, c.recId)} — {FIELDS[c.field] ?? c.field}</span>
                <p className="small">Gardé : <strong>{show(c.kept)}</strong> <span className="muted">({c.keptBy || '?'}, {devName(c.keptDev)}, {fmtDateTime(c.keptAt)})</span></p>
                <p className="small">Écarté : <strong>{show(c.lost)}</strong> <span className="muted">({c.lostBy || '?'}, {devName(c.lostDev)}, {fmtDateTime(c.lostAt)})</span></p>
                {c.resolved && <p className="small muted">Réglé : {c.resolution}</p>}
              </div>
              {!c.resolved && admin && (
                <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                  {scalar && get(c.tbl as TableName, c.recId) && <Button variant="ghost" onClick={async () => {
                    await save(c.tbl as TableName, { id: c.recId, [c.field]: c.lost });
                    await close(c, `valeur écartée rétablie (${show(c.lost)})`);
                    await audit('Synchronisation', `${TABLES[c.tbl] ?? c.tbl} ${recLabel(c.tbl, c.recId)} : ${FIELDS[c.field] ?? c.field} rétabli à « ${show(c.lost)} »`);
                    toast('Valeur rétablie');
                  }}>Rétablir l’autre valeur</Button>}
                  <Button variant="quiet" onClick={() => close(c, 'valeur gardée confirmée')}>C’est bon</Button>
                </div>
              )}
            </li>
          );
        })}</ul>
      )}
    </div>
  );
}
