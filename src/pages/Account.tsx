// Mon compte : mot de passe, question secrète, thème, déconnexion.
import { useState } from 'react';
import { can, checkPasswordStrength, logout, managesOwnPassword, roleOf, SECRET_QUESTIONS, setPassword, setSecretQuestion, audit, useCurrentUser, useMe } from '../lib/auth';
import { verifySecret } from '../lib/crypto';
import { PERMISSIONS, SUPERADMIN_ROLE } from '../lib/permissions';
import { Help, Badge, Button, PageHead, PasswordField, SelectField, TextField, toast } from '../ui/kit';
import { ThemePicker } from './Settings';
import { useMeta } from '../lib/db';
import { setPin } from '../lib/maintenance';

export function AccountPage() {
  const me = useMe();
  const role = roleOf(me);
  const perms = me.roleId === SUPERADMIN_ROLE ? PERMISSIONS : PERMISSIONS.filter((p) => can(me, p.key));

  return (
    <>
      <PageHead title="Mon compte" subtitle={`${me.fullName} · ${me.username}`} actions={<Button variant="ghost" icon="logout" onClick={() => logout()}>Se déconnecter</Button>} />
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="stack">
          {managesOwnPassword(me) ? (
            <>
              <PasswordCard />
              <SecretCard />
            </>
          ) : (
            <div className="card stack-s">
              <h3>Mot de passe</h3>
              <p className="muted">Votre mot de passe est donné par le gérant. Pour le changer ou si vous l'avez oublié, adressez-vous à lui.</p>
            </div>
          )}
          <PinCard />
        </div>
        <div className="stack">
          <div className="card stack">
            <h3>Thème</h3>
            <ThemePicker />
          </div>
          <div className="card stack-s">
            <div className="row-between"><h3>Mon rôle</h3><Badge tone="brand">{role?.name}</Badge></div>
            <p className="small muted">{role?.description}</p>
            <ul className="small" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              {perms.map((p) => <li key={p.key}>{p.label}</li>)}
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}

function PasswordCard() {
  const me = useMe();
  const [old, setOld] = useState('');
  const [pwd, setPwd] = useState('');
  const [pwd2, setPwd2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const strength = pwd ? checkPasswordStrength(pwd) : null;
  return (
    <form className="card stack" onSubmit={async (e) => {
      e.preventDefault();
      setError(null);
      if (!(await verifySecret(old, me.passwordHash))) return setError('Le mot de passe actuel est incorrect.');
      if (strength) return;
      if (pwd !== pwd2) return setError('Les deux nouveaux mots de passe ne sont pas identiques.');
      setBusy(true);
      await setPassword(me.id, pwd, { reason: 'Changé par l’utilisateur' });
      setBusy(false);
      setOld(''); setPwd(''); setPwd2('');
      toast('Mot de passe changé');
    }}>
      <h3>Changer mon mot de passe</h3>
      <PasswordField label="Mot de passe actuel" required value={old} onChange={setOld} />
      <PasswordField label="Nouveau mot de passe" required value={pwd} onChange={setPwd} autoComplete="new-password" error={strength} />
      <PasswordField label="Retapez le nouveau mot de passe" required value={pwd2} onChange={setPwd2} autoComplete="new-password" error={error} />
      <div><Button type="submit" busy={busy} disabled={!old || !pwd || !pwd2}>Changer le mot de passe</Button></div>
    </form>
  );
}

function SecretCard() {
  const me = useMe();
  const known = SECRET_QUESTIONS.includes(me.secretQuestion || '');
  const [question, setQuestion] = useState(known ? me.secretQuestion! : me.secretQuestion ? '__custom' : SECRET_QUESTIONS[0]);
  const [custom, setCustom] = useState(known ? '' : me.secretQuestion || '');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const final = question === '__custom' ? custom.trim() : question;
  return (
    <form className="card stack" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      await setSecretQuestion(me.id, final, answer);
      await audit('Compte', 'Question secrète modifiée', 'users', me.id);
      setBusy(false);
      setAnswer('');
      toast('Question secrète enregistrée');
    }}>
      <h3>Question secrète</h3>
      <SelectField label="Question" value={question} onChange={setQuestion}
        options={[...SECRET_QUESTIONS.map((q) => ({ value: q, label: q })), { value: '__custom', label: 'Écrire ma propre question…' }]} />
      {question === '__custom' && <TextField label="Votre question" required value={custom} onChange={setCustom} />}
      <TextField label="Nouvelle réponse" required value={answer} onChange={setAnswer} autoComplete="off" hint="Les majuscules et les accents ne comptent pas." />
      <div><Button type="submit" busy={busy} disabled={!final || answer.trim().length < 2}>Enregistrer</Button></div>
    </form>
  );
}

/** Code PIN : déverrouille rapidement l'appli sur son propre appareil (le mot de passe reste nécessaire pour se connecter). */
function PinCard() {
  const me = useMe();
  const pins = useMeta<Record<string, string>>('pins', {});
  const has = !!pins[me.id];
  const [pin, setPinV] = useState('');
  const [pin2, setPin2] = useState('');
  const [edit, setEdit] = useState(false);
  const ok = /^\d{4,6}$/.test(pin) && pin === pin2 && !/^(\d)\1+$/.test(pin) && !['1234', '123456', '0000'].includes(pin);
  return (
    <div className="card stack-s">
      <div className="row-between"><h3>Code PIN (cet appareil)</h3>{has && <Badge tone="ok">Activé</Badge>}</div>
      <Help>Après un verrouillage automatique, déverrouillez avec 4 à 6 chiffres au lieu du mot de passe. Le code ne vaut que sur cet appareil. Après 5 erreurs, le mot de passe est demandé.</Help>
      {edit ? (
        <form className="stack-s" onSubmit={async (e) => { e.preventDefault(); if (!ok) return; await setPin(me.id, pin); setEdit(false); setPinV(''); setPin2(''); toast('Code PIN enregistré sur cet appareil'); }}>
          <div className="grid-2">
            <TextField label="Nouveau code (4 à 6 chiffres)" type="password" inputMode="numeric" maxLength={6} required value={pin} onChange={(v) => setPinV(v.replace(/\D/g, ''))} autoFocus />
            <TextField label="Retapez le code" type="password" inputMode="numeric" maxLength={6} required value={pin2} onChange={(v) => setPin2(v.replace(/\D/g, ''))} />
          </div>
          {pin.length >= 4 && /^(\d)\1+$|^1234(56)?$/.test(pin) && <p className="small neg">Code trop simple : choisissez-en un autre.</p>}
          <div className="row"><Button type="submit" disabled={!ok}>Enregistrer</Button><Button variant="ghost" type="button" onClick={() => setEdit(false)}>Annuler</Button></div>
        </form>
      ) : (
        <div className="row">
          <Button variant="ghost" icon="key" onClick={() => setEdit(true)}>{has ? 'Changer le code' : 'Choisir un code PIN'}</Button>
          {has && <Button variant="quiet" onClick={async () => { await setPin(me.id, null); toast('Code PIN retiré'); }}>Retirer</Button>}
        </div>
      )}
    </div>
  );
}
