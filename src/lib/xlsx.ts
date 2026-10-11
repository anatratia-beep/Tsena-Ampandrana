// Lecture et création de fichiers Excel (.xlsx) directement dans le navigateur, sans connexion.
import { compressPhoto } from './images';
import JSZip from 'jszip';

export type Cell = string | number | boolean | null;
export interface SheetImage { row: number; col: number; blob: Blob }
export interface Sheet {
  name: string;
  /** rows[r][c], indices à partir de 0. */
  rows: Cell[][];
  merges: { r1: number; c1: number; r2: number; c2: number }[];
  images: SheetImage[];
}

const parseXml = (txt: string) => new DOMParser().parseFromString(txt, 'application/xml');
const byTag = (el: Document | Element, name: string) => Array.from(el.getElementsByTagNameNS('*', name));

export function colIndex(letters: string) {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
export function colLetter(i: number) {
  let s = '';
  i += 1;
  while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
}
function parseRef(ref: string) {
  const m = /^([A-Z]+)(\d+)$/i.exec(ref)!;
  return { c: colIndex(m[1]), r: parseInt(m[2], 10) - 1 };
}
function resolvePath(base: string, target: string) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/');
  parts.pop();
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}
async function rels(zip: JSZip, path: string): Promise<Record<string, string>> {
  const dir = path.split('/').slice(0, -1).join('/');
  const file = zip.file(`${dir}/_rels/${path.split('/').pop()}.rels`);
  if (!file) return {};
  const doc = parseXml(await file.async('text'));
  const out: Record<string, string> = {};
  for (const r of byTag(doc, 'Relationship')) out[r.getAttribute('Id')!] = resolvePath(path, r.getAttribute('Target')!);
  return out;
}

/**
 * Fichier .xlsx coupé (téléchargement interrompu, export Google Sheets trop lourd à cause des photos) :
 * la table des matières de fin manque. On relit les morceaux complets un par un et on reconstruit la table,
 * pour récupérer tout ce qui est lisible (les lignes, et les photos arrivées avant la coupure).
 */
export function repairZip(buf: ArrayBuffer): { data: Uint8Array; entries: number } | null {
  const d = new Uint8Array(buf); const dv = new DataView(buf);
  const sig = (i: number, a: number, b: number) => d[i] === 0x50 && d[i + 1] === 0x4b && d[i + 2] === a && d[i + 3] === b;
  const find = (from: number, a: number, b: number) => { for (let i = from; i < d.length - 3; i++) if (sig(i, a, b)) return i; return -1; };
  const cd: number[] = []; let end = 0; let count = 0;
  const push32 = (n: number) => cd.push(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255);
  const push16 = (n: number) => cd.push(n & 255, (n >>> 8) & 255);
  let pos = 0;
  while (pos < d.length - 30 && sig(pos, 3, 4)) {
    const flags = dv.getUint16(pos + 6, true), method = dv.getUint16(pos + 8, true), time = dv.getUint16(pos + 10, true), date = dv.getUint16(pos + 12, true);
    let crc = dv.getUint32(pos + 14, true), csz = dv.getUint32(pos + 18, true), usz = dv.getUint32(pos + 22, true);
    const nl = dv.getUint16(pos + 26, true), el = dv.getUint16(pos + 28, true);
    const start = pos + 30 + nl + el;
    let next = -1;
    if (flags & 8) {
      // Taille connue seulement après les données (descripteur PK 07 08) : on cherche le descripteur qui correspond.
      let j = find(start, 7, 8);
      while (j >= 0 && j + 16 <= d.length && dv.getUint32(j + 8, true) !== j - start) j = find(j + 1, 7, 8);
      if (j < 0 || j + 16 > d.length) break;
      crc = dv.getUint32(j + 4, true); csz = dv.getUint32(j + 8, true); usz = dv.getUint32(j + 12, true); next = j + 16;
    } else { next = start + csz; if (next > d.length) break; }
    push32(0x02014b50); push16(20); push16(dv.getUint16(pos + 4, true)); push16(flags); push16(method); push16(time); push16(date);
    push32(crc); push32(csz); push32(usz); push16(nl); push16(0); push16(0); push16(0); push16(0); push32(0); push32(pos);
    for (let k = 0; k < nl; k++) cd.push(d[pos + 30 + k]);
    count++; end = next; pos = next;
  }
  if (!count) return null;
  const out = new Uint8Array(end + cd.length + 22);
  out.set(d.subarray(0, end), 0); out.set(cd, end);
  const e = new DataView(out.buffer, end + cd.length);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, count, true); e.setUint16(10, count, true); e.setUint32(12, cd.length, true); e.setUint32(16, end, true);
  return { data: out, entries: count };
}

const mimeOf = (path: string) => { const ext = path.split('.').pop()!.toLowerCase(); return ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg'; };

/**
 * Images « dans la cellule » : Excel 365 / Google Sheets (« Insérer une image dans la cellule », données riches)
 * et WPS (formule DISPIMG). Renvoie une fonction : n° de métadonnée (vm) ou identifiant DISPIMG → chemin de l'image.
 */
async function cellImageIndex(zip: JSZip) {
  const byVm = new Map<number, string>();
  const byId = new Map<string, string>();
  try {
    const rvRelFile = zip.file('xl/richData/richValueRel.xml');
    const rvFile = zip.file('xl/richData/rdrichvalue.xml');
    if (rvRelFile && rvFile) {
      const relIds = byTag(parseXml(await rvRelFile.async('text')), 'rel').map((r) => r.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || r.getAttribute('r:id') || '');
      const relMap = await rels(zip, 'xl/richData/richValueRel.xml');
      const stFile = zip.file('xl/richData/rdrichvaluestructure.xml');
      const structs = stFile ? byTag(parseXml(await stFile.async('text')), 's').map((st) => byTag(st, 'k').map((k) => k.getAttribute('n') || '')) : [];
      const rvs = byTag(parseXml(await rvFile.async('text')), 'rv').map((rv) => {
        const vals = byTag(rv, 'v').map((v) => v.textContent ?? '');
        const keys = structs[Number(rv.getAttribute('s') || 0)] ?? [];
        const k = keys.indexOf('_rvRel:LocalImageIdentifier');
        const rel = Number(vals[k >= 0 ? k : 0]);
        return relMap[relIds[rel]];
      });
      // vm (1, 2…) → valueMetadata → futureMetadata (rvb i) → valeur riche ; sinon correspondance directe.
      const mdFile = zip.file('xl/metadata.xml');
      let vmToRv: number[] = [];
      if (mdFile) {
        const md = parseXml(await mdFile.async('text'));
        const future = byTag(md, 'futureMetadata').find((f) => f.getAttribute('name') === 'XLRICHVALUE');
        const rvb = future ? byTag(future, 'bk').map((bk) => Number(byTag(bk, 'rvb')[0]?.getAttribute('i') ?? -1)) : [];
        const vmBlock = byTag(md, 'valueMetadata')[0];
        vmToRv = vmBlock ? byTag(vmBlock, 'bk').map((bk) => { const v = Number(byTag(bk, 'rc')[0]?.getAttribute('v') ?? -1); return rvb[v] ?? v; }) : [];
      }
      rvs.forEach((_, i) => { const idx = vmToRv.length ? vmToRv[i] : i; if (idx != null && rvs[idx]) byVm.set(i + 1, rvs[idx]); });
    }
    const ci = zip.file('xl/cellimages.xml');
    if (ci) {
      const doc = parseXml(await ci.async('text'));
      const relMap = await rels(zip, 'xl/cellimages.xml');
      for (const pic of byTag(doc, 'pic')) {
        const name = byTag(pic, 'cNvPr')[0]?.getAttribute('name');
        const blip = byTag(pic, 'blip')[0];
        const embed = blip && (blip.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed') || blip.getAttribute('r:embed'));
        if (name && embed && relMap[embed]) byId.set(name, relMap[embed]);
      }
    }
  } catch { /* images dans les cellules illisibles : on continue sans */ }
  return { byVm, byId };
}

/** Lit toutes les feuilles d'un classeur : valeurs (résultats des formules), cellules fusionnées, photos. */
export async function readXlsx(data: ArrayBuffer | Blob, opts: { images?: boolean } = {}): Promise<Sheet[]> {
  const buf = data instanceof Blob ? await data.arrayBuffer() : data;
  const b = new Uint8Array(buf.slice(0, 8));
  const txt = new TextDecoder().decode(new Uint8Array(buf.slice(0, 200))).trim().toLowerCase();
  if (!buf.byteLength) throw new Error('Le fichier est vide (0 octet). S’il vient de Google Drive / iCloud, attendez la fin du téléchargement ou téléchargez-le de nouveau, puis réessayez.');
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) throw new Error('Ce fichier est au format Excel ancien (.xls) ou protégé par un mot de passe. Ouvrez-le dans Excel ou Google Sheets, retirez le mot de passe si besoin, puis « Enregistrer sous / Télécharger » au format Classeur Excel (.xlsx), et importez ce nouveau fichier.');
  if (txt.startsWith('<') || txt.includes('<html')) throw new Error('Ce fichier n’est pas un vrai fichier Excel (c’est une page web enregistrée). Dans Google Sheets : Fichier → Télécharger → Microsoft Excel (.xlsx), puis importez le fichier téléchargé.');
  if (!(b[0] === 0x50 && b[1] === 0x4b)) throw new Error(`Ce fichier n’est pas un classeur Excel (.xlsx)${/[;,\t]/.test(txt) ? ' (on dirait un fichier CSV / texte)' : ''}. Ouvrez-le dans Excel ou Google Sheets puis enregistrez-le / téléchargez-le au format Microsoft Excel (.xlsx).`);
  let zip: JSZip;
  let repaired = false;
  try { zip = await JSZip.loadAsync(buf); }
  catch {
    const fixed = repairZip(buf);
    try { if (!fixed) throw new Error(); zip = await JSZip.loadAsync(fixed.data); repaired = true; }
    catch { throw new Error('Le fichier Excel est incomplet ou abîmé (téléchargement interrompu ?). Téléchargez-le de nouveau (Google Sheets : Fichier → Télécharger → Microsoft Excel .xlsx) et réessayez. Si cela recommence, envoyez-moi le fichier.'); }
  }
  const wbPath = 'xl/workbook.xml';
  const wbFile = zip.file(wbPath);
  if (!wbFile && repaired) throw new Error('Le fichier Excel est incomplet ou abîmé (coupé avant les lignes). Téléchargez-le de nouveau (Google Sheets : Fichier → Télécharger → Microsoft Excel .xlsx) et réessayez.');
  if (!wbFile) throw new Error("Ce fichier n'est pas un classeur Excel (.xlsx). Enregistrez-le au format « Classeur Excel ».");
  const wb = parseXml(await wbFile.async('text'));
  const wbRels = await rels(zip, wbPath);

  const shared: string[] = [];
  const ss = zip.file('xl/sharedStrings.xml');
  if (ss) {
    const doc = parseXml(await ss.async('text'));
    for (const si of byTag(doc, 'si')) shared.push(byTag(si, 't').map((t) => t.textContent ?? '').join(''));
  }

  const cellImgs = opts.images ? await cellImageIndex(zip) : { byVm: new Map<number, string>(), byId: new Map<string, string>() };
  let missingImages = 0;
  const sheets: Sheet[] = [];
  for (const s of byTag(wb, 'sheet')) {
    const rid = s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || s.getAttribute('r:id')!;
    const path = wbRels[rid];
    const file = path && zip.file(path);
    if (!file) continue;
    const doc = parseXml(await file.async('text'));
    const rows: Cell[][] = [];
    const inCell: { row: number; col: number; path: string }[] = [];
    for (const c of byTag(doc, 'c')) {
      const { r, c: col } = parseRef(c.getAttribute('r')!);
      const t = c.getAttribute('t');
      if (opts.images) {
        const vm = Number(c.getAttribute('vm') || 0);
        const pVm = vm ? cellImgs.byVm.get(vm) : undefined;
        const disp = /DISPIMG\(\s*"([^"]+)"/.exec(byTag(c, 'f')[0]?.textContent ?? '');
        const pId = disp ? cellImgs.byId.get(disp[1]) : undefined;
        if (pVm || pId) { inCell.push({ row: r, col, path: (pVm || pId)! }); continue; }
      }
      const v = byTag(c, 'v')[0]?.textContent ?? null;
      let val: Cell = null;
      if (t === 's') val = v == null ? null : shared[parseInt(v, 10)] ?? null;
      else if (t === 'inlineStr') val = byTag(c, 't').map((x) => x.textContent ?? '').join('');
      else if (t === 'str' || t === 'e') val = v;
      else if (t === 'b') val = v === '1';
      else if (v != null && v !== '') val = Number(v);
      if (val === '' ) val = null;
      if (val == null) continue;
      (rows[r] ||= [])[col] = val;
    }
    for (let i = 0; i < rows.length; i++) rows[i] ||= [];
    const merges = byTag(doc, 'mergeCell').map((m) => {
      const [a, b] = m.getAttribute('ref')!.split(':');
      const p1 = parseRef(a), p2 = parseRef(b || a);
      return { r1: p1.r, c1: p1.c, r2: p2.r, c2: p2.c };
    });

    const images: SheetImage[] = [];
    for (const ic of inCell) { const f = zip.file(ic.path); if (!f) { missingImages++; continue; } images.push({ row: ic.row, col: ic.col, blob: new Blob([await f.async('arraybuffer')], { type: mimeOf(ic.path) }) }); }
    if (opts.images) {
      const sRels = await rels(zip, path);
      for (const dEl of byTag(doc, 'drawing')) {
        const drawPath = sRels[dEl.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || dEl.getAttribute('r:id')!];
        const dFile = drawPath && zip.file(drawPath);
        if (!dFile) continue;
        const dDoc = parseXml(await dFile.async('text'));
        const dRels = await rels(zip, drawPath);
        const anchors = [...byTag(dDoc, 'twoCellAnchor'), ...byTag(dDoc, 'oneCellAnchor')];
        for (const a of anchors) {
          const from = byTag(a, 'from')[0];
          const blip = byTag(a, 'blip')[0];
          if (!from || !blip) continue;
          const embed = blip.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed') || blip.getAttribute('r:embed');
          const media = embed && dRels[embed] && zip.file(dRels[embed]);
          if (!media) { missingImages++; continue; }
          const row = parseInt(byTag(from, 'row')[0].textContent || '0', 10);
          const col = parseInt(byTag(from, 'col')[0].textContent || '0', 10);
          const ext = dRels[embed!].split('.').pop()!.toLowerCase();
          const type = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
          images.push({ row, col, blob: new Blob([await media.async('arraybuffer')], { type }) });
        }
      }
    }
    sheets.push({ name: s.getAttribute('name') || 'Feuille', rows, merges, images });
  }
  if (repaired) (sheets as Sheet[] & { repaired?: { missingImages: number } }).repaired = { missingImages };
  if (!sheets.length && repaired) throw new Error('Le fichier Excel est coupé avant les lignes : téléchargez-le de nouveau.');
  return sheets;
}

/** Recopie la valeur d'une cellule fusionnée dans toutes les cellules de la fusion. */
export function fillMerged(sheet: Sheet) {
  for (const m of sheet.merges) {
    const v = sheet.rows[m.r1]?.[m.c1];
    if (v == null) continue;
    for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) (sheet.rows[r] ||= [])[c] = v;
  }
}

/** Date Excel (nombre de jours) → AAAA-MM-JJ. */
export function excelDate(n: Cell): string | undefined {
  if (typeof n !== 'number' || n < 20000 || n > 80000) return undefined;
  const d = new Date(Math.round((n - 25569) * 86400000));
  return d.toISOString().slice(0, 10);
}

/** Normalise un titre de colonne pour le reconnaître (minuscules, sans accents ni ponctuation). */
export function normHeader(s: Cell) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim();
}

// ---------- Création d'un classeur ----------
export interface OutSheet {
  name: string;
  columns: { header: string; width?: number; input?: boolean; number?: boolean }[];
  rows: Cell[][];
  /** Lignes de texte libre (feuille d'explication). */
  notes?: string[];
  /** Listes déroulantes : colonne (0 = A), lignes concernées (1 = 1re ligne de données), formule (ex. Listes!$A$2:$A$9). */
  lists?: { col: number; rows: number; formula: string }[];
  hidden?: boolean;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function sheetXml(s: OutSheet) {
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">');
  if (s.columns.length) out.push('<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>');
  const widths = s.columns.length ? s.columns.map((c) => c.width ?? 14) : [110];
  out.push('<cols>' + widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols><sheetData>');
  const cell = (r: number, c: number, v: Cell, style: number) => {
    const ref = colLetter(c) + (r + 1);
    if (v == null || v === '') return style ? `<c r="${ref}" s="${style}"/>` : '';
    if (typeof v === 'number') return `<c r="${ref}" s="${style}"><v>${v}</v></c>`;
    return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
  };
  let r = 0;
  if (s.columns.length) {
    out.push(`<row r="1">${s.columns.map((c, i) => cell(0, i, c.header, 1)).join('')}</row>`);
    r = 1;
    for (const row of s.rows) {
      out.push(`<row r="${r + 1}">${s.columns.map((c, i) => cell(r, i, row[i] ?? null, c.input ? 2 : c.number ? 3 : 0)).join('')}</row>`);
      r++;
    }
  }
  for (const n of s.notes ?? []) { out.push(`<row r="${r + 1}">${cell(r, 0, n.replace(/^#/, ''), n.startsWith('#') ? 4 : 0)}</row>`); r++; }
  out.push('</sheetData>');
  if (s.lists?.length) {
    out.push(`<dataValidations count="${s.lists.length}">`);
    for (const l of s.lists) out.push(`<dataValidation type="list" allowBlank="1" showErrorMessage="1" errorTitle="Valeur inconnue" error="Choisissez une valeur dans la liste (ou ajoutez-la d'abord dans Trésor en ligne)." sqref="${colLetter(l.col)}2:${colLetter(l.col)}${l.rows + 1}"><formula1>${esc(l.formula)}</formula1></dataValidation>`);
    out.push('</dataValidations>');
  }
  out.push('</worksheet>');
  return out.join('');
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF17695A"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/></patternFill></fill></fills>
<borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs>
<cellXfs count="5"><xf fontId="0"/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/><xf fontId="0" fillId="3" applyFill="1"/><xf fontId="0" numFmtId="3" applyNumberFormat="1"/><xf fontId="2" applyFont="1"/></cellXfs>
</styleSheet>`;

/** Crée un fichier .xlsx (en-têtes verts, colonnes à remplir en jaune). */
export async function writeXlsx(sheets: OutSheet[]): Promise<Blob> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name.slice(0, 31))}" sheetId="${i + 1}"${s.hidden ? ' state="hidden"' : ''} r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file('xl/styles.xml', STYLES);
  sheets.forEach((s, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)));
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

/** Réduit une photo (Blob) pour la stocker légèrement dans la fiche article. */
/** Photo d'article : même traitement partout (voir images.ts). */
export function blobToThumb(blob: Blob, _max?: number): Promise<string> {
  return compressPhoto(blob);
}
