// Bulle de discussion flottante de l'assistant IA (en bas à droite, sur toutes les pages).
// Visible quand l'assistant est activé (Paramètres → Intelligence artificielle), l'utilisateur connecté et
// l'appareil relié au cloud. La conversation reste ouverte quand on change de page.
import { useEffect, useRef, useState } from 'react';
import { useCan, useMe } from '../lib/auth';
import { useMeta } from '../lib/db';
import { Icon } from '../ui/icons';
import { aiChat, AiError, chatOwnerCheck, chatState, setChat, UNAVAILABLE, useAiSettings, useChat, type ChatMsg } from './client';
import { Markdown } from './markdown';

let controller: AbortController | null = null;

async function ask(question: string) {
  const q = question.trim();
  if (!q || chatState().busy) return;
  const history: ChatMsg[] = [...chatState().messages, { role: 'user', content: q }];
  setChat({ messages: [...history, { role: 'assistant', content: '' }], busy: true, status: 'Réfléchit…' });
  const setAnswer = (fn: (t: string) => string, extra: Partial<ChatMsg> = {}) => setChat((s) => {
    const msgs = [...s.messages]; const last = msgs[msgs.length - 1];
    msgs[msgs.length - 1] = { ...last, content: fn(last.content), ...extra };
    return { messages: msgs };
  });
  controller = new AbortController();
  try {
    await aiChat(history, (e) => {
      if (e.type === 'meta') setChat({ via: e.via });
      else if (e.type === 'thinking') setChat({ status: 'Réfléchit…' });
      else if (e.type === 'tool') setChat({ status: `${e.label}…` });
      else if (e.type === 'delta') { setAnswer((t) => t + e.text); setChat({ status: '' }); }
      else if (e.type === 'replace') setAnswer(() => e.text);
      else if (e.type === 'error') setAnswer(() => e.message || UNAVAILABLE, { error: true });
    }, controller.signal);
  } catch (e: any) {
    if (e?.name === 'AbortError') setAnswer((t) => (t ? t + '\n\n*(arrêté)*' : '*(arrêté)*'));
    else setAnswer(() => (e instanceof AiError ? e.message : UNAVAILABLE), { error: true });
  } finally {
    controller = null;
    setChat((s) => {
      const msgs = [...s.messages]; const last = msgs[msgs.length - 1];
      if (last?.role === 'assistant' && !last.content.trim()) msgs[msgs.length - 1] = { ...last, content: UNAVAILABLE, error: true };
      return { messages: msgs, busy: false, status: '' };
    });
  }
}
const stop = () => controller?.abort();

function suggestions(can: (p: string) => boolean): string[] {
  if (can('courier.self') && !can('orders.create')) return ['Quels sont mes colis encore en livraison ?', 'Combien dois-je verser à la boutique aujourd’hui ?', 'Comment marquer un colis comme livré ?'];
  const s: string[] = [];
  if (can('dashboard.view') || can('reports.view')) s.push('Combien de ventes cette semaine par rapport à la semaine dernière ?');
  if (can('dashboard.view') || can('reports.view') || can('pos.sell')) s.push('Quels sont les articles les plus vendus ce mois-ci ?');
  if (can('catalog.view')) s.push('Quels articles sont bientôt en rupture de stock ?');
  if (can('audit.view') || can('users.manage')) s.push('Donne-moi les heures de travail de chaque utilisateur aujourd’hui');
  else if (can('handover.self')) s.push('Combien dois-je remettre au responsable ce soir ?');
  s.push('Comment enregistrer le retour d’un livreur ?');
  return s.slice(0, 4);
}

export function ChatBubble() {
  const ai = useAiSettings();
  const cloud = useMeta<any>('cloud', null);
  const me = useMe();
  const can = useCan();
  const chat = useChat();
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { chatOwnerCheck(me?.id); }, [me?.id]);
  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [chat.messages, chat.status, chat.open]);
  useEffect(() => { if (chat.open) setTimeout(() => inputRef.current?.focus(), 50); }, [chat.open]);
  useEffect(() => {
    if (!chat.open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.modal-backdrop')) setChat({ open: false }); };
    window.addEventListener('keydown', onKey);
    document.body.classList.add('ai-open');
    return () => { window.removeEventListener('keydown', onKey); document.body.classList.remove('ai-open'); };
  }, [chat.open]);

  if (!ai.enabled || !cloud || !me) return null;
  const send = () => { if (!text.trim() || chat.busy) return; void ask(text); setText(''); };
  const last = chat.messages[chat.messages.length - 1];
  const waiting = chat.busy && (!last || last.role !== 'assistant' || !last.content);

  return (
    <>
      {!chat.open && (
        <button className="ai-fab" onClick={() => setChat({ open: true })} aria-label="Ouvrir l’assistant IA" title="Assistant IA">
          <Icon name="sparkle" size={26} />
        </button>
      )}
      {chat.open && (
        <section className="ai-panel" role="dialog" aria-label="Assistant IA">
          <header className="ai-head">
            <span className="ai-avatar"><Icon name="sparkle" size={18} /></span>
            <div className="ai-title">
              <strong>Assistant TSENA</strong>
              <span className="small muted">{chat.busy ? (chat.status || 'Écrit…') : 'Posez une question sur le logiciel ou vos données'}</span>
            </div>
            {chat.via && <span className={`ai-via ai-via-${chat.via}`} title={chat.via === 'local' ? 'Serveur IA du bureau' : 'Serveur IA en ligne'}>{chat.via === 'local' ? 'Local' : 'En ligne'}</span>}
            <button className="icon-btn" onClick={() => { stop(); setChat({ messages: [], via: undefined, status: '' }); setText(''); inputRef.current?.focus(); }} aria-label="Nouvelle conversation" title="Nouvelle conversation" disabled={!chat.messages.length && !chat.busy}><Icon name="plus" /></button>
            <button className="icon-btn" onClick={() => setChat({ open: false })} aria-label="Fermer l’assistant" title="Fermer"><Icon name="x" /></button>
          </header>

          <div className="ai-list" ref={listRef} aria-live="polite">
            {!chat.messages.length && (
              <div className="ai-empty">
                <span className="ai-avatar ai-avatar-l"><Icon name="sparkle" size={28} /></span>
                <p><strong>Bonjour {me.fullName.split(' ')[0]} !</strong><br /><span className="muted small">Je connais le logiciel et je lis vos données (sans rien modifier). Essayez :</span></p>
                <div className="ai-suggest">
                  {suggestions(can).map((s) => <button key={s} onClick={() => void ask(s)}>{s}</button>)}
                </div>
              </div>
            )}
            {chat.messages.map((m, i) => (
              m.role === 'user'
                ? <div key={i} className="ai-msg ai-user">{m.content}</div>
                : m.content
                  ? <div key={i} className={`ai-msg ai-bot ${m.error ? 'ai-error' : ''}`}>{m.error ? <span><Icon name="alert" size={16} /> {m.content}</span> : <Markdown text={m.content} />}</div>
                  : null
            ))}
            {waiting && <div className="ai-msg ai-bot ai-thinking"><span className="ai-dots" aria-hidden><i /><i /><i /></span> {chat.status || 'Réfléchit…'}</div>}
          </div>

          <form className="ai-foot" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <textarea ref={inputRef} rows={1} value={text} placeholder="Écrire un message…" aria-label="Votre message"
              onChange={(e) => { setText(e.target.value); const t = e.target; t.style.height = 'auto'; t.style.height = Math.min(140, t.scrollHeight) + 'px'; }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
            {chat.busy
              ? <button type="button" className="ai-send ai-stop" onClick={stop} aria-label="Arrêter" title="Arrêter"><Icon name="stop" size={18} /></button>
              : <button type="submit" className="ai-send" disabled={!text.trim()} aria-label="Envoyer" title="Envoyer (Entrée)"><Icon name="send" size={18} /></button>}
          </form>
        </section>
      )}
    </>
  );
}
