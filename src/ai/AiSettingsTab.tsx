// Paramètres → Intelligence artificielle (administrateurs : droit « Modifier la société »).
// Les adresses, le modèle et l'interrupteur sont des réglages partagés (fiche settings/ai, comme les autres réglages).
// La clé API est envoyée UNE fois à la fonction cloud, qui la garde côté serveur : elle n'est jamais renvoyée.
import { useEffect, useState } from 'react';
import { audit, useCan } from '../lib/auth';
import { save, useMeta } from '../lib/db';
import { Icon } from '../ui/icons';
import { Badge, Button, Help, PasswordField, TextField, Toggle, toast, navigate } from '../ui/kit';
import { AI_DEFAULTS, aiSetKey, aiStatus, aiTest, useAiSettings, type AiTest } from './client';

export function AiSettingsTab() {
  const can = useCan();
  const s = useAiSettings();
  const cloud = useMeta<any>('cloud', null);
  const [form, setForm] = useState({ enabled: !!s.enabled, localUrl: s.localUrl || AI_DEFAULTS.localUrl, onlineUrl: s.onlineUrl || AI_DEFAULTS.onlineUrl, model: s.model || AI_DEFAULTS.model });
  const [key, setKey] = useState('');
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [keySource, setKeySource] = useState<string | undefined>();
  const [statusErr, setStatusErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<AiTest | null>(null);
  const editable = can('settings.company');

  useEffect(() => {
    if (!cloud) return;
    aiStatus().then((r) => { setHasKey(r.hasKey); setKeySource(r.keySource); setStatusErr(''); }).catch((e) => setStatusErr(e.message));
  }, [cloud?.url]);

  const dirty = form.enabled !== !!s.enabled || form.localUrl !== (s.localUrl || AI_DEFAULTS.localUrl) || form.onlineUrl !== (s.onlineUrl || AI_DEFAULTS.onlineUrl) || form.model !== (s.model || AI_DEFAULTS.model) || !!key.trim();
  const urlOk = (u: string) => !u.trim() || /^https?:\/\/\S+$/.test(u.trim());

  async function saveAll() {
    if (!urlOk(form.localUrl) || !urlOk(form.onlineUrl)) { toast('Adresse invalide : elle doit commencer par http:// ou https://', 'error'); return; }
    setBusy(true);
    try {
      if (key.trim()) { const r = await aiSetKey(key.trim()); setHasKey(r.hasKey); setKeySource('reglages'); setKey(''); }
      await save('settings', { id: 'ai', enabled: form.enabled, localUrl: form.localUrl.trim(), onlineUrl: form.onlineUrl.trim(), model: form.model.trim() || AI_DEFAULTS.model }, { force: true });
      await audit('Paramètres IA', `Assistant IA ${form.enabled ? 'activé' : 'désactivé'} ; modèle ${form.model}${key.trim() ? ' ; clé API modifiée' : ''}`);
      toast('Réglages de l’assistant IA enregistrés');
    } catch (e: any) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  }
  async function removeKey() {
    setBusy(true);
    try { const r = await aiSetKey(''); const st = await aiStatus().catch(() => null); setHasKey(st ? st.hasKey : r.hasKey); setKeySource(st?.keySource); await audit('Paramètres IA', 'Clé API supprimée'); toast('Clé API supprimée'); }
    catch (e: any) { toast(e.message, 'error'); } finally { setBusy(false); }
  }
  async function runTest() {
    setTesting(true); setTest(null);
    try { setTest(await aiTest({ localUrl: form.localUrl.trim(), onlineUrl: form.onlineUrl.trim(), model: form.model.trim(), apiKey: key.trim() || undefined })); }
    catch (e: any) { setTest({ ok: false, local: e.message }); }
    finally { setTesting(false); }
  }

  return (
    <div className="stack">
      {!cloud && (
        <div className="notice"><Icon name="cloudOff" /><span>L’assistant IA passe par le cloud : reliez d’abord cet appareil (<button className="link-btn" onClick={() => navigate('/parametres/cloud')}>Cloud et synchronisation</button>).</span></div>
      )}
      {statusErr && <div className="notice notice-danger"><Icon name="alert" /><span>{statusErr}{/introuvable/.test(statusErr) ? ' Suivez le guide docs/GUIDE_IA.md pour l’installer.' : ''}</span></div>}

      <div className="card stack">
        <div className="row-between">
          <h3>Assistant IA</h3>
          <Badge tone={s.enabled ? 'ok' : 'neutral'}>{s.enabled ? 'Activé' : 'Désactivé'}</Badge>
        </div>
        <Help>Une bulle en bas à droite permet de poser des questions sur le logiciel (« comment faire… ? ») et sur les données (ventes, stock, commandes, livreurs…). L’assistant lit seulement : il ne modifie jamais rien, et chaque utilisateur n’obtient que ce qu’il a déjà le droit de voir.</Help>
        <Toggle checked={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} label="Activer l’assistant IA pour tous les utilisateurs" disabled={!editable} />
      </div>

      <div className="card stack">
        <div><h3>Serveur IA</h3><p className="small muted">L’adresse locale (réseau du bureau) est essayée d’abord ; si elle ne répond pas en 1,5 s, l’adresse en ligne est utilisée avec la clé.</p></div>
        <div className="grid-2">
          <TextField label="URL locale" value={form.localUrl} onChange={(v) => setForm({ ...form, localUrl: v })} placeholder={AI_DEFAULTS.localUrl} disabled={!editable} error={urlOk(form.localUrl) ? null : 'Adresse invalide'} />
          <TextField label="URL en ligne" value={form.onlineUrl} onChange={(v) => setForm({ ...form, onlineUrl: v })} placeholder={AI_DEFAULTS.onlineUrl} disabled={!editable} error={urlOk(form.onlineUrl) ? null : 'Adresse invalide'} />
          <div className="stack-s">
            {editable
              ? <PasswordField label="Clé API (adresse en ligne)" value={key} onChange={setKey} autoComplete="new-password" hint={hasKey ? (keySource === 'secret' ? '•••• enregistrée (secret Supabase AI_API_KEY). Une clé tapée ici la remplace.' : '•••• enregistrée — laissez vide pour la garder, ou tapez une nouvelle clé.') : hasKey === false ? 'Aucune clé enregistrée (ni ici, ni en secret Supabase AI_API_KEY).' : 'Gardée côté serveur, jamais affichée.'} />
              : <TextField label="Clé API (adresse en ligne)" value={hasKey ? '•••• enregistrée' : 'aucune'} onChange={() => {}} disabled />}
            {editable && hasKey && keySource === 'reglages' && <div><Button variant="quiet" icon="trash" busy={busy} onClick={removeKey}>Supprimer la clé enregistrée</Button></div>}
          </div>
          <TextField label="Nom du modèle" value={form.model} onChange={(v) => setForm({ ...form, model: v })} placeholder={AI_DEFAULTS.model} disabled={!editable} />
        </div>
        {editable && (
          <div className="row">
            <Button icon="check" busy={busy} disabled={!dirty || !cloud} onClick={saveAll}>Enregistrer</Button>
            <Button variant="ghost" icon="refresh" busy={testing} disabled={!cloud} onClick={runTest}>Tester la connexion</Button>
          </div>
        )}
        {!editable && <p className="small muted">Seuls les administrateurs peuvent modifier ces réglages.</p>}
        {test && (test.ok ? (
          <div className="notice notice-ok" role="status"><Icon name="check" /><span>
            <strong>Connexion réussie : {test.via === 'local' ? 'Local' : 'En ligne'}</strong> — temps de réponse {test.ms} ms.
            {test.modelFound === false ? <> Attention : le modèle « {form.model} » n’est pas dans la liste du serveur ({(test.models || []).join(', ') || 'vide'}).</> : <> Modèle « {form.model} » disponible.</>}
            {test.via === 'online' && test.local ? <><br /><span className="small muted">Adresse locale non joignable depuis le cloud : {test.local}.</span></> : null}
          </span></div>
        ) : (
          <div className="notice notice-danger" role="status"><Icon name="alert" /><span>
            <strong>{test.onlineStatus === 401 || test.onlineStatus === 403 ? 'Clé API invalide ou absente (401).' : test.onlineStatus === 502 || test.onlineStatus === 504 ? 'Serveur IA injoignable (PC éteint ?) — erreur 502.' : test.onlineStatus === 404 ? 'Adresse incorrecte (404) : l’URL doit se terminer par /v1.' : 'Aucune adresse ne répond.'}</strong>
            <br />Local : {test.local || '—'}<br />En ligne : {test.online || '—'}
          </span></div>
        ))}
        <p className="small muted">Les appels à l’IA passent tous par la fonction cloud « ai-chat » : l’adresse locale n’est donc joignable que si ce serveur cloud peut l’atteindre (en pratique, c’est l’adresse en ligne qui sert).</p>
      </div>
    </div>
  );
}
