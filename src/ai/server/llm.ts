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
  if (!res.ok) throw new HttpError(res.status, describe(res.status));
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
  if (!online) throw new UnavailableError(cfg.apiKey ? 'adresse en ligne manquante' : 'adresse locale injoignable et aucune clé API pour l’adresse en ligne', cfg.apiKey ? 'unavailable' : 'auth');
  chosen = { via: 'online', at: Date.now(), sig };
  return online;
}
function other(cfg: AiConfig, via: Via) {
  const ep = endpoint(cfg, via === 'local' ? 'online' : 'local');
  if (ep) chosen = { via: ep.via, at: Date.now(), sig: sigOf(cfg) };
  return ep;
}

// ---------- Erreurs du serveur IA (proxy devant LM Studio) ----------
/** Code d'erreur montré à l'utilisateur dans la bulle. */
export type ErrCode = 'auth' | 'path' | 'down' | 'busy' | 'timeout' | 'unavailable';
export const ERR_MESSAGES: Record<ErrCode, string> = {
  auth: "La clé API du serveur IA est invalide ou absente (erreur 401). Un administrateur doit la vérifier (Paramètres → Intelligence artificielle, ou secret Supabase AI_API_KEY).",
  path: "L'adresse du serveur IA est incorrecte (erreur 404) : l'URL en ligne doit se terminer par /v1.",
  down: "Le serveur IA est injoignable (erreur 502) : le PC qui fait tourner LM Studio est peut-être éteint ou LM Studio arrêté.",
  busy: "L'assistant est occupé, réessayez dans un instant.",
  timeout: "Le serveur IA met trop de temps à répondre (plus de 180 s). Réessayez avec une question plus simple.",
  unavailable: "L'assistant IA est momentanément indisponible. Réessayez dans quelques minutes.",
};
export function describe(status: number): string {
  if (status === 401 || status === 403) return `clé API invalide ou absente (${status})`;
  if (status === 404) return 'chemin introuvable (404) : l’URL doit se terminer par /v1';
  if (status === 502 || status === 504) return `serveur IA injoignable, PC de LM Studio éteint ? (${status})`;
  if (status === 429 || status === 503) return `serveur IA occupé (${status})`;
  return `réponse ${status}`;
}
export function classify(e: unknown): ErrCode {
  if (e instanceof AiServerError) return e.code;
  if (e instanceof HttpError) {
    if (e.status === 401 || e.status === 403) return 'auth';
    if (e.status === 404) return 'path';
    if (e.status === 502 || e.status === 504) return 'down';
    if (e.status === 429 || e.status === 503) return 'busy';
  }
  if (e instanceof TimeoutError) return 'timeout';
  return 'unavailable';
}
export class TimeoutError extends Error { constructor(m = 'délai dépassé (180 s sans réponse)') { super(m); this.name = 'TimeoutError'; } }
export class AiServerError extends Error { constructor(public code: ErrCode, detail: string) { super(detail); this.name = 'AiServerError'; } }
/** Ancien nom gardé : serveur IA indisponible. */
export class UnavailableError extends AiServerError { constructor(m: string, code: ErrCode = 'unavailable') { super(code, m); this.name = 'UnavailableError'; } }

/** Test complet pour l'écran Réglages : quelle adresse répond, en combien de temps, et le modèle est-il là ? */
export async function testConnection(cfg: AiConfig) {
  const out: { ok: boolean; via?: Via; ms?: number; modelFound?: boolean; models?: string[]; local?: string; online?: string; onlineStatus?: number } = { ok: false };
  const local = endpoint(cfg, 'local');
  if (local) {
    try { const r = await probe(local); Object.assign(out, { ok: true, via: 'local', ms: r.ms, models: r.models, modelFound: r.models.includes(cfg.model) }); chosen = { via: 'local', at: Date.now(), sig: sigOf(cfg) }; return out; }
    catch (e: any) { out.local = e?.message ?? String(e); }
  } else out.local = 'adresse non renseignée';
  if (!cfg.onlineUrl) { out.online = 'adresse non renseignée'; return out; }
  // En ligne : avec la clé si elle existe, sinon sans (un 401 prouve alors que le serveur est joignable).
  const online: Endpoint = endpoint(cfg, 'online') ?? { via: 'online', base: cfg.onlineUrl.trim().replace(/\/+$/, ''), headers: {} };
  try { const r = await probe(online, 10_000); Object.assign(out, { ok: true, via: 'online', ms: r.ms, models: r.models, modelFound: r.models.includes(cfg.model), onlineStatus: 200 }); chosen = { via: 'online', at: Date.now(), sig: sigOf(cfg) }; }
  catch (e: any) {
    out.onlineStatus = e instanceof HttpError ? e.status : 0;
    out.online = e instanceof HttpError
      ? (e.status === 401 || e.status === 403 ? (cfg.apiKey ? `serveur joignable, mais clé API invalide (${e.status})` : `serveur joignable, mais aucune clé API enregistrée (${e.status})`)
        : e.status === 502 || e.status === 504 ? `serveur IA injoignable : PC éteint ou LM Studio arrêté ? (${e.status})` : describe(e.status))
      : `adresse injoignable : ${e?.message ?? e}`;
  }
  if (out.online && cfg.apiKey) out.online = out.online.split(cfg.apiKey).join('••••');
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
async function readStream(res: Response, ev: TurnEvents, onChunk: () => void = () => {}): Promise<Omit<TurnResult, 'via'>> {
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
      // index absent : suite du dernier appel (sauf s'il porte un nouvel id)
      const i = tc.index ?? (calls.length && !tc.id ? calls.length - 1 : calls.length);
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
    onChunk();
    pending += dec.decode(value, { stream: true });
    let nl;
    while ((nl = pending.indexOf('\n')) >= 0) { handle(pending.slice(0, nl).trim()); pending = pending.slice(nl + 1); }
  }
  if (pending.trim()) handle(pending.trim());
  const tail = filter.flush(); if (tail) ev.delta(tail);
  const toolCalls = calls.filter((c) => c && c.name).map((c, i) => ({ id: c.id || `call_${i}_${Date.now()}`, type: 'function' as const, function: { name: c.name, arguments: c.args || '{}' } }));
  return { content: filter.shown.trim(), toolCalls, finish };
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((ok, ko) => {
  const t = setTimeout(ok, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); ko(signal.reason ?? new Error('arrêté')); }, { once: true });
});
const REQUEST_MS = 180_000;
const BUSY_WAIT_MS = 3_000;

/**
 * Un tour du modèle en streaming (de bout en bout jusqu'au navigateur : le modèle peut réfléchir 10 à 60 s).
 * - 180 s au plus sans rien recevoir (en-têtes puis chaque morceau) ;
 * - serveur occupé (429 / 503) : nouvel essai une fois après 3 s, puis « occupé » ;
 * - autre échec (réseau, 401, 404, 502…) : bascule une fois sur l'autre adresse ;
 * - erreur finale avec un code (auth, path, down, busy, timeout, unavailable) pour un message clair.
 */
export async function chatTurn(cfg: AiConfig, body: Record<string, unknown>, ev: TurnEvents, signal?: AbortSignal): Promise<TurnResult> {
  let ep = await pick(cfg);
  const errors: unknown[] = [];
  let busyRetried = false, switched = false;
  for (;;) {
    let shown = false;
    const wrap: TurnEvents = { thinking: ev.thinking, delta: (t) => { shown = true; ev.delta(t); }, replace: (t) => { shown = true; ev.replace(t); } };
    const c = new AbortController();
    const onOuter = () => c.abort(signal?.reason);
    signal?.addEventListener('abort', onOuter);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => { timedOut = true; c.abort(new TimeoutError()); }, REQUEST_MS); };
    try {
      arm();
      const res = await fetch(`${ep.base}/chat/completions`, {
        method: 'POST', signal: c.signal, headers: { 'Content-Type': 'application/json', ...ep.headers },
        body: JSON.stringify({ model: cfg.model, stream: true, ...body }),
      });
      if (!res.ok || !res.body) {
        const txt = (await res.text().catch(() => '')).slice(0, 200);
        throw new HttpError(res.status, `${describe(res.status)} ${txt}`.trim());
      }
      const r = await readStream(res, wrap, arm);
      return { ...r, via: ep.via };
    } catch (e0: any) {
      if (signal?.aborted) throw e0;
      const e = timedOut ? new TimeoutError() : e0;
      errors.push(e);
      logError(cfg, `requête ${ep.via}`, e);
      const code = classify(e);
      if (code === 'busy') {
        if (busyRetried) throw new AiServerError('busy', e.message);
        busyRetried = true;
        if (shown) ev.replace('');
        await sleep(BUSY_WAIT_MS, signal);
        continue;
      }
      // Demande refusée pour une autre raison (ex. 400 : demande mal formée) : basculer ne servirait à rien.
      if (e instanceof HttpError && e.status >= 400 && e.status < 500 && ![401, 403, 404, 408].includes(e.status)) throw new AiServerError('unavailable', e.message);
      const next = switched ? null : other(cfg, ep.via);
      if (!next) {
        chosen = null;
        // Erreur la plus parlante parmi les essais (ex. 401 de l'adresse en ligne plutôt que « local injoignable »).
        const codes = errors.map(classify);
        throw new AiServerError(codes.find((x) => x !== 'unavailable') ?? 'unavailable', e?.message ?? String(e));
      }
      switched = true;
      if (shown) ev.replace('');
      ep = next;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onOuter);
    }
  }
}
export class HttpError extends Error { constructor(public status: number, m: string) { super(m); this.name = 'HttpError'; } }
