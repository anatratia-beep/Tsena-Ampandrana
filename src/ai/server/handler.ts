// Fonction cloud « ai-chat » : la seule porte entre les appareils et le serveur IA.
// Les appareils n'appellent jamais le serveur IA ni la base directement pour l'assistant : ils appellent cette
// fonction avec le jeton de connexion cloud de la société. Elle choisit l'adresse IA (locale / en ligne), garde la clé
// API côté serveur, exécute les outils en lecture seule avec les droits de l'utilisateur, et renvoie la réponse en
// streaming (sans le raisonnement du modèle).
import './tz';
import { get } from '../../lib/db';
import type { User } from '../../lib/auth';
import { refresh, type Sql } from './data';
import { DEFAULTS, ERR_MESSAGES, chatTurn, classify, forgetChoice, logError, testConnection, type AiConfig, type Msg } from './llm';
import { ctxFor, isAdmin, runTool, toolsFor, TOOL_LABELS } from './tools';
import { systemPrompt } from './prompt';

export interface Deps {
  sql: Sql;
  supabaseUrl: string;
  anonKey: string;
  /** Clé API donnée en secret Supabase (AI_API_KEY), utilisée si aucune clé n'est enregistrée dans les réglages. */
  envKey?: string;
  /** Vérifie le jeton de l'appareil (par défaut : auth/v1/user de Supabase). Renvoie vrai s'il est valide. */
  verifyToken?: (token: string) => Promise<boolean>;
  /** Durée maximale d'une conversation (tests). */
  deadlineMs?: number;
}

/** Réglages IA partagés (fiche settings/ai, synchronisée comme les autres réglages ; sans la clé). */
export interface AiSettings { id: 'ai'; enabled?: boolean; localUrl?: string; onlineUrl?: string; model?: string }

/** Contexte du modèle (serveur IA : 65 536 tokens, 8 requêtes simultanées). */
export const CONTEXT_TOKENS = 65536;
/** Longueur maximale d'une réponse du modèle (raisonnement compris) : courte, pour rester sous la limite de 150 s. */
export const OUTPUT_TOKENS = 2000;
/** Durée maximale d'une conversation dans la fonction : Supabase coupe à 150 s (offre gratuite), on s'arrête avant. */
const DEADLINE_MS = 140_000;
const TOO_HEAVY = 'La question était trop lourde, essayez de la reformuler plus simplement.';
const MAX_TOOL_ROUNDS = 6;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

/** Estimation prudente du nombre de tokens (≈ 3 caractères par token pour du français + JSON). */
export const tokens = (s: string) => Math.ceil(s.length / 3);

/** Garde le prompt système + les derniers messages qui tiennent dans le contexte ; les plus anciens sont retirés. */
export function fitHistory(system: string, toolsJson: string, history: { role: 'user' | 'assistant'; content: string }[]): Msg[] {
  const budget = CONTEXT_TOKENS - OUTPUT_TOKENS - tokens(system) - tokens(toolsJson) - 200;
  const out: Msg[] = [];
  let used = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    let content = history[i].content;
    let t = tokens(content) + 8;
    if (used + t > budget) {
      if (out.length) break;
      content = '… ' + content.slice(-(budget - 50) * 3); t = tokens(content) + 8; // dernier message trop long : on garde la fin
    }
    out.unshift({ role: history[i].role, content } as Msg);
    used += t;
  }
  while (out.length && out[0].role !== 'user') out.shift(); // la conversation commence par une question
  return [{ role: 'system', content: system }, ...out];
}
/** Pendant la boucle d'outils : si on dépasse, on raccourcit les plus anciens résultats d'outils. */
function shrink(msgs: Msg[], toolsJson: string) {
  const size = () => msgs.reduce((t, m) => t + tokens(typeof m.content === 'string' ? m.content : '') + 8 + ('tool_calls' in m && m.tool_calls ? tokens(JSON.stringify(m.tool_calls)) : 0), 0) + tokens(toolsJson);
  for (const m of msgs) {
    if (size() <= CONTEXT_TOKENS - OUTPUT_TOKENS) return;
    if (m.role === 'tool' && m.content.length > 800) m.content = m.content.slice(0, 800) + '… [tronqué]';
  }
}

export function createHandler(deps: Deps) {
  const tokenCache = new Map<string, number>();
  const verify = deps.verifyToken ?? (async (token: string) => {
    const res = await fetch(`${deps.supabaseUrl}/auth/v1/user`, { headers: { apikey: deps.anonKey, Authorization: `Bearer ${token}` } });
    if (!res.ok) return false;
    const u = await res.json().catch(() => null);
    return !!u?.id && u.role !== 'anon';
  });
  let secret: { value?: string; at: number } = { at: 0 };
  async function apiKey(): Promise<string | undefined> {
    if (Date.now() - secret.at < 30_000) return secret.value;
    const rows = await deps.sql`select value from ai.secrets where id = 'api_key'`;
    secret = { value: rows[0]?.value || undefined, at: Date.now() };
    return secret.value;
  }
  async function config(over?: Partial<AiConfig>): Promise<{ cfg: AiConfig; enabled: boolean }> {
    const s = (get('settings', 'ai') as AiSettings | undefined) ?? ({} as AiSettings);
    const cfg: AiConfig = {
      localUrl: (over?.localUrl ?? s.localUrl ?? DEFAULTS.localUrl).trim(),
      onlineUrl: (over?.onlineUrl ?? s.onlineUrl ?? DEFAULTS.onlineUrl).trim(),
      model: (over?.model || s.model || DEFAULTS.model).trim(),
      apiKey: over?.apiKey || (await apiKey()) || deps.envKey || undefined,
    };
    return { cfg, enabled: !!s.enabled };
  }

  return async function handle(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json(405, { error: 'POST attendu' });
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    try {
      const known = tokenCache.get(token);
      if (!token || !(known && known > Date.now())) {
        if (!token || !(await verify(token))) return json(401, { error: 'Appareil non relié au cloud (connexion expirée).' });
        tokenCache.set(token, Date.now() + 5 * 60_000);
        if (tokenCache.size > 500) tokenCache.clear();
      }
      const body = await req.json().catch(() => ({}));
      await refresh(deps.sql);
      const user = get<User>('users', String(body.userId || ''));
      if (!user || !user.active || user.removed) return json(403, { error: 'Utilisateur inconnu ou désactivé.' });
      const admin = isAdmin(user);

      switch (body.action) {
        case 'status': {
          const { cfg, enabled } = await config();
          const saved = !!(await apiKey());
          return json(200, { enabled, model: cfg.model, localUrl: cfg.localUrl, onlineUrl: cfg.onlineUrl, hasKey: !!cfg.apiKey, keySource: saved ? 'reglages' : deps.envKey ? 'secret' : undefined, admin });
        }
        case 'test': {
          if (!admin) return json(403, { error: 'Réservé aux administrateurs.' });
          const { cfg } = await config({ localUrl: body.localUrl, onlineUrl: body.onlineUrl, model: body.model, apiKey: body.apiKey || undefined });
          const r = await testConnection(cfg);
          if (!r.ok) logError(cfg, 'test de connexion', new Error(`local: ${r.local} ; en ligne: ${r.online}`));
          return json(200, r);
        }
        case 'set_key': {
          if (!admin) return json(403, { error: 'Réservé aux administrateurs.' });
          const k = String(body.apiKey ?? '').trim();
          if (k) await deps.sql`insert into ai.secrets (id, value, updated_at, updated_by) values ('api_key', ${k}, now(), ${user.fullName}) on conflict (id) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by`;
          else await deps.sql`delete from ai.secrets where id = 'api_key'`;
          secret = { at: 0 }; forgetChoice();
          return json(200, { ok: true, hasKey: !!k });
        }
        case 'chat': return chat(req, body, user);
        default: return json(400, { error: 'action inconnue' });
      }
    } catch (e) {
      logError(undefined, 'requête', e);
      return json(500, { error: 'Erreur interne de l’assistant.' });
    }
  };

  async function chat(req: Request, body: any, user: User): Promise<Response> {
    const { cfg, enabled } = await config();
    if (!enabled) return json(403, { error: "L'assistant IA est désactivé dans les réglages." });
    const history = (Array.isArray(body.messages) ? body.messages : [])
      .filter((m: any) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .slice(-40).map((m: any) => ({ role: m.role, content: m.content.slice(0, 12_000) }));
    if (!history.length || history[history.length - 1].role !== 'user') return json(400, { error: 'question manquante' });

    const ctx = ctxFor(user, deps.sql);
    const tools = toolsFor(ctx);
    const toolsJson = JSON.stringify(tools);
    const msgs = fitHistory(systemPrompt(ctx, tools.map((t) => t.function.name)), toolsJson, history);
    const enc = new TextEncoder();
    const abort = new AbortController();
    req.signal?.addEventListener('abort', () => abort.abort());
    // Limite de 150 s de Supabase : on arrête proprement avant, avec un message clair.
    let tooLong = false;
    const deadline = setTimeout(() => { tooLong = true; abort.abort(new Error('limite de durée')); }, deps.deadlineMs ?? DEADLINE_MS);

    const stream = new ReadableStream({
      async start(ctl) {
        let open = true;
        const send = (ev: Record<string, unknown>) => { if (!open) return; try { ctl.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`)); } catch { open = false; } };
        const ping = setInterval(() => { if (open) try { ctl.enqueue(enc.encode(': ping\n\n')); } catch { open = false; } }, 10_000);
        let via = '';
        try {
          for (let round = 0; ; round++) {
            const useTools = round < MAX_TOOL_ROUNDS && tools.length > 0;
            const res = await chatTurn(cfg, {
              messages: msgs, temperature: 0.3, max_tokens: OUTPUT_TOKENS,
              ...(useTools ? { tools, tool_choice: 'auto' } : {}),
            }, {
              thinking: () => send({ type: 'thinking' }),
              delta: (text) => send({ type: 'delta', text }),
              replace: (text) => send({ type: 'replace', text }),
            }, abort.signal);
            if (res.via !== via) { via = res.via; send({ type: 'meta', via }); }
            if (useTools && res.toolCalls.length) {
              if (res.content) send({ type: 'replace', text: '' });
              msgs.push({ role: 'assistant', content: res.content || '', tool_calls: res.toolCalls });
              for (const tc of res.toolCalls) {
                send({ type: 'tool', name: tc.function.name, label: TOOL_LABELS[tc.function.name] ?? 'Recherche dans les données' });
                msgs.push({ role: 'tool', tool_call_id: tc.id, content: await runTool(ctx, tc.function.name, tc.function.arguments) });
              }
              shrink(msgs, toolsJson);
              continue;
            }
            if (res.finish === 'length') {
              // Limite de longueur atteinte (souvent pendant le raisonnement) : réponse incomplète.
              if (!res.content) { send({ type: 'error', code: 'toolong', message: TOO_HEAVY }); break; }
              send({ type: 'delta', text: `\n\n*${TOO_HEAVY}*` });
            } else if (!res.content) send({ type: 'replace', text: "Je n'ai pas pu produire de réponse. Reformulez la question." });
            break;
          }
          send({ type: 'done' });
        } catch (e: any) {
          if (tooLong) {
            logError(cfg, 'conversation trop longue (limite 150 s)', e);
            send({ type: 'error', code: 'toolong', message: TOO_HEAVY });
          } else if (!abort.signal.aborted) {
            logError(cfg, 'conversation', e);
            const code = classify(e);
            send({ type: 'error', code, message: ERR_MESSAGES[code] });
          }
        } finally {
          clearTimeout(deadline);
          clearInterval(ping);
          if (open) { try { ctl.close(); } catch { /* déjà fermé */ } }
          open = false;
        }
      },
      cancel() { abort.abort(); },
    });
    return new Response(stream, { headers: { ...CORS, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' } });
  }
}
