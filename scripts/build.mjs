// Construit l'application dans dist/ : bundle JS/CSS, index.html, service worker hors ligne.
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const dist = join(root, 'dist');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const BUILT = new Date().toISOString(); // même date dans l'application et dans version.json : sert à repérer une nouvelle version

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'assets'), { recursive: true });
cpSync(join(root, 'public'), dist, { recursive: true });

const result = await esbuild.build({
  entryPoints: [join(root, 'src/main.tsx')],
  bundle: true,
  minify: true,
  sourcemap: false,
  format: 'esm',
  target: ['es2019', 'chrome64', 'firefox68', 'edge79'], // syntaxe ES2019 : Android 8 (Chrome 64+) et iPhone iOS 12.2+ ; voir src/polyfills.ts
  jsx: 'automatic',
  outdir: join(dist, 'assets'),
  entryNames: 'app',
  assetNames: '[name]-[hash]',
  metafile: true,
  define: {
    'process.env.NODE_ENV': '"production"',
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(BUILT),
  },
  logLevel: 'warning',
});

// Noms de fichiers fixes (app.js, app.css) + ?v=empreinte : une ancienne page garde en mémoire
// trouve toujours les fichiers (jamais d'erreur 404 après une mise à jour).
const outputs = Object.keys(result.metafile.outputs).map((p) => relative(dist, join(root, p)));
const js = outputs.find((p) => p.endsWith('.js'));
const css = outputs.find((p) => p.endsWith('.css'));
const stamp = (f) => createHash('sha256').update(readFileSync(join(dist, f))).digest('hex').slice(0, 10);

let html = readFileSync(join(root, 'src/index.html'), 'utf8');
html = html
  .replace('<!--CSS-->', css ? `<link rel="stylesheet" href="./${css}?v=${stamp(css)}">` : '')
  .replace('<!--JS-->', `<script type="module" src="./${js}?v=${stamp(js)}"></script>`);
writeFileSync(join(dist, 'index.html'), html);

// Anciens noms encore demandés par des pages gardées en mémoire avant le passage aux noms fixes :
// on y met la version actuelle, qui installe ensuite le nouveau service worker et répare l'appareil.
const LEGACY = { js: ['app-UI4LVUPG.js'], css: ['app-LQEIZ6LC.css'] };
for (const f of LEGACY.js) cpSync(join(dist, js), join(dist, 'assets', f));
if (css) for (const f of LEGACY.css) cpSync(join(dist, css), join(dist, 'assets', f));

// Liste de tout ce qu'il faut garder en cache pour fonctionner sans connexion.
function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const files = walk(dist).map((p) => './' + relative(dist, p)).filter((p) => p !== './sw.js');
const hash = createHash('sha256');
for (const f of files) hash.update(readFileSync(join(dist, f)));
const version = pkg.version + '-' + hash.digest('hex').slice(0, 10);

let sw = readFileSync(join(root, 'src/sw.js'), 'utf8');
sw = sw.replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(['./', ...files]));
writeFileSync(join(dist, 'sw.js'), sw);
writeFileSync(join(dist, 'version.json'), JSON.stringify({ version, built: BUILT }));

console.log(`Build ${version} : ${files.length} fichiers`);

if (process.argv.includes('--serve')) {
  const { createServer } = await import('node:http');
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
  createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    try {
      const body = readFileSync(join(dist, p));
      res.writeHead(200, { 'content-type': types[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404); res.end('404');
    }
  }).listen(5173, () => console.log('http://localhost:5173'));
}
