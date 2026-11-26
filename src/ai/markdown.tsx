// Petit rendu Markdown pour les réponses de l'assistant (titres, gras, italique, code, listes, tableaux, liens).
// Construit des éléments React (jamais de HTML injecté) : sûr même si le texte vient du modèle.
import type { ReactNode } from 'react';

function inline(text: string, key = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`|\*([^*\s][^*]*)\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/g;
  let last = 0, m: RegExpExecArray | null, n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${n++}`;
    if (m[2] || m[3]) out.push(<strong key={k}>{inline(m[2] || m[3], k)}</strong>);
    else if (m[4]) out.push(<code key={k}>{m[4]}</code>);
    else if (m[5]) out.push(<em key={k}>{inline(m[5], k)}</em>);
    else if (m[6]) out.push(<a key={k} href={m[7]} target="_blank" rel="noopener noreferrer">{m[6]}</a>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (row: string) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
const isSep = (row: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(row);

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, '').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0, b = 0;
  while (i < lines.length) {
    const line = lines[i];
    const k = `b${b++}`;
    if (!line.trim()) { i++; continue; }
    if (line.startsWith('```')) {
      const code: string[] = []; i++;
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
      i++; blocks.push(<pre key={k}><code>{code.join('\n')}</code></pre>); continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { blocks.push(h[1].length <= 2 ? <h4 key={k}>{inline(h[2], k)}</h4> : <h5 key={k}>{inline(h[2], k)}</h5>); i++; continue; }
    if (line.includes('|') && i + 1 < lines.length && isSep(lines[i + 1])) {
      const head = cells(line); i += 2;
      const body: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) body.push(cells(lines[i++]));
      const num = (s: string) => /^[-+]?[\d\s  .,]+(\s?(Ar|%|\$|h))?$/.test(s);
      blocks.push(
        <div key={k} className="md-table"><table>
          <thead><tr>{head.map((c, j) => <th key={j}>{inline(c, `${k}h${j}`)}</th>)}</tr></thead>
          <tbody>{body.map((r, ri) => <tr key={ri}>{head.map((_, j) => <td key={j} className={num(r[j] ?? '') ? 'num' : undefined}>{inline(r[j] ?? '', `${k}${ri}${j}`)}</td>)}</tr>)}</tbody>
        </table></div>,
      );
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
        let it = lines[i++].replace(/^\s*([-*•]|\d+[.)])\s+/, '');
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) it += ' ' + lines[i++].trim();
        items.push(it);
      }
      const L = ordered ? 'ol' : 'ul';
      blocks.push(<L key={k}>{items.map((it, j) => <li key={j}>{inline(it, `${k}${j}`)}</li>)}</L>);
      continue;
    }
    if (/^\s*>/.test(line)) { const q: string[] = []; while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, '')); blocks.push(<blockquote key={k}>{inline(q.join(' '), k)}</blockquote>); continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { blocks.push(<hr key={k} />); i++; continue; }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\s*([-*•]|\d+[.)])\s+|\s*>)/.test(lines[i]) && !(lines[i].includes('|') && i + 1 < lines.length && isSep(lines[i + 1]))) para.push(lines[i++]);
    blocks.push(<p key={k}>{para.flatMap((p, j) => (j ? [<br key={`${k}br${j}`} />, ...inline(p, `${k}${j}`)] : inline(p, `${k}${j}`)))}</p>);
  }
  return <div className="md">{blocks}</div>;
}
