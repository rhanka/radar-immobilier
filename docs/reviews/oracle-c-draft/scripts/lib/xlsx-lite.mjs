// Zero-dependency, read-only XLSX reader (ZIP central directory + inflateRaw + regex XML).
// Scope: shared strings, inline strings and plain values of visible worksheets. No formulas evaluated.
import { inflateRawSync } from 'node:zlib';

function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('xlsx-lite: end of central directory not found');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('xlsx-lite: bad central directory entry');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const lNameLen = buf.readUInt16LE(local + 26);
    const lExtraLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + csize);
    files.set(name, () => (method === 0 ? raw : inflateRawSync(raw)).toString('utf8'));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const decode = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&amp;/g, '&');

const textOf = (xml) => {
  let out = '';
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)) out += decode(m[1] ?? '');
  return out;
};

const colIndex = (ref) => {
  const letters = ref.match(/^[A-Z]+/)[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
};
export const colLetter = (n) => { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };

/** Returns { sheets: [{ name, rows: Map<rowNumber, Map<colLetter, string>> }] } */
export function readXlsx(buf) {
  const files = unzip(buf);
  const get = (n) => { const f = files.get(n); return f ? f() : null; };
  const shared = [];
  const sst = get('xl/sharedStrings.xml');
  if (sst) for (const m of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1]));
  const wb = get('xl/workbook.xml');
  const rels = get('xl/_rels/workbook.xml.rels');
  const relMap = new Map();
  for (const m of rels.matchAll(/<Relationship\s[^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"/g)) relMap.set(m[1], m[2]);
  for (const m of rels.matchAll(/<Relationship\s[^>]*?Target="([^"]+)"[^>]*?Id="([^"]+)"/g)) relMap.set(m[2], m[1]);
  const sheets = [];
  for (const m of wb.matchAll(/<sheet\s([^>]*?)\/>/g)) {
    const attrs = m[1];
    const name = decode(attrs.match(/name="([^"]*)"/)[1]);
    const rid = attrs.match(/r:id="([^"]*)"/)[1];
    const target = relMap.get(rid);
    const file = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    const xml = get(file);
    const rows = new Map();
    for (const rm of xml.matchAll(/<row\s[^>]*?r="(\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const cells = new Map();
      for (const cm of (rm[2] ?? '').matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = cm[1].match(/r="([A-Z]+\d+)"/)[1];
        const type = cm[1].match(/t="([^"]+)"/)?.[1] ?? 'n';
        const inner = cm[2] ?? '';
        let value = null;
        if (type === 's') { const v = inner.match(/<v>([\s\S]*?)<\/v>/); value = v ? shared[Number(v[1])] : null; }
        else if (type === 'inlineStr') value = textOf(inner);
        else { const v = inner.match(/<v>([\s\S]*?)<\/v>/); value = v ? decode(v[1]) : null; }
        if (value !== null && value !== '') cells.set(colLetter(colIndex(ref)), value);
      }
      rows.set(Number(rm[1]), cells);
    }
    sheets.push({ name, rows });
  }
  return { sheets };
}
