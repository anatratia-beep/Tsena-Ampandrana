// Point d'entrée : ouvre la base locale, prépare les comptes, lance la synchro, affiche l'application.
import './polyfills';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { DB_VERSION, getMeta, newId, openDb, setMeta } from './lib/db';
import { seedAccounts } from './lib/auth';
import { seedZones } from './lib/orders';
import { seedFinance } from './lib/money';
import { repairAfterReset } from './lib/backup';
import { consumeEmailLink } from './lib/maintenance';
import { startSync } from './lib/sync';
import { App } from './App';

declare global {
  const __APP_VERSION__: string;
  const __BUILD_DATE__: string;
}

const root = createRoot(document.getElementById('root')!);

function guessDeviceName() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Téléphone Android' : 'Tablette Android';
  if (/Windows/.test(ua)) return 'Ordinateur Windows';
  if (/Mac/.test(ua)) return 'Mac';
  return 'Appareil';
}

async function boot() {
  try {
    await openDb();
    await setMeta('dashPeriod', null); // le tableau de bord rouvre toujours sur « Aujourd'hui »
    // Nouvelle version avec de nouvelles tables (ex. clients à suivre) : une ancienne version a pu recevoir
    // ces données sans savoir les garder. On reprend donc la synchronisation depuis le début, une fois.
    if (getMeta<number>('schemaVersion', 0) < DB_VERSION) { await setMeta('lastRev', 0); await setMeta('schemaVersion', DB_VERSION); }
    await consumeEmailLink(); // retour depuis le lien « mot de passe oublié » reçu par e-mail
    window.addEventListener('hashchange', () => { if (/access_token=|error_description=/.test(location.hash)) consumeEmailLink(); });
    if (!getMeta('deviceId')) {
      await setMeta('deviceId', newId());
      await setMeta('deviceName', guessDeviceName());
    }
    await seedAccounts();
    await seedZones();
    await seedFinance();
    await repairAfterReset().catch(() => {});
    startSync();
    // Outils de test automatisé (uniquement en local sur l'ordinateur du développeur).
    if (location.hostname === 'localhost') {
      const db = await import('./lib/db'); const sync = await import('./lib/sync'); const cat = await import('./lib/catalog'); const ord = await import('./lib/orders');
      (window as any).__tsena = { save: db.save, get: db.get, getRaw: db.getRaw, all: db.all, syncNow: sync.syncNow, outboxCount: db.outboxCount, nextNumber: cat.nextNumber, customerIdFor: ord.customerIdFor, getMeta: db.getMeta, setMeta: db.setMeta, syncStatus: sync.syncStatus, optimizePhotos: (await import('./lib/maintenance')).optimizePhotos, cloudBackup: (await import('./lib/backup')).cloudBackup };
    }
    root.render(<App />);
  } catch (e: any) {
    root.render(
      <div className="splash">
        <div className="card stack" style={{ maxWidth: 440, margin: 20 }}>
          <h2>Impossible d'ouvrir les données</h2>
          <p>{e?.message || String(e)}</p>
          <p className="small muted">Si vous êtes en navigation privée, ouvrez Trésor en ligne dans une fenêtre normale.</p>
          <button className="btn btn-primary" onClick={() => location.reload()}>Réessayer</button>
        </div>
      </div>
    );
  }
}
boot();
