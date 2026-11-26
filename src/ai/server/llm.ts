// Connexion au serveur IA (LM Studio, API compatible OpenAI) : adresse locale en priorité, sinon adresse en ligne
// avec la clé. L'adresse choisie est gardée 60 s ; si une requête échoue, on bascule sur l'autre et on réessaie une fois.
// Le raisonnement du modèle (reasoning_content, balises <think>) n'est jamais transmis.

export interface AiConfig { localUrl: string; onlineUrl: string; model: string; apiKey?: string }
export type Via = 'local' | 'online';
export interface Endpoint { via: Via; base: string; headers: Record<string, string> }

export const DEFAULTS = { localUrl: 'http://10.5.50.7:1234/v1', onlineUrl: 'https://ia.ampandrana-ai.app/v1', model: 'qwen3.8-27b' };
const PROBE_MS = 1500;
const KEEP_MS = 60_000;

/** Journal des erreurs IA (journaux de la fonction dans Supabase), sans jamais la clé. */
export function logError(cfg: AiConfig | undefined, where: string, e: unknown) {
  let msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  if (cfg?.apiKey) msg = msg.split(cfg.apiKey).join('••••');
  console.error(`[ai-chat] ${where}: ${msg.slice(0, 500)}`);
}

const trimUrl = (u: string) => u.trim().replace(/\/+$/, '');
export function endpoint(cfg: AiConfig, via: Via): Endpoint | null {
  if (via === 'local') return cfg.localUrl ? { via, base: trimUrl(cfg.localUrl), headers: {} } : null;
  if (!cfg.onlineUrl || !cfg.apiKey) return null;
  return { via, base: trimUrl(cfg.onlineUrl), headers: { Authorization: `Bearer ${cfg.apiKey}` } };
}

async function fetchT(url: string, init: RequestInit, ms: number, outer?: AbortSignal) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(new Error(`délai dépassé (${ms} ms)`)), ms);
  const stop = () => c.abort(outer?.reason);
  outer?.addEventListener('abort', stop);
  try { return await fetch(url, { ...init, signal: c.signal }); }
  finally { clearTimeout(t); outer?.removeEventListener('abort', stop); }
}

/** Liste des modèles : sert de test de connexion. */
export async function probe(ep: Endpoint, ms = PROBE_MS): Promise<{ ms: number; models: string[] }> {
  const t0 = Date.now();
  const res = await fetchT(`${ep.base}/models`, { headers: ep.headers }, ms);
  if (!res.ok) throw new Error(res.status === 401 ? 'clé API refusée (401)' : `réponse ${res.status}`);
  const j = await res.json().catch(() => ({}));
  return { ms: Date.now() - t0, models: (j?.data ?? []).map((m: any) => String(m.id)) };
}

let chosen: { via: Via; at: number; sig: string } | null = null;
const sigOf = (c: AiConfig) => [c.localUrl, c.onlineUrl, c.apiKey ? 'k' : ''].join('|');
export const forgetChoice = () => { chosen = null; };

/** Adresse à utiliser maintenant : locale si elle répond en 1,5 s, sinon en ligne (choix gardé 60 s). */
export async function pick(cfg: AiConfig): Promise<Endpoint> {
  const sig = sigOf(cfg);
  if (chosen && chosen.sig === sig && Date.now() - chosen.at < KEEP_MS) {
    const ep = endpoint(cfg, chosen.via);
    if (ep) return ep;
  }
  const local = endpoint(cfg, 'local');
  if (local) {
    try { await probe(local); chosen = { via: 'local', at: Date.now(), sig }; return local; }
    catch (e) { logError(cfg, 'adresse locale injoignable', e); }
  }
  const online = endpoint(cfg, 'online');
  if (!online) throw new UnavailableError(cfg.apiKey ? 'adresse en ligne manquante' : 'adresse locale injoignable et aucune clé API pour l’adresse en ligne');
  chosen = { via: 'online', at: Date.now(), sig };
  return online;
}
function other(cfg: AiConfig, via: Via) {
  const ep = endpoint(cfg, via === 'local' ? 'online' : 'local');
  if (ep) chosen = { via: ep.via, at: Date.now(), sig: sigOf(cfg) };
  return ep;
}

export class UnavailableError extends Error { constructor(m: string) { super(m); this.name = 'UnavailableError'; } }

/** Test complet pour l'écran Réglages : quelle adresse répond, en combien de temps, et le modèle est-il là ? */
export async function testConnection(cfg: AiConfig) {
  const out: { ok: boolean; via?: Via; ms?: number; modelFound?: boolean; models?: string[]; local?: string; online?: string } = { ok: false };
  const local = endpoint(cfg, 'local');
  if (local) {
    try { const r = await probe(local); Object.assign(out, { ok: true, via: 'local', ms: r.ms, models: r.models, modelFound: r.models.includes(cfg.model) }); chosen = { via: 'local', at: Date.now(), sig: sigOf(cfg) }; return out; }
    catch (e: any) { out.local = e?.message ?? String(e); }
  } else out.local = 'adresse non renseignée';
  const online = endpoint(cfg, 'online');
  if (online) {
    try { const r = await probe(online, 10_000); Object.assign(out, { ok: true, via: 'online', ms: r.ms, models: r.models, modelFound: r.models.includes(cfg.model) }); chosen = { via: 'online', at: Date.now(), sig: sigOf(cfg) }; }
    catch (e: any) { out.online = e?.message ?? String(e); }
  } else out.online = cfg.apiKey ? 'adresse non renseignée' : 'aucune clé API enregistrée';
  if (out.online) out.online = out.online.split(cfg.apiKey || '\u0000').join('••••');
  return out;
}

// ---------- Messages ----------
export interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
export type Msg =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

/** Retire le raisonnement écrit dans le texte (<think>…</think>), même coupé entre deux morceaux. */
export class ThinkFilter {
  private buf = '';
  private inThink = false;
  /** Texte visible déjà rendu dans ce tour ; `reset` passe à true si tout ce qui précède était du raisonnement. */
  shown = '';
  reset = false;
  push(s: string): string {
    this.buf += s;
    let out = '';
    for (;;) {
      if (this.inThink) {
        const i = this.buf.indexOf('</think>');
        if (i < 0) { this.buf = this.buf.slice(-8); break; }
        this.buf = this.buf.slice(i + 8); this.inThink = false; continue;
      }
      const open = this.buf.indexOf('<think>');
      const close = this.buf.indexOf('</think>');
      if (close >= 0 && (open < 0 || close < open)) {
        // « </think> » sans ouverture : tout ce qui précède était du raisonnement.
        this.buf = this.buf.slice(close + 8); out = ''; this.shown = ''; this.reset = true; continue;
      }
      if (open >= 0) { out += this.buf.slice(0, open); this.buf = this.buf.slice(open + 7); this.inThink = true; continue; }
      // Garde la fin si elle peut être le début d'une balise.
      let keep = 0;
      for (let k = Math.min(8, this.buf.length); k > 0; k--) { const tail = this.buf.slice(-k); if ('<think>'.startsWith(tail) || '</think>'.startsWith(tail)) { keep = k; break; } }
      out += this.buf.slice(0, this.buf.length - keep); this.buf = this.buf.slice(this.buf.length - keep);
      break;
    }
    this.shown += out;
    return out;
  }
  flush(): string { const out = this.inThink ? '' : this.buf; this.buf = ''; this.shown += out; return out; }
}
export const stripThink = (s: string) => { const f = new ThinkFilter(); f.push(s); f.flush(); return f.shown.trim(); };

export interface TurnEvents {
  /** Le modèle réfléchit (reasoning_content ou balise <think>). */
  thinking(): void;
  /** Morceau de réponse visible. */
  delta(text: string): void;
  /** Le texte déjà affiché pour ce tour est remplacé (raisonnement sans balise d'ouverture, ou nouvel essai). */
  replace(text: string): void;
}
export interface TurnResult { content: string; toolCalls: ToolCall[]; finish?: string; via: Via }

/** Lit une réponse en streaming SSE (format OpenAI). */
async function readStream(res: Response, ev: TurnEvents): Promise<Omit<TurnResult, 'via'>> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  const filter = new ThinkFilter();
  const calls: { id?: string; name: string; args: string }[] = [];
  let pending = '', finish: string | undefined, lastThink = 0;
  const think = () => { if (Date.now() - lastThink > 1000) { lastThink = Date.now(); ev.thinking(); } };
  const handle = (line: string) => {
    if (!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    let j: any; try { j = JSON.parse(payload); } catch { return; }
    if (j.error) throw new Error(typeof j.error === 'string' ? j.error : j.error.message || 'erreur du serveur IA');
    const ch = j.choices?.[0]; if (!ch) return;
    const d = ch.delta ?? ch.message ?? {};
    if (d.reasoning_content || d.reasoning) think();
    if (typeof d.content === 'string' && d.content) {
      const wasThinking = (filter as any).inThink;
      const vis = filter.push(d.content);
      if (filter.reset) { filter.reset = false; ev.replace(filter.shown); }
      else if (vis) ev.delta(vis);
      if (wasThinking || (filter as any).inThink) think();
    }
    for (const tc of d.tool_calls ?? []) {
      const i = tc.index ?? calls.length;
      calls[i] ??= { name: '', args: '' };
      if (tc.id) calls[i].id = tc.id;
      if (tc.function?.name) calls[i].name += tc.function.name;
      if (tc.function?.arguments) calls[i].args += tc.function.arguments;
    }
    if (ch.finish_reason) finish = ch.finish_reason;
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += dec.decode(value, { stream: true });
    let nl;
    while ((nl = pending.indexOf('\n')) >= 0) { handle(pending.slice(0, nl).trim()); pending = pending.slice(nl + 1); }
  }
  if (pending.trim()) handle(pending.trim());
  const tail = filter.flush(); if (tail) ev.delta(tail);
  const toolCalls = calls.filter((c) => c && c.name).map((c, i) => ({ id: c.id || `call_${i}_${Date.now()}`, type: 'function' as const, function: { name: c.name, arguments: c.args || '{}' } }));
  return { content: filter.shown.trim(), toolCalls, finish };
}

/**
 * Un tour du modèle en streaming. En cas d'échec (réseau, 401, 5xx), bascule sur l'autre adresse et réessaie une fois.
 */
export async function chatTurn(cfg: AiConfig, body: Record<string, unknown>, ev: TurnEvents, signal?: AbortSignal): Promise<TurnResult> {
  let ep = await pick(cfg);
  for (let attempt = 0; ; attempt++) {
    let shown = false;
    const wrap: TurnEvents = { thinking: ev.thinking, delta: (t) => { shown = true; ev.delta(t); }, replace: (t) => { shown = true; ev.replace(t); } };
    try {
      const res = await fetchT(`${ep.base}/chat/completions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...ep.headers },
        body: JSON.stringify({ model: cfg.model, stream: true, ...body }),
      }, 180_000, signal);
      if (!res.ok || !res.body) {
        const txt = (await res.text().catch(() => '')).slice(0, 300);
        throw new HttpError(res.status, res.status === 401 ? 'clé API refusée (401)' : `réponse ${res.status} ${txt}`);
      }
      const r = await readStream(res, wrap);
      return { ...r, via: ep.via };
    } catch (e: any) {
      if (signal?.aborted) throw e;
      logError(cfg, `requête ${ep.via} (essai ${attempt + 1})`, e);
      // Requête refusée pour une autre raison (ex. 400 : demande mal formée) : basculer ne servirait à rien.
      if (e instanceof HttpError && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 404 && e.status !== 408 && e.status !== 429) throw e;
      const next = attempt === 0 ? other(cfg, ep.via) : null;
      if (!next) { chosen = null; throw new UnavailableError(e?.message ?? String(e)); }
      if (shown) ev.replace('');
      ep = next;
    }
  }
}
export class HttpError extends Error { constructor(public status: number, m: string) { super(m); this.name = 'HttpError'; } }
