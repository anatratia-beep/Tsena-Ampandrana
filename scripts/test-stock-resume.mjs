// Article : « Résumé du stock depuis une date » — stock avant, chaque type de mouvement, stock aujourd'hui.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Indian/Antananarivo', deviceScaleFactor: Number(process.env.DPR || 1) })).newPage();
const N = (t) => t.replace(/[  ]/g, ' ').replace(/\s+/g, ' ');
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await p.getByLabel("Nom d'utilisateur").fill('super-adm'); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter');
await p.getByRole('button', { name: 'Plus tard' }).click(); await p.waitForTimeout(400);
await p.evaluate(async () => {
  const t = window.__tsena; const at = (d, h = 10) => new Date(`${d}T${String(h).padStart(2, '0')}:00:00+03:00`).toISOString();
  await t.save('categories', [{ id: 'kp', name: 'Kapakapa' }]);
  await t.save('products', [{ id: 'k30', code: 'K30', name: 'Kapakapa K30', categoryId: 'kp', priceRetail: 15000, active: true }]);
  await t.save('variants', [{ id: 'vk', productId: 'k30', sku: 'K30', active: true }]);
  await t.save('stockMoves', [
    { id: 'm0', variantId: 'vk', qty: 10, type: 'initial', at: at('2026-09-01') },
    { id: 'm1', variantId: 'vk', qty: 85, type: 'inventory', at: at('2026-09-19'), reason: 'Comptage' },
    { id: 'm2', variantId: 'vk', qty: -25, type: 'sale', at: at('2026-10-02'), reason: 'C-1' },
    { id: 'm3', variantId: 'vk', qty: -15, type: 'dispatch', at: at('2026-10-05'), reason: 'C-L0001' },
    { id: 'm4', variantId: 'vk', qty: 12, type: 'delivery_return', at: at('2026-10-06'), reason: 'C-L0001 — refusé par le client' },
    { id: 'm5', variantId: 'vk', qty: 8, type: 'return', at: at('2026-10-09'), reason: 'C-2' },
  ]);
});
await p.goto('http://localhost:5173/#/articles/k30'); await p.waitForTimeout(800);
const card = p.locator('.card', { hasText: 'Résumé du stock depuis une date' });
await card.getByLabel('Depuis le').fill('2026-09-19'); await p.waitForTimeout(300);
let tx = N(await card.innerText());
ok(/Stock avant le 19\/09\/2026 10/.test(tx), `stock avant le 19/09 : 10 (${tx})`);
ok(/Vente \(1\) — −25 −25/.test(tx) && /Sortie livraison \(1\) — −15 −15/.test(tx), 'ventes −25, sorties livraison −15');
ok(/Retour de livraison \(1\) \+12 — \+12/.test(tx) && /Retour client \(1\) \+8 — \+8/.test(tx), 'retours de livraison +12, retours client +8');
ok(/Stock aujourd’hui 75/.test(tx), 'stock aujourd’hui 75');
await card.getByText('Retour de livraison').click(); await p.waitForTimeout(200);
ok(/C-L0001 — refusé par le client/.test(N(await card.innerText())), 'détail au clic');
if (process.env.SHOT) await card.screenshot({ path: process.env.SHOT });
await b.close();
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); process.exit(fail ? 1 : 0);
