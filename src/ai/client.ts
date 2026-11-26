// Assistant IA côté appareil : TOUT passe par la fonction cloud « ai-chat » (jamais directement le serveur IA ni la
// base). La fonction est appelée avec le jeton de connexion cloud de l'appareil et l'utilisateur connecté.
import { useSyncExternalStore } from 'react';
import { get, useTable } from '../lib/db';
import { currentUser } from '../lib/auth';
import { cloudSession, getCloud } from '../lib/sync';

/** Réglages IA partagés (fiche settings/ai, synchronisée) — jamais la clé API. */
export interface AiSettings { id: 'ai'; enabled?: boolean; localUrl?: string; onlineUrl?: string; model?: string }
export const AI_DEFAULTS = { localUrl: 'http://10.5.50.7:1234/v1', onlineUrl: 'https://ia.ampandrana-ai.app/v1', model: 'qwen3.8-27b' };
export const aiSettings = (): AiSettings => ({ id: 'ai', ...AI_DEFAULTS, ...((get('settings', 'ai') as AiSettings | undefined) ?? {}) });
export function useAiSettings(): AiSettings { useTable('settings'); return aiSettings(); }

export class AiError extends Error { constructor(m: string, public status = 0) { super(m); this.name = 'AiError'; } }
export const UNAVAILABLE = "L'assistant IA est momentanément indisponible. Réessayez dans quelques minutes.";

async function callFn(body: Record<string, unknown>, signal?: AbortSignal, retried = false): Promise<Response> {
  if (!getCloud()) throw new AiError('Cet appareil n’est pas relié au cloud (Paramètres → Cloud et synchronisation).');
  const cfg = await cloudSession(retried);
  if (!cfg) throw new AiError('Cet appareil n’est pas relié au cloud.');
  const user = currentUser();
  let res: Response;
  try {
    res = await fetch(`${cfg.url}/functions/v1/ai-chat`, {
      method: 'POST', signal,
      headers: { apikey: cfg.anonKey, Authorization: `Bearer ${cfg.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, userId: user?.id }),
    });
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e;
    throw new AiError(navigator.onLine ? UNAVAILABLE : 'Pas de connexion Internet.');
  }
  if (res.status === 401 && !retried) return callFn(body, signal, true);
  if (res.status === 404) throw new AiError("L'assistant IA n'est pas encore installé dans le cloud (fonction « ai-chat » introuvable).", 404);
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new AiError(j.error || UNAVAILABLE, res.status);
  }
  return res;
}
const asJson = async <T,>(r: Promise<Response>) => (await r).json() as Promise<T>;

export interface AiStatus { enabled: boolean; model: string; localUrl: string; onlineUrl: string; hasKey: boolean; admin: boolean }
export const aiStatus = () => asJson<AiStatus>(callFn({ action: 'status' }));
export interface AiTest { ok: boolean; via?: 'local' | 'online'; ms?: number; modelFound?: boolean; models?: string[]; local?: string; online?: string }
export const aiTest = (over: { localUrl: string; onlineUrl: string; model: string; apiKey?: string }) => asJson<AiTest>(callFn({ action: 'test', ...over }));
export const aiSetKey = (apiKey: string) => asJson<{ ok: boolean; hasKey: boolean }>(callFn({ action: 'set_key', apiKey }));

// ---------- Conversation ----------
export interface ChatMsg { role: 'user' | 'assistant'; content: string; error?: boolean }
export type ChatEvent =
  | { type: 'meta'; via: 'local' | 'online' }
  | { type: 'thinking' }
  | { type: 'tool'; name: string; label: string }
  | { type: 'delta'; text: string }
  | { type: 'replace'; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string; code?: string };

/** Envoie la conversation et lit la réponse en streaming (SSE). */
export async function aiChat(messages: ChatMsg[], onEvent: (e: ChatEvent) => void, signal?: AbortSignal) {
  const res = await callFn({ action: 'chat', messages: messages.filter((m) => !m.error).map(({ role, content }) => ({ role, content })) }, signal);
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      for (const line of block.split('\n')) if (line.startsWith('data: ')) { try { onEvent(JSON.parse(line.slice(6))); } catch { /* morceau illisible */ } }
    }
  }
}

// ---------- État de la bulle (gardé quand on change de page, et le temps de la session de l'onglet) ----------
export interface ChatState { open: boolean; messages: ChatMsg[]; busy: boolean; status: string; via?: 'local' | 'online' }
const KEY = 'tsena-ai-chat';
let state: ChatState = (() => {
  try { const s = JSON.parse(sessionStorage.getItem(KEY) || 'null'); if (s && Array.isArray(s.messages)) return { open: !!s.open, messages: s.messages, busy: false, status: '', via: s.via, owner: s.owner } as ChatState; } catch { /* rien */ }
  return { open: false, messages: [], busy: false, status: '' };
})();
const subs = new Set<() => void>();
export function setChat(patch: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>)) {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  try { sessionStorage.setItem(KEY, JSON.stringify({ open: state.open, messages: state.messages.slice(-60), via: state.via, owner: currentUser()?.id })); } catch { /* plein */ }
  subs.forEach((f) => f());
}
export const chatState = () => state;
export function useChat(): ChatState { return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => state); }
/** Autre utilisateur connecté sur l'appareil : il ne voit pas la conversation du précédent. */
export function chatOwnerCheck(userId?: string) {
  const owner = (state as any).owner;
  if (owner && userId && owner !== userId) { state = { open: false, messages: [], busy: false, status: '' }; try { sessionStorage.removeItem(KEY); } catch { /* rien */ } subs.forEach((f) => f()); }
  (state as any).owner = userId;
}
