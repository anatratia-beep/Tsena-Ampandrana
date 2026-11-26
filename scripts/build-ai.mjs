// Construit la fonction cloud de l'assistant IA : supabase/functions/ai-chat/index.ts (un seul fichier).
//   npm run ai:build                 → construit
//   npm run ai:deploy -- <project-ref> → construit puis met en ligne avec la CLI Supabase (npx supabase login avant)
// La fonction réutilise les calculs de l'application (src/lib) : la reconstruire après une évolution du logiciel.
import * as esbuild from 'esbuild';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const outDir = join(root, 'supabase/functions/ai-chat');
mkdirSync(outDir, { recursive: true });
const common = {
  bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', mainFields: ['module', 'main'], jsx: 'automatic',
  loader: { '.md': 'text' }, legalComments: 'none', logLevel: 'warning', nodePaths: [join(root, 'node_modules')],
  define: { __APP_VERSION__: '"ai"', __BUILD_DATE__: JSON.stringify(new Date().toISOString()), 'process.env.NODE_ENV': '"production"' },
};
await esbuild.build({
  ...common, entryPoints: [join(root, 'src/ai/server/deno.ts')], outfile: join(outDir, 'index.ts'), external: ['npm:*'],
  banner: { js: '// @ts-nocheck\n// deno-lint-ignore-file\n// FICHIER GÉNÉRÉ par « npm run ai:build » à partir de src/ai/server : ne pas modifier à la main.' },
});
console.log('Fonction construite : supabase/functions/ai-chat/index.ts');
// Version Node (tests automatiques) : même code, postgres fourni par le test.
if (process.argv.includes('--node')) {
  await esbuild.build({ ...common, entryPoints: [join(root, 'src/ai/server/handler.ts')], outfile: process.argv[process.argv.indexOf('--node') + 1] });
}
const i = process.argv.indexOf('--deploy');
if (i > 0) {
  const ref = process.argv[i + 1];
  if (!ref) { console.error('Indiquez la référence du projet Supabase : npm run ai:deploy -- abcdefghijkl'); process.exit(1); }
  const r = spawnSync('npx', ['--yes', 'supabase', 'functions', 'deploy', 'ai-chat', '--project-ref', ref, '--use-api'], { cwd: root, stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
