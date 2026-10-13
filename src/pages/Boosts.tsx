// Boosts publicitaires : un tableau par page et par semaine (ou période) où l'on remplit chaque jour les conversations
// cumulées de chaque boost ; nouvelles conversations du jour, total, CA de la page et CA par conversation ;
// pause / reprise / suppression des boosts, ordre par glisser-déposer ; analyse des performances.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useCan } from '../lib/auth';
import { setMeta, useMeta, useTable } from '../lib/db';
import { fmtAr, fmtNum, parseNum, todayYmd } from '../lib/catalog';
import { addDays, mondayOf } from '../lib/money';
import { rootOf, useMyScope } from '../lib/scope';
import { salesLedger } from '../lib/analytics';
import {
  STOP_REASONS, VERDICT, activeBoosts, boostDeadline, deadlineText, lastEntry, missingBoosts, activeOn, allPages, boostName, boostPerformance, createBoost, dayStats, deleteBoost, isPaused, orderedBoosts,
  pageName, pauseBoost, prevReading, readingOn, readingsOf, reorderBoosts, resumeBoost, saveReading, saveReal, updateBoost, type Boost, type BoostPerf,
} from '../lib/boosts';
import { Badge, Button, Confirm, Empty, Help, IconButton, Modal, PageHead, SelectField, TextField, navigate, toast, useRoute } from '../ui/kit';
import { Icon } from '../ui/icons';
import { SortTable, exportTables, type Col } from '../ui/table';

const TABS = [
  { key: 'suivi', label: 'Saisie et suivi', perm: 'boosts.view' },
  { key: 'performance', label: 'Performance des boosts', perm: 'boosts.view' },
];
const usd = (n?: number | null, d = 2) => (n == null || !isFinite(n) ? '—' : `${n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d })} $`);
const dd = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
const dayShort = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' });
const signed = (n?: number) => (n == null ? '—' : n > 0 ? `+${fmtNum(n)}` : fmtNum(n));

export function BoostsPage() {
  const can = useCan();
  const route = useRoute();
  const tabs = TABS.filter((t) => can(t.perm) || (t.key === 'suivi' && can('boosts.enter')));
  const cur = tabs.find((t) => route.endsWith('/' + t.key)) ?? tabs[0];
  useTable('boosts'); useTable('boostReadings'); useTable('pageMessages'); useTable('categories'); useTable('orders');
  if (!cur) return <Empty icon="lock" title="Accès réservé" />;
  return (
    <>
      <PageHead title="Boosts publicitaires" subtitle="Conversations des boosts par page, et ce qu’elles rapportent en chiffre d’affaires" />
      <div className="tabs" role="tablist">{tabs.map((t) => <button key={t.key} role="tab" aria-selected={cur.key === t.key} onClick={() => navigate('/boosts/' + t.key)}>{t.label}</button>)}</div>
      {cur.key === 'suivi' && <Tracking />}
      {cur.key === 'performance' && <Performance />}
    </>
  );
}

/** Page choisie (mémorisée sur l'appareil). Le vendeur ne voit que ses pages, sauf s'il choisit « Toutes ». */
function usePage(allowAll = false) {
  const scope = useMyScope();
  const pages = allPages().filter((p) => !scope.on || scope.pages.includes(p.id));
  const saved = useMeta<string>('boostPage', '');
  const value = saved === '' && allowAll ? '' : pages.some((p) => p.id === saved) ? saved : pages[0]?.id ?? '';
  const options = [...(allowAll ? [{ value: '', label: 'Toutes les pages' }] : []), ...pages.map((p) => ({ value: p.id, label: p.name }))];
  return { pageId: value, set: (v: string) => setMeta('boostPage', v), options, scope, pages };
}

/** Période commune : « Semaine » (lundi → dimanche, avec ‹ ›) ou « Période » (du … au …). */
function usePeriodBar() {
  const today = todayYmd();
  const [mode, setMode] = useState<'week' | 'range'>('week');
  const [anchor, setAnchor] = useState(today);
  const [from, setFrom] = useState(addDays(today, -13));
  const [to, setTo] = useState(today);
  const mon = mondayOf(anchor);
  const f = mode === 'week' ? mon : from <= to ? from : to;
  const t = mode === 'week' ? addDays(mon, 6) : from <= to ? to : from;
  const days: string[] = [];
  for (let d = f; d <= t && days.length < 62; d = addDays(d, 1)) days.push(d);
  const label = mode === 'week' ? `Semaine du ${dd(mon)} au ${dd(addDays(mon, 6))}` : `Du ${dd(f)} au ${dd(days[days.length - 1])}`;
  const bar = (
    <div className="boost-period">
      <div className="segmented" role="group" aria-label="Période">
        <button type="button" aria-pressed={mode === 'week'} onClick={() => setMode('week')}>Semaine</button>
        <button type="button" aria-pressed={mode === 'range'} onClick={() => setMode('range')}>Période</button>
      </div>
      {mode === 'week' ? (
        <div className="bw-period-nav">
          <IconButton icon="chevronLeft" label="Semaine précédente" onClick={() => setAnchor(addDays(anchor, -7))} />
          <strong>{label}</strong>
          <IconButton icon="chevronRight" label="Semaine suivante" disabled={addDays(mon, 7) > today} onClick={() => setAnchor(addDays(anchor, 7))} />
          {mon !== mondayOf(today) && <Button variant="quiet" className="btn-sm" onClick={() => setAnchor(today)}>Cette semaine</Button>}
        </div>
      ) : (
        <div className="bw-period-range">
          <TextField label="Du" type="date" value={from} max={today} onChange={(v) => v && setFrom(v)} />
          <TextField label="Au" type="date" value={to} max={today} onChange={(v) => v && setTo(v)} />
        </div>
      )}
    </div>
  );
  return { days, from: f, to: t, label, bar, mode };
}

/** CA des ventes par page et par jour (même règle que le tableau de bord). */
function useRevenue(from: string, to: string) {
  const orders = useTable('orders');
  return useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    for (const l of salesLedger(from, to)) {
      const pid = rootOf(l.categoryId) || '_';
      if (!m.has(pid)) m.set(pid, new Map());
      const d = m.get(pid)!; d.set(l.day, (d.get(l.day) ?? 0) + l.amount);
    }
    return m;
  }, [from, to, orders]);
}

// ---------------------------------------------------------------- Saisie et suivi
function Tracking() {
  const pg = usePage(true);
  const per = usePeriodBar();
  if (!pg.pages.length) return <div className="card"><Empty icon="tag" title="Aucune page">Créez d’abord les catégories principales (une par page Facebook) dans Articles.</Empty></div>;
  return (
    <div className="stack">
      <div className="card boost-filters">
        <div className="boost-page-field"><SelectField label="Page" value={pg.pageId} onChange={pg.set} options={pg.options} /></div>
        {per.bar}
      </div>
      {pg.pageId ? <PageTable key={pg.pageId} pageId={pg.pageId} days={per.days} /> : <AllPagesTable pageIds={pg.pages.map((p) => p.id)} days={per.days} onPick={pg.set} />}
    </div>
  );
}

/** Case du tableau : on tape la valeur, elle est enregistrée en quittant la case (ou avec Entrée). */
function CellInput({ value, placeholder, label, decimal, today, missing, onCommit }: { value?: number; placeholder?: string; label: string; decimal?: boolean; today?: boolean; missing?: boolean; onCommit: (v: number | undefined) => Promise<void> }) {
  const show = value == null ? '' : decimal ? String(value).replace('.', ',') : String(value);
  const [draft, setDraft] = useState<string | null>(null);
  const commit = async () => {
    if (draft == null) return;
    const raw = draft.trim();
    if (raw === show) { setDraft(null); return; }
    const n = raw === '' ? undefined : parseNum(raw);
    if (raw !== '' && n == null) { toast('Nombre attendu.', 'error'); setDraft(null); return; }
    try { await onCommit(n); setDraft(null); } catch (e: any) { toast(e?.message ?? String(e), 'error'); setDraft(null); }
  };
  return <input className={`cell-input boost-cell ${today ? 'is-today' : ''} ${missing ? 'is-missing' : ''}`} inputMode={decimal ? 'decimal' : 'numeric'} aria-label={label} placeholder={placeholder}
    value={draft ?? show} onFocus={(e) => e.target.select()} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />;
}

function PageTable({ pageId, days }: { pageId: string; days: string[] }) {
  const can = useCan();
  const edit = can('boosts.enter');
  const today = todayYmd();
  const [metric, setMetric] = useState<'msg' | 'spend'>('msg');
  const [showPaused, setShowPaused] = useState(false);
  const [form, setForm] = useState<Boost | 'new' | null>(null);
  const [pause, setPause] = useState<Boost | null>(null);
  const [del, setDel] = useState<Boost | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const shownDays = days;
  const wrapRef = useRef<HTMLDivElement>(null);
  // Sur téléphone, le tableau s'ouvre directement sur la colonne d'aujourd'hui.
  useEffect(() => {
    const w = wrapRef.current; const th = w?.querySelector<HTMLElement>('th.is-today');
    if (w && th && w.scrollWidth > w.clientWidth) w.scrollLeft = Math.max(0, th.offsetLeft + th.offsetWidth - w.clientWidth + 170);
  }, [days.join()]);
  const last = shownDays.filter((d) => d <= today).pop() ?? shownDays[0];
  const all = orderedBoosts(pageId);
  const inPeriod = (b: Boost) => shownDays.some((d) => readingOn(b.id, d)) || shownDays.some((d) => activeOn(b, d));
  const boosts = all.filter((b) => b.startDate <= shownDays[shownDays.length - 1] && (showPaused ? true : !isPaused(b) || inPeriod(b)));
  const hiddenPaused = all.filter((b) => isPaused(b) && !boosts.includes(b)).length;
  const stats = shownDays.map((d) => dayStats(pageId, d));
  const rev = useRevenue(shownDays[0], last).get(pageId) ?? new Map<string, number>();
  const revW = shownDays.reduce((t, d) => t + (rev.get(d) ?? 0), 0);
  const msgW = stats.reduce((t, s) => t + s.theo, 0);
  const spendW = stats.reduce((t, s) => t + s.spend, 0);
  const realW = stats.reduce((t, s) => t + (s.real ?? 0), 0);
  const ordersW = stats.reduce((t, s) => t + s.orders, 0);
  const isToday = (d: string) => d === today;
  const move = async (id: string, to: string | number) => {
    const ids = all.map((b) => b.id).filter((x) => x !== id);
    const idx = typeof to === 'number' ? Math.max(0, Math.min(ids.length, to)) : ids.indexOf(to);
    ids.splice(idx < 0 ? ids.length : idx, 0, id);
    await reorderBoosts(pageId, ids);
  };
  const exp = () => exportTables(`boosts_${pageName(pageId)}_${shownDays[0]}.xlsx`, [{
    name: 'Boosts',
    cols: [{ key: 'l', label: 'Boost', value: (r: any) => r.l, width: 30 }, ...shownDays.map((d, i) => ({ key: d, label: dayShort(d), value: (r: any) => r.v[i] ?? '', width: 12 })), { key: 't', label: 'Total', value: (r: any) => r.t, width: 14 }],
    rows: [
      ...boosts.map((b) => ({ l: `${b.slot}. ${b.label || 'Boost'} (cumul)`, v: shownDays.map((d) => readingOn(b.id, d)?.messages), t: '' })),
      ...boosts.map((b) => ({ l: `${b.slot}. ${b.label || 'Boost'} (nouveaux)`, v: stats.map((s) => s.perBoost.get(b.id)), t: stats.reduce((t, s) => t + (s.perBoost.get(b.id) ?? 0), 0) })),
      { l: 'Total nouvelles conversations', v: stats.map((s) => s.theo), t: msgW },
      { l: 'Messages réels comptés', v: stats.map((s) => s.real), t: realW },
      { l: "Chiffre d'affaires (Ar)", v: shownDays.map((d) => Math.round(rev.get(d) ?? 0)), t: Math.round(revW) },
      { l: 'Commandes en ligne', v: stats.map((s) => s.orders), t: ordersW },
      { l: 'Dépense ($)', v: stats.map((s) => Math.round(s.spend * 100) / 100), t: Math.round(spendW * 100) / 100 },
    ],
  }]);

  return (
    <>
      <div className="stat-grid">
        <div className="card stat stat-strong"><span className="small muted">Nouvelles conversations</span><strong className="stat-value num">{fmtNum(msgW)}</strong><span className="small muted">{boosts.filter((b) => !isPaused(b)).length} boost(s) actif(s)</span></div>
        <div className="card stat"><span className="small muted">Chiffre d’affaires de la page</span><strong className="stat-value num">{fmtAr(revW)}</strong><span className="small muted">{msgW ? `${fmtAr(revW / msgW)} par conversation` : '—'}</span></div>
        <div className="card stat"><span className="small muted">Commandes en ligne</span><strong className="stat-value num">{fmtNum(ordersW)}</strong><span className="small muted">{msgW ? `${Math.round((ordersW / msgW) * 100)} % des conversations` : '—'}</span></div>
        <div className="card stat"><span className="small muted">Dépense</span><strong className="stat-value num">{usd(spendW)}</strong><span className="small muted">{msgW ? `${usd(spendW / msgW)} par conversation` : '—'}</span></div>
      </div>
      <div className="card card-flush">
        <div className="card-pad stack-s">
          <div className="row-between">
            <h2>{pageName(pageId)}</h2>
            <div className="row" style={{ gap: 6 }}>
              <Button variant="ghost" className="btn-sm" icon="download" onClick={exp}>Excel</Button>
              {edit && <Button className="btn-sm" icon="plus" onClick={() => setForm('new')}>Nouveau boost</Button>}
            </div>
          </div>
          <div className="row-between">
            <div className="segmented" role="group" aria-label="Valeur saisie">
              <button type="button" aria-pressed={metric === 'msg'} onClick={() => setMetric('msg')}>Conversations</button>
              <button type="button" aria-pressed={metric === 'spend'} onClick={() => setMetric('spend')}>Dépense ($)</button>
            </div>
            {(hiddenPaused > 0 || showPaused) && <label className="small row" style={{ gap: 6 }}><input type="checkbox" checked={showPaused} onChange={(e) => setShowPaused(e.target.checked)} /> Afficher les boosts en pause{hiddenPaused ? ` (${hiddenPaused})` : ''}</label>}
          </div>
          {(() => { const m = missingBoosts(pageId, today).length; const late = m > 0 && new Date() > boostDeadline(today); return m > 0 ? <div className={`notice ${late ? 'notice-danger' : ''}`}><Icon name="alert" /><span>{late ? <><strong>Compte boost du jour en retard</strong> ({m} boost(s) sans saisie) : à faire tout de suite. Le gérant est prévenu.</> : <>Compte boost du jour à faire <strong>avant {deadlineText(today)}</strong> ({m} boost(s)). Les boosts tournent aussi le dimanche : le compte du dimanche se fait le lundi avant 12 h.</>}</span></div> : null; })()}
          <Help>{metric === 'msg'
            ? 'Recopiez chaque jour, dans la case du jour, les conversations cumulées affichées par Meta (depuis le lancement du boost). Les jours précédents sont déjà remplis ; le chiffre vert sous chaque case = nouvelles conversations de ce jour (jour − veille : hier 20, aujourd’hui 25 → +5). Seule cette différence est comptée dans les totaux, jamais le cumul. Pour un boost déjà en cours quand on commence à le suivre, la première case est le « départ » : elle ne compte pas. L’enregistrement se fait en quittant la case. Glissez la poignée ⋮⋮ (ou les flèches sur téléphone) pour changer l’ordre des boosts.'
            : 'Dépense cumulée ($) affichée par Meta pour chaque boost (facultatif). Sert à calculer le coût par conversation.'}</Help>
        </div>
        {boosts.length === 0 ? <Empty icon="megaphone" title="Aucun boost sur cette période">{edit && <Button icon="plus" onClick={() => setForm('new')}>Ajouter un boost</Button>}</Empty> : (
          <div className="table-wrap" ref={wrapRef}><table className="table week-table boost-week">
            <thead><tr>
              <th className="bw-slot">N°</th><th className="bw-name">Boost</th>
              {shownDays.map((d) => <th key={d} className={`t-num ${isToday(d) ? 'is-today' : ''}`}>{isToday(d) ? 'Aujourd’hui' : dayShort(d)}</th>)}
              <th className="t-num">{last === today ? 'Du jour' : `Le ${dd(last)}`}<div className="small muted">jour − veille</div></th>
              <th className="t-num">Total<div className="small muted">période</div></th>
              {edit && <th></th>}
            </tr></thead>
            <tbody>
              {boosts.map((b, i) => {
                const paused = isPaused(b);
                const tot = metric === 'msg' ? stats.reduce((t, s) => t + (s.perBoost.get(b.id) ?? 0), 0) : stats.reduce((t, s) => t + (s.spendPerBoost.get(b.id) ?? 0), 0);
                const dl = metric === 'msg' ? stats[shownDays.indexOf(last)]?.perBoost.get(b.id) : stats[shownDays.indexOf(last)]?.spendPerBoost.get(b.id);
                return (
                  <tr key={b.id} className={`${paused ? 'is-paused' : ''} ${over === b.id && drag && drag !== b.id ? 'drag-over' : ''}`}
                    draggable={edit} onDragStart={(e) => { setDrag(b.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', b.id); }}
                    onDragOver={(e) => { if (drag) { e.preventDefault(); setOver(b.id); } }} onDragLeave={() => setOver(null)} onDragEnd={() => { setDrag(null); setOver(null); }}
                    onDrop={async (e) => { e.preventDefault(); const id = drag; setDrag(null); setOver(null); if (id && id !== b.id) await move(id, b.id); }}>
                    <td className="bw-slot">
                      <div className="slot-cell">
                        {edit && <span className="drag-handle" title="Glisser pour changer l’ordre"><Icon name="grip" size={16} /></span>}
                        <span className="slot-badge">{b.slot}</span>
                        {edit && <span className="move-btns">
                          <button type="button" aria-label={`Monter le boost ${b.slot}`} disabled={i === 0} onClick={() => move(b.id, all.indexOf(boosts[i - 1]))}><Icon name="chevronUp" size={14} /></button>
                          <button type="button" aria-label={`Descendre le boost ${b.slot}`} disabled={i === boosts.length - 1} onClick={() => move(b.id, all.indexOf(boosts[i + 1]))}><Icon name="chevronDown" size={14} /></button>
                        </span>}
                      </div>
                    </td>
                    <td className="bw-name"><strong>{b.label || `Boost ${b.slot}`}</strong>
                      <div className="small muted">{paused ? <Badge tone="warn">En pause</Badge> : <Badge tone="ok">Actif</Badge>} lancé le {dd(b.startDate)}{b.dailyBudget ? ` · ${usd(b.dailyBudget)}/j` : ''}</div></td>
                    {shownDays.map((d) => {
                      const r = readingOn(b.id, d);
                      const active = activeOn(b, d);
                      if (d > today || d < b.startDate) return <td key={d} className="t-num muted">·</td>;
                      if (!active && !r) return <td key={d} className="t-num"><span className="small muted">pause</span></td>;
                      const delta = metric === 'msg' ? stats[shownDays.indexOf(d)].perBoost.get(b.id) : stats[shownDays.indexOf(d)].spendPerBoost.get(b.id);
                      const prev = prevReading(b.id, d);
                      return (
                        <td key={d} className={`bw-day ${isToday(d) ? 'is-today' : ''}`}>
                          {edit ? <CellInput label={`${metric === 'msg' ? 'Conversations' : 'Dépense'} boost ${b.slot} ${dd(d)}`} decimal={metric === 'spend'} today={isToday(d)} missing={!r}
                            value={r ? (metric === 'msg' ? r.messages : r.spend) : undefined} placeholder={prev ? String(metric === 'msg' ? prev.messages : prev.spend) : isToday(d) ? 'à saisir' : ''}
                            onCommit={(v) => (metric === 'msg' ? saveReading(b.id, d, v, undefined) : saveReading(b.id, d, r?.messages ?? prev?.messages ?? (v == null ? undefined : 0), v))} />
                            : <span className="num">{r ? (metric === 'msg' ? fmtNum(r.messages) : usd(r.spend)) : <span className="muted small">à saisir</span>}</span>}
                          {r && delta != null && (stats[shownDays.indexOf(d)].starts.has(b.id)
                            ? <div className="bw-delta muted" title="Première saisie d’un boost déjà en cours : point de départ, rien n’est compté ce jour-là">départ</div>
                            : <div className={`bw-delta ${delta > 0 ? 'pos' : 'muted'}`}>{metric === 'msg' ? signed(delta) : `+${usd(delta)}`}</div>)}
                        </td>
                      );
                    })}
                    <td className="t-num"><strong className={dl ? 'pos' : 'muted'}>{dl == null ? '—' : metric === 'msg' ? signed(dl) : usd(dl)}</strong></td>
                    <td className="t-num"><strong>{metric === 'msg' ? fmtNum(tot) : usd(tot)}</strong></td>
                    {edit && <td className="t-actions"><div className="row" style={{ gap: 2, flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                      <IconButton icon="edit" label={`Modifier le boost ${b.slot}`} onClick={() => setForm(b)} />
                      {paused ? <IconButton icon="play" label={`Reprendre le boost ${b.slot}`} onClick={async () => { await resumeBoost(b, today); toast('Boost repris'); }} />
                        : <IconButton icon="pause" label={`Mettre en pause le boost ${b.slot}`} onClick={() => setPause(b)} />}
                      <IconButton icon="trash" label={`Supprimer le boost ${b.slot}`} onClick={() => setDel(b)} />
                    </div></td>}
                  </tr>
                );
              })}
              <tr className="synth-total"><td className="bw-slot"></td><td className="bw-name">Total nouvelles conversations</td>{stats.map((s, i) => <td key={i} className={`t-num ${isToday(shownDays[i]) ? 'is-today' : ''}`}>{shownDays[i] > today ? '·' : s.entered ? fmtNum(s.theo) : '—'}</td>)}<td className="t-num">{fmtNum(stats[shownDays.indexOf(last)]?.theo ?? 0)}</td><td className="t-num">{fmtNum(msgW)}</td>{edit && <td></td>}</tr>
              <tr className="bw-entry"><td className="bw-slot"></td><td className="bw-name">Compte saisi le <span className="small muted">(heure, par)</span></td>{shownDays.map((d) => { const e = lastEntry(pageId, d); const miss = d <= today ? missingBoosts(pageId, d).length : 0; const late = miss > 0 && new Date() > boostDeadline(d);
                return <td key={d} className={`small ${isToday(d) ? 'is-today' : ''}`}>{e ? <span title={new Date(e.at).toLocaleString('fr-FR')}>{new Date(e.at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}{e.by ? <><br /><span className="muted">{e.by}</span></> : null}</span> : d > today ? '·' : null}{miss > 0 && <div className={late ? 'neg' : 'muted'}>{late ? 'en retard' : `avant ${deadlineText(d)}`}</div>}</td>; })}<td></td><td></td>{edit && <td></td>}</tr>
              <tr><td className="bw-slot"></td><td className="bw-name">Messages réels comptés <span className="small muted">(facultatif)</span></td>{shownDays.map((d, i) => <td key={d} className={`bw-day ${isToday(d) ? 'is-today' : ''}`}>{d > today ? <span className="muted">·</span> : edit ? <CellInput label={`Messages réels ${dd(d)}`} value={stats[i].real} onCommit={(v) => saveReal(pageId, d, v)} /> : <span className="num">{stats[i].real ?? '—'}</span>}</td>)}<td className="t-num">{stats[shownDays.indexOf(last)]?.real ?? '—'}</td><td className="t-num">{realW || '—'}</td>{edit && <td></td>}</tr>
              <tr><td className="bw-slot"></td><td className="bw-name">Commandes en ligne</td>{stats.map((s, i) => <td key={i} className="t-num">{shownDays[i] > today ? '·' : fmtNum(s.orders)}</td>)}<td className="t-num">{fmtNum(stats[shownDays.indexOf(last)]?.orders ?? 0)}</td><td className="t-num">{fmtNum(ordersW)}</td>{edit && <td></td>}</tr>
              <tr className="synth-total"><td className="bw-slot"></td><td className="bw-name">Chiffre d’affaires</td>{shownDays.map((d) => <td key={d} className="t-num small">{d > today ? '·' : fmtAr(rev.get(d) ?? 0)}</td>)}<td className="t-num small">{fmtAr(rev.get(last) ?? 0)}</td><td className="t-num">{fmtAr(revW)}</td>{edit && <td></td>}</tr>
              <tr><td className="bw-slot"></td><td className="bw-name">CA par conversation</td>{stats.map((s, i) => <td key={i} className="t-num small">{s.theo ? fmtAr((rev.get(shownDays[i]) ?? 0) / s.theo) : '—'}</td>)}<td className="t-num small">{stats[shownDays.indexOf(last)]?.theo ? fmtAr((rev.get(last) ?? 0) / stats[shownDays.indexOf(last)].theo) : '—'}</td><td className="t-num">{msgW ? fmtAr(revW / msgW) : '—'}</td>{edit && <td></td>}</tr>
              <tr><td className="bw-slot"></td><td className="bw-name">Dépense</td>{stats.map((s, i) => <td key={i} className="t-num small">{s.entered ? usd(s.spend) : '—'}</td>)}<td className="t-num small">{usd(stats[shownDays.indexOf(last)]?.spend ?? 0)}</td><td className="t-num small">{usd(spendW)}</td>{edit && <td></td>}</tr>
            </tbody>
          </table></div>
        )}
      </div>
      {form && <BoostForm pageId={pageId} boost={form === 'new' ? undefined : form} date={today} onClose={() => setForm(null)} />}
      {pause && <PauseModal boost={pause} onClose={() => setPause(null)} />}
      {del && <Confirm title={`Supprimer ${boostName(del)}`} danger confirmLabel="Supprimer le boost"
        message={<p>Le boost et ses {readingsOf(del.id).length} saisie(s) seront supprimés. À faire seulement pour un boost qui ne sert plus (sinon, mettez-le en pause : son historique reste).</p>}
        onClose={() => setDel(null)} onConfirm={async () => { await deleteBoost(del); toast('Boost supprimé'); }} />}
    </>
  );
}

function BoostForm({ pageId, boost, date, onClose }: { pageId: string; boost?: Boost; date: string; onClose: () => void }) {
  const [label, setLabel] = useState(boost?.label ?? '');
  const [start, setStart] = useState(boost?.startDate ?? date);
  const [budget, setBudget] = useState(boost?.dailyBudget != null ? String(boost.dailyBudget).replace('.', ',') : '1');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={boost ? `Modifier le boost n° ${boost.slot}` : `Nouveau boost — ${pageName(pageId)}`} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button busy={busy} disabled={!start} onClick={async () => {
        setBusy(true);
        try {
          const d = { label: label.trim() || undefined, startDate: start, dailyBudget: parseNum(budget) };
          if (boost) await updateBoost(boost, d); else await createBoost({ pageId, ...d });
          toast(boost ? 'Boost modifié' : 'Boost ajouté à la fin de la liste'); onClose();
        } catch (e: any) { toast(e.message, 'error'); } finally { setBusy(false); }
      }}>{boost ? 'Enregistrer' : 'Ajouter le boost'}</Button></>}>
      <div className="stack">
        <TextField label="Texte de la publicité (pour la reconnaître)" value={label} onChange={setLabel} placeholder="Ex. SUPER PROMOTION pyjamas" />
        <div className="grid-2">
          <TextField label="Date de lancement" type="date" required value={start} onChange={setStart} max={todayYmd()} />
          <TextField label="Budget par jour ($)" value={budget} onChange={setBudget} inputMode="decimal" />
        </div>
        {!boost && <p className="small muted">Le boost est ajouté à la fin de la liste ; glissez-le ensuite à sa place (même ordre que l’Espace Pubs).</p>}
      </div>
    </Modal>
  );
}

function PauseModal({ boost, onClose }: { boost: Boost; onClose: () => void }) {
  const [reason, setReason] = useState(STOP_REASONS[0]);
  return (
    <Modal title={`Mettre en pause ${boostName(boost)}`} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button onClick={async () => { await pauseBoost(boost, todayYmd(), reason); toast('Boost en pause'); onClose(); }}>Mettre en pause</Button></>}>
      <div className="stack">
        <p className="small">À faire quand le boost est mis en pause dans l’Espace Pubs. La case d’aujourd’hui reste à remplir ; à partir de demain il n’est plus demandé. « Reprendre » le remet en route quand vous voulez.</p>
        <SelectField label="Raison" value={reason} onChange={setReason} options={STOP_REASONS.map((r) => ({ value: r, label: r }))} />
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- Toutes les pages
function AllPagesTable({ pageIds, days, onPick }: { pageIds: string[]; days: string[]; onPick: (id: string) => void }) {
  const today = todayYmd();
  const last = days.filter((d) => d <= today).pop() ?? days[0];
  const rev = useRevenue(days[0], last);
  type Row = { id: string; name: string; active: number; daily: number[]; msgs: number; revenue: number; orders: number; spend: number };
  const rows: Row[] = pageIds.map((id) => {
    const st = days.map((d) => dayStats(id, d));
    const r = rev.get(id);
    return { id, name: pageName(id), active: activeBoosts(id, last).length, daily: st.map((s) => s.theo), msgs: st.reduce((t, s) => t + s.theo, 0), revenue: days.reduce((t, d) => t + (r?.get(d) ?? 0), 0), orders: st.reduce((t, s) => t + s.orders, 0), spend: st.reduce((t, s) => t + s.spend, 0) };
  }).filter((r) => r.msgs || r.active || r.revenue || r.orders);
  const cols: Col<Row>[] = [
    { key: 'n', label: 'Page', value: (r) => r.name, render: (r) => <button type="button" className="link-btn" onClick={() => onPick(r.id)}>{r.name}</button> },
    { key: 'a', label: 'Boosts actifs', value: (r) => r.active, num: true, total: true },
    { key: 'm', label: 'Conversations', value: (r) => r.msgs, num: true, total: true },
    { key: 'c', label: 'Chiffre d’affaires', value: (r) => Math.round(r.revenue), money: true, num: true, total: true },
    { key: 'cm', label: 'CA / conversation', value: (r) => (r.msgs ? Math.round(r.revenue / r.msgs) : 0), money: true, num: true, total: (rs) => { const m = rs.reduce((t, r) => t + r.msgs, 0); return m ? fmtAr(rs.reduce((t, r) => t + r.revenue, 0) / m) : '—'; } },
    { key: 'o', label: 'Commandes', value: (r) => r.orders, num: true, total: true },
    { key: 's', label: 'Dépense ($)', value: (r) => Math.round(r.spend * 100) / 100, num: true, total: true },
    { key: 'sc', label: 'Coût / conversation', value: (r) => (r.msgs ? Math.round((r.spend / r.msgs) * 100) / 100 : 0), num: true, render: (r) => (r.msgs ? usd(r.spend / r.msgs) : '—') },
  ];
  return (
    <>
      <div className="card card-flush">
        <div className="card-pad row-between"><div><h2>Toutes les pages</h2><p className="small muted">Combien de conversations, et combien elles rapportent. Touchez une page pour saisir ses boosts.</p></div><Button variant="ghost" className="btn-sm" icon="download" onClick={() => exportTables(`boosts_pages_${days[0]}.xlsx`, [{ name: 'Pages', cols, rows }])}>Excel</Button></div>
        <SortTable cols={cols} rows={rows} rowKey={(r) => r.id} initialSort={{ key: 'm', desc: true }} empty="Aucune saisie sur cette période." />
      </div>
      <div className="card card-flush">
        <div className="card-pad"><h2>Conversations par jour</h2></div>
        <div className="table-wrap"><table className="table week-table">
          <thead><tr><th>Page</th>{days.map((d) => <th key={d} className="t-num">{d === today ? 'Aujourd’hui' : dayShort(d)}</th>)}<th className="t-num">Total</th></tr></thead>
          <tbody>
            {rows.map((r) => <tr key={r.id}><td>{r.name}</td>{r.daily.map((n, i) => <td key={i} className="t-num">{days[i] > today ? '·' : fmtNum(n)}</td>)}<td className="t-num"><strong>{fmtNum(r.msgs)}</strong></td></tr>)}
            <tr className="synth-total"><td>Total</td>{days.map((d, i) => <td key={d} className="t-num">{d > today ? '·' : fmtNum(rows.reduce((t, r) => t + r.daily[i], 0))}</td>)}<td className="t-num">{fmtNum(rows.reduce((t, r) => t + r.msgs, 0))}</td></tr>
          </tbody>
        </table></div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- Performance
function Performance() {
  const pg = usePage(true);
  const per = usePeriodBar();
  const today = todayYmd();
  const from = per.from, to = per.to > today ? today : per.to;
  const span = `${per.days.filter((d) => d <= today).length}`;
  const rows = useMemo(() => boostPerformance(from, to, pg.pageId || undefined).filter((r) => !pg.scope.on || pg.scope.pages.includes(r.b.pageId)), [from, to, pg.pageId, pg.scope.on]);
  const order: Record<string, number> = { bad: 0, average: 1, good: 2, new: 3, none: 4 };
  const active = rows.filter((r) => r.b.status === 'active').sort((a, b) => order[a.verdict] - order[b.verdict] || (b.cost ?? 0) - (a.cost ?? 0));
  const stopped = rows.filter((r) => r.b.status !== 'active');
  const cols: Col<BoostPerf>[] = [
    { key: 'p', label: 'Page', value: (r) => pageName(r.b.pageId), hide: !!pg.pageId },
    { key: 'n', label: 'Boost', value: (r) => r.b.slot, render: (r) => <><span className="slot-badge">{r.b.slot}</span> {r.b.label || ''}<div className="small muted">lancé le {dd(r.b.startDate)} · {r.days} j{r.b.status !== 'active' ? ' · en pause' : ''}</div></> },
    { key: 'm', label: `Messages théo. (${span} j)`, value: (r) => r.messages, num: true, total: true },
    { key: 's', label: `Dépense (${span} j)`, value: (r) => Math.round(r.spend * 100) / 100, num: true, total: (rs) => usd(rs.reduce((t, r) => t + r.spend, 0)), render: (r) => usd(r.spend) },
    { key: 'c', label: 'Coût / message', value: (r) => (r.cost == null ? 9999 : Math.round(r.cost * 100) / 100), num: true, render: (r) => usd(r.cost), total: (rs) => { const m = rs.reduce((t, r) => t + r.messages, 0); return m ? usd(rs.reduce((t, r) => t + r.spend, 0) / m) : '—'; } },
    { key: 'l', label: '3 derniers jours', value: (r) => r.last3, num: true },
    { key: 'tt', label: 'Depuis le lancement', value: (r) => r.totalMessages, num: true, render: (r) => <span className="small">{r.totalMessages} msg · {usd(r.totalSpend)}</span> },
    { key: 'v', label: 'Avis', value: (r) => order[r.verdict], render: (r) => <div><Badge tone={VERDICT[r.verdict].tone}>{VERDICT[r.verdict].label}</Badge>{r.advice && <div className="small muted" style={{ maxWidth: 280 }}>{r.advice}</div>}</div> },
  ];
  const bad = active.filter((r) => r.verdict === 'bad');
  return (
    <div className="stack">
      <div className="card boost-filters">
        <div className="boost-page-field"><SelectField label="Page" value={pg.pageId} onChange={pg.set} options={pg.options} /></div>
        {per.bar}
      </div>
      {bad.length > 0 && <div className="notice notice-danger"><Icon name="alert" /><span><strong>{bad.length} boost(s) peu performant(s)</strong> : {bad.map((r) => `${pg.pageId ? '' : pageName(r.b.pageId) + ' '}n° ${r.b.slot}`).join(', ')}. Pensez à les mettre en pause (ou les supprimer) dans « Saisie et suivi », et à lancer un nouveau boost à la place.</span></div>}
      <div className="card card-flush">
        <div className="card-pad row-between"><div><h2>Boosts actifs</h2><p className="small muted">Du {dd(from)} au {dd(to)}. Les plus faibles en premier.</p></div><Button variant="ghost" icon="download" onClick={() => exportTables(`performance_boosts_${to}.xlsx`, [{ name: 'Boosts', cols: [...cols.filter((c) => !c.hide), { key: 'x', label: 'Conseil', value: (r: BoostPerf) => r.advice, width: 50 }], rows: [...active, ...stopped] }])}>Excel</Button></div>
        <SortTable cols={cols} rows={active} rowKey={(r) => r.b.id} empty="Aucun boost actif sur la période." />
      </div>
      {stopped.length > 0 && <div className="card card-flush"><div className="card-pad"><h2>Boosts en pause</h2></div><SortTable cols={cols} rows={stopped} rowKey={(r) => r.b.id} /></div>}
      <div className="card small muted stack-s">
        <strong>Comment l’avis est calculé</strong>
        <p>Pour chaque boost : coût par message = dépense ÷ nouveaux messages théoriques sur la période. Il est comparé au coût moyen des boosts de la même page (ou de toutes les pages s’il est seul).</p>
        <p><Badge tone="ok">Bon</Badge> au moins 20 % moins cher que la moyenne · <Badge tone="warn">Moyen</Badge> proche de la moyenne · <Badge tone="danger">Faible</Badge> au moins 30 % plus cher, ou aucun message depuis 3 jours, ou des dépenses sans message · <Badge tone="brand">Trop récent</Badge> moins de 3 saisies.</p>
        <p>L’écart réel − théorique se lit par page (onglet Semaine) : Meta compte les conversations ouvertes grâce à la pub, le réel compte tous les messages reçus.</p>
      </div>
    </div>
  );
}
