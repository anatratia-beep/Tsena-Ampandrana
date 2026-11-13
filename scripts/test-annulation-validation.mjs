// Annulation à valider : un vendeur ne peut plus annuler seul une commande en livraison ou déjà payée ; il envoie une
// demande. Le responsable (Anja) la voit dans la notice, valide → commande annulée. Une commande pas partie et non payée
// s'annule toujours directement. Une commande annulée avec de l'argent payé apparaît dans « à vérifier ».
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Indian/Antananarivo', deviceScaleFactor: Number(process.env.DPR || 1) })).newPage();
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
p.on('pageerror', (e) => { console.log('ERR', e.message); fail++; });
const login = async (u) => {
  await p.getByLabel("Nom d'utilisateur").fill(u); await p.locator('input[type=password]').fill('anosy'); await p.keyboard.press('Enter'); await p.waitForTimeout(600);
  const later = p.getByRole('button', { name: 'Plus tard' }); if (await later.count()) { await later.click(); await p.waitForTimeout(300); }
};
const logout = async () => { await p.goto('http://localhost:5173/#/compte'); await p.waitForTimeout(400); await p.locator('main').getByRole('button', { name: 'Se déconnecter' }).click(); await p.waitForTimeout(400); };
const st = (id) => p.evaluate((id) => { const o = window.__tsena.get('orders', id); return `${o.status}${o.cancelRequest ? ' req' : ''}`; }, id);
await p.goto('http://localhost:5173/'); await p.waitForTimeout(600);
await login('super-adm');
await p.evaluate(async () => {
  const t = window.__tsena; const at = new Date().toISOString(); const h = t.get('users', 'user-superadmin').passwordHash;
  await t.save('categories', [{ id: 'nv', name: 'NetVision' }]);
  await t.save('users', [
    { id: 'u-anja', username: 'anja', fullName: 'Anja', roleId: 'role-manager', active: true, passwordHash: h, mustChangePassword: false, pageIds: ['nv'] },
    { id: 'u-mbola', username: 'mbola', fullName: 'Mbola', roleId: 'role-seller', active: true, passwordHash: h, mustChangePassword: false, pageIds: ['nv'] }]);
  await t.save('products', [{ id: 'a', code: 'A', name: 'Caméra', categoryId: 'nv', priceRetail: 50000, active: true }]);
  await t.save('variants', [{ id: 'va', productId: 'a', sku: 'A', costAvg: 20000, active: true }]);
  const base = { kind: 'order', channel: 'facebook', phone: '0331234567', lines: [{ id: 'l1', variantId: 'va', qty: 1, unitPrice: 50000 }], discount: 0, deliveryFee: 0, createdBy: 'u-mbola', createdByName: 'Mbola', createdAt: at };
  await t.save('orders', [
    { ...base, id: 'P1', number: 'C-L0201', name: 'Payée', status: 'confirmed', payments: [{ id: 'p1', at, amount: 50000, method: 'mvola', receivedBy: 'shop' }] },
    { ...base, id: 'P2', number: 'C-L0202', name: 'Simple', status: 'confirmed', payments: [] },
    { ...base, id: 'P3', number: 'C-L0120', name: 'Nā Taël', status: 'cancelled', cancelledByName: 'Patrick', payments: [{ id: 'p3', at, amount: 58000, method: 'mvola', receivedBy: 'shop' }] },
  ]);
});
await logout(); await login('mbola');
// Payée : demande
await p.goto('http://localhost:5173/#/commandes/P1'); await p.waitForTimeout(700);
ok(await p.getByRole('button', { name: 'Demander l’annulation' }).count() === 1, 'vendeur : bouton « Demander l’annulation » sur commande payée');
await p.getByRole('button', { name: 'Demander l’annulation' }).click(); await p.waitForTimeout(300);
if (process.env.SHOT) await p.getByRole('dialog').screenshot({ path: process.env.SHOT });
await p.getByRole('dialog').getByRole('button', { name: 'Envoyer la demande' }).click(); await p.waitForTimeout(700);
ok(await st('P1') === 'confirmed req', `vendeur : demande envoyée, commande pas annulée (${await st('P1')})`);
ok(await p.getByRole('button', { name: 'Valider l’annulation' }).count() === 0, 'vendeur : ne peut pas valider');
// Simple : directe
await p.goto('http://localhost:5173/#/commandes/P2'); await p.waitForTimeout(700);
await p.getByRole('button', { name: 'Annuler / supprimer' }).click(); await p.waitForTimeout(300);
await p.getByRole('dialog').getByRole('button', { name: 'Annuler la commande' }).click(); await p.waitForTimeout(700);
ok(await st('P2') === 'cancelled', `vendeur : commande non payée annulée directement (${await st('P2')})`);
// Responsable
await logout(); await login('anja');
await p.goto('http://localhost:5173/#/commandes'); await p.waitForTimeout(800);
const n1 = p.locator('.rectif-notice', { hasText: 'annulation(s) à valider' });
ok(await n1.count() === 1 && /C-L0201/.test(await n1.innerText()), 'responsable : notice annulation à valider');
const n2 = p.locator('.rectif-notice', { hasText: 'argent déjà payé' });
ok(await n2.count() === 1 && /C-L0120/.test(await n2.innerText()) && /Patrick/.test(await n2.innerText()), 'responsable : notice annulée avec paiement (C-L0120, Patrick)');
if (process.env.SHOT2) await p.locator('main').screenshot({ path: process.env.SHOT2, clip: undefined });
await n1.getByRole('link', { name: /C-L0201/ }).click(); await p.waitForTimeout(700);
if (process.env.SHOT3) await p.locator('.notice.cancel-req').screenshot({ path: process.env.SHOT3 });
await p.getByRole('button', { name: 'Valider l’annulation' }).click(); await p.waitForTimeout(800);
ok(await st('P1') === 'cancelled', `responsable : annulation validée (${await st('P1')})`);
await p.goto('http://localhost:5173/#/commandes/P3'); await p.waitForTimeout(700);
if (process.env.SHOT4) await p.locator('.notice', { hasText: 'déjà payé' }).first().screenshot({ path: process.env.SHOT4 });
await p.getByRole('button', { name: 'Vérifié' }).click(); await p.waitForTimeout(600);
await p.goto('http://localhost:5173/#/commandes'); await p.waitForTimeout(700);
// P1 vient d'être annulée avec paiement : elle apparaît à son tour ; C-L0120 n'y est plus.
const t2 = await p.locator('.rectif-notice', { hasText: 'argent déjà payé' }).innerText().catch(() => '');
ok(!/C-L0120/.test(t2), 'C-L0120 vérifiée : sort de la liste');
console.log(fail ? `${fail} échec(s)` : 'Tout est bon'); await b.close(); process.exit(fail ? 1 : 0);
