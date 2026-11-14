// Liaison avec Alefa (livraison à vélo, Antananarivo) : envoyer une commande comme colis et suivre son étape.
// Deux modes : sans clé (lien « Alefa » prérempli, ou fichier CSV pour plusieurs commandes)
// et avec clé API (envoi direct + suivi automatique de l'étape et du code de réception).
import { get, save } from './db';
import { audit } from './auth';
import { useCompany, type Company } from './settings';
import { isPickupZone, remaining, sellingLines, type Order, type Zone } from './orders';
import { variantLabel, type Variant } from './catalog';

export const ALEFA_DEFAULT_URL = 'https://livraison.oasismdg3434.workers.dev';

export interface AlefaInfo { ref: string; pin?: string; step?: string; label?: string; fee?: number; courier?: string; departureAt?: number; track?: string; accepted?: boolean; sentAt: string; checkedAt?: string }
type WithAlefa = Order & { alefa?: AlefaInfo };
/** Envoi automatique : 'off' (bouton), 'free' (commandes sans livreur de la boutique), 'all' (toutes les commandes à livrer). */
export type AlefaAuto = 'off' | 'free' | 'all';
type CompanyAlefa = Company & { alefaUrl?: string; alefaKey?: string; alefaAuto?: AlefaAuto; alefaPickup?: string };

export const alefaOf = (o: Order) => (o as WithAlefa).alefa;
export const alefaConf = (c: Company) => {
  const x = c as CompanyAlefa;
  return { url: (x.alefaUrl || ALEFA_DEFAULT_URL).replace(/\/+$/, ''), key: (x.alefaKey || '').trim(), auto: (x.alefaAuto || 'off') as AlefaAuto,
    pickup: (x.alefaPickup || c.address || '').trim(), shop: c.name, phone: c.phone || '' };
};
export type AlefaConf = ReturnType<typeof alefaConf>;
/** Page de suivi Alefa (carte en direct du livreur, sans compte). */
export const alefaTrackUrl = (info: AlefaInfo | undefined, url: string) => (info?.track ? `${url}/suivi/${info.track}` : '');
export const useAlefa = () => alefaConf(useCompany());

/** Montant des articles à encaisser chez le client (les frais de livraison sont ceux d'Alefa, ajoutés par Alefa). */
export const alefaValue = (o: Order) => Math.max(0, Math.round(remaining(o) - (o.deliveryFee || 0)));

function describe(o: Order) {
  return sellingLines(o).map((l) => `${l.qty} × ${variantLabel(get<Variant>('variants', l.variantId)) || 'article'}`).join(', ').slice(0, 280);
}
function addressOf(o: Order) {
  const zone = o.zoneId ? get<Zone>('zones', o.zoneId)?.name : '';
  return [o.place, zone].filter(Boolean).join(', ') || 'Adresse à confirmer';
}

/** Lien « Alefa » : le formulaire Alefa s'ouvre déjà rempli, le vendeur confirme. Aucune clé nécessaire. */
export function alefaLink(o: Order, url: string) {
  const p = new URLSearchParams({ ref: o.number, nom: o.name || o.facebook || 'Client', tel: o.phone, adresse: addressOf(o), valeur: String(alefaValue(o)), desc: describe(o) });
  return `${url}/envoyer?${p.toString()}`;
}

/** Fichier CSV au format d'import Alefa (Entana → ⬆ Excel). */
export function alefaCsv(orders: Order[]) {
  const esc = (v: string | number) => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = ['ref;nom;telephone;adresse;valeur;description', ...orders.map((o) => [o.number, o.name || o.facebook || 'Client', o.phone, addressOf(o), alefaValue(o), describe(o)].map(esc).join(';'))];
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' }));
  a.download = `alefa-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

async function api(url: string, key: string, method: string, path: string, body?: unknown) {
  const r = await fetch(`${url}/api/v1${path}`, { method, headers: { 'X-API-Key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || `Alefa : erreur ${r.status}`);
  return j;
}
const infoFrom = (s: any, prev?: AlefaInfo): AlefaInfo => ({ ...(prev || { sentAt: new Date().toISOString() }), ref: s.ref, pin: s.delivery_pin ?? prev?.pin, step: s.step, label: s.step_label, fee: s.fee, courier: s.courier?.name ?? undefined, departureAt: s.departure_at ?? undefined, track: s.track_token ?? prev?.track, accepted: !!s.accepted_at, checkedAt: new Date().toISOString() });

/** Envoi direct par l'API (clé configurée dans Paramètres). Renvoie l'info enregistrée sur la commande. */
export async function sendToAlefa(o: Order, conf: AlefaConf) {
  const r = await api(conf.url, conf.key, 'POST', '/shipments', {
    external_ref: o.number, declared_value: alefaValue(o), description: [describe(o), o.notes].filter(Boolean).join(' · ').slice(0, 290),
    sender: { name: conf.shop, ...(conf.phone ? { phone: conf.phone } : {}), address: conf.pickup || conf.shop },
    recipient: { name: o.name || o.facebook || 'Client', phone: o.phone, address: addressOf(o) },
  });
  const info = infoFrom(r.shipment);
  await save('orders', { id: o.id, alefa: info } as Partial<Order>);
  await audit('Livraisons', `Commande ${o.number} envoyée à Alefa (${info.ref})`, 'orders', o.id);
  return info;
}

/** Met à jour l'étape Alefa des commandes envoyées (un seul appel). */
export async function refreshAlefa(orders: Order[], conf: AlefaConf) {
  const sent = orders.filter((o) => alefaOf(o));
  if (!sent.length || !conf.key) return 0;
  const r = await api(conf.url, conf.key, 'GET', '/shipments?limit=200');
  const byRef = new Map<string, any>(r.shipments.map((s: any) => [s.external_ref || s.ref, s]));
  const changed = (a: AlefaInfo, s: any) => s.step !== a.step || (s.courier?.name ?? undefined) !== a.courier || !!s.accepted_at !== !!a.accepted || (s.track_token && s.track_token !== a.track) || (s.departure_at ?? undefined) !== a.departureAt;
  const updates = sent.map((o) => { const s = byRef.get(o.number) || byRef.get(alefaOf(o)!.ref); return s && changed(alefaOf(o)!, s) ? { id: o.id, alefa: infoFrom(s, alefaOf(o)) } : null; }).filter(Boolean);
  if (updates.length) await save('orders', updates as Partial<Order>[]);
  return updates.length;
}

/** Étapes Alefa → couleur du badge. */
export const ALEFA_TONE: Record<string, 'neutral' | 'brand' | 'warn' | 'ok' | 'danger'> = {
  pending: 'warn', scheduled: 'brand', departed: 'brand', at_pickup: 'brand', picked_up: 'brand', en_route: 'brand', nearby: 'brand',
  awaiting_recipient: 'warn', awaiting_courier: 'warn', delivered: 'ok', refused: 'danger', cancelled: 'danger', returning: 'danger', returned: 'danger',
};

/** Commandes « à livrer » qui partent toutes seules chez Alefa selon le réglage d'envoi automatique. */
export const alefaAutoTargets = (orders: Order[], conf: AlefaConf) => (!conf.key || conf.auto === 'off') ? [] :
  orders.filter((o) => o.status === 'ready' && !alefaOf(o) && !isPickupZone(o.zoneId) && !!o.phone && (conf.auto === 'all' || !o.courierId));

const inFlight = new Set<string>();
/** Envoi automatique (une commande n'est jamais envoyée deux fois : Alefa ignore les doublons de numéro). */
export async function autoSendAlefa(orders: Order[], conf: AlefaConf) {
  let ok = 0; const errors: string[] = [];
  for (const o of alefaAutoTargets(orders, conf)) {
    if (inFlight.has(o.id)) continue;
    inFlight.add(o.id);
    try { await sendToAlefa(o, conf); ok++; } catch (e) { errors.push(`${o.number} : ${(e as Error).message}`); } finally { inFlight.delete(o.id); }
  }
  return { ok, errors };
}

/** Texte court « où en est la livraison » : étape, livreur, heure de départ. */
export function alefaWhere(info: AlefaInfo) {
  const time = info.departureAt ? new Date(info.departureAt).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  const wait = info.step === 'scheduled' && info.courier && !info.accepted ? ' (à accepter)' : '';
  return [`${info.label || info.step || 'Envoyée'}${wait}`, info.courier && `🚲 ${info.courier}`, info.step === 'scheduled' && time && `départ ${time}`].filter(Boolean).join(' · ');
}
