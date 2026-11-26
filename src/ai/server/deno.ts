// Point d'entrée de la fonction cloud Supabase « ai-chat » (Deno). Construit par « npm run ai:build » dans
// supabase/functions/ai-chat/index.ts. Variables fournies automatiquement par Supabase : SUPABASE_URL,
// SUPABASE_ANON_KEY, SUPABASE_DB_URL. Clé du serveur IA : secret Supabase AI_API_KEY, ou celle enregistrée dans
// Paramètres → Intelligence artificielle (table ai.secrets, prioritaire). Jamais écrite dans le code.
import './tz';
// @ts-ignore — résolu par Deno au déploiement
import postgres from 'npm:postgres@3.4.5';
import { createHandler } from './handler';

declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): unknown };
const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 3, idle_timeout: 20 });
Deno.serve(createHandler({ sql, supabaseUrl: Deno.env.get('SUPABASE_URL')!, anonKey: Deno.env.get('SUPABASE_ANON_KEY')!, envKey: Deno.env.get('AI_API_KEY') || undefined }));
