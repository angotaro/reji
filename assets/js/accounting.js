// Sales as journal entries for accounting software. One entry per sale and tax rate:
// debit = where the JPYC was received, credit = sales. Layouts follow each product's published import format.
import { computeTotals } from './tax.js';

export const ACCT_FORMATS = ['raw', 'yayoi', 'freee', 'mf'];
export const ACCT_DEFAULTS = { debit: '電子決済手段', credit: '売上高' };

// How each product names the tax category of a sale (prices as paid, tax included).
const TAX = {
  yayoi: { 10: '課税売上込10%', 8: '課税売上込軽減8%', 0: '非課売上', none: '対象外' },
  freee: { 10: '課税売上10%', 8: '課税売上8%（軽）', 0: '非課売上', none: '対象外' },
  mf: { 10: '課売 10%', 8: '課売 (軽)8%', 0: '非売', none: '対象外' },
};
const pad2 = (n) => String(n).padStart(2, '0');
const ymdSlash = (ms) => { const d = new Date(ms); return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`; };
// Import screens choke on quotes, commas and line breaks inside the summary.
const plain = (s) => String(s ?? '').replace(/["',\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();

/** [{ date, no, rate (10 | 8 | 0 | null), gross, tax, memo }] oldest first. */
export function journalLines(sales) {
  const out = [];
  for (const s of [...sales].sort((a, b) => (a.paidAt || a.createdAt) - (b.paidAt || b.createdAt))) {
    const first = (s.items || [])[0]?.name || '';
    const memo = plain(`Reji ${s.no} JPYC ${first}${(s.items || []).length > 1 ? ' ほか' : ''}`);
    for (const g of computeTotals(s.items || [], s.taxMode).byRate) {
      if (!g.gross) continue;
      out.push({ date: ymdSlash(s.paidAt || s.createdAt), no: s.no, rate: g.rate ?? null, gross: g.gross, tax: g.tax || 0, memo });
    }
  }
  return out;
}
const taxName = (fmt, rate) => TAX[fmt][rate == null ? 'none' : rate] ?? TAX[fmt].none;

const cell = (v) => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const toCsv = (rows) => rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';

/** Yayoi import format (弥生インポート形式): 25 columns, no header, Shift-JIS. */
export function yayoiRows(lines, a) {
  return lines.map((l) => ['2000', '', '', l.date, a.debit, '', '', TAX.yayoi.none, l.gross, '', a.credit, '', '', taxName('yayoi', l.rate), l.gross, l.tax || '',
    [...l.memo].slice(0, 30).join(''), '', '', '0', '', '', '0', '0', 'no']);
}
/** freee: general journal data, debit and credit in separate columns. */
export function freeeRows(lines, a) {
  const head = ['発生日', '伝票番号', '借方勘定科目', '借方税区分', '借方金額', '借方税額', '借方摘要', '貸方勘定科目', '貸方税区分', '貸方金額', '貸方税額', '貸方摘要'];
  const nos = new Map();
  return [head, ...lines.map((l) => {
    if (!nos.has(l.no)) nos.set(l.no, nos.size + 1);
    return [l.date, nos.get(l.no), a.debit, TAX.freee.none, l.gross, 0, l.memo, a.credit, taxName('freee', l.rate), l.gross, l.tax, l.memo];
  })];
}
/** Money Forward Cloud: journal import. Lines sharing a 取引No become one entry. */
export function mfRows(lines, a) {
  const head = ['取引No', '取引日', '借方勘定科目', '借方補助科目', '借方部門', '借方取引先', '借方税区分', '借方インボイス', '借方金額(円)', '借方税額',
    '貸方勘定科目', '貸方補助科目', '貸方部門', '貸方取引先', '貸方税区分', '貸方インボイス', '貸方金額(円)', '貸方税額', '摘要', '仕訳メモ', 'タグ', 'MF仕訳タイプ', '決算整理仕訳'];
  const nos = new Map();
  return [head, ...lines.map((l) => {
    if (!nos.has(l.no)) nos.set(l.no, nos.size + 1);
    return [nos.get(l.no), l.date, a.debit, '', '', '', TAX.mf.none, '', l.gross, 0, a.credit, '', '', '', taxName('mf', l.rate), '', l.gross, l.tax, l.memo, '', '', '', ''];
  })];
}

// ---- Shift-JIS without a library: the browser can decode it, so decode every code once and turn the table around ----
let sjisMap = null;
function sjisTable() {
  if (sjisMap) return sjisMap;
  const dec = new TextDecoder('shift_jis');
  const m = new Map();
  for (let b = 0xa1; b <= 0xdf; b++) m.set(dec.decode(new Uint8Array([b])), [b]); // half-width kana
  for (let hi = 0x81; hi <= 0xfc; hi++) {
    if (hi >= 0xa0 && hi <= 0xdf) continue;
    for (let lo = 0x40; lo <= 0xfc; lo++) {
      if (lo === 0x7f) continue;
      const ch = dec.decode(new Uint8Array([hi, lo]));
      if (ch.length === 1 && ch !== '\ufffd' && !m.has(ch)) m.set(ch, [hi, lo]);
    }
  }
  sjisMap = m;
  return m;
}
export function toShiftJis(text) {
  const m = sjisTable();
  const out = [];
  for (const ch of String(text)) {
    const c = ch.codePointAt(0);
    if (c < 0x80) out.push(c);
    else if (m.has(ch)) out.push(...m.get(ch));
    else out.push(0x3f); // a character Shift-JIS does not have
  }
  return new Uint8Array(out);
}

/** The file for one format: { name, blob parts, type }. `raw` is made by the caller (Reji's own layout). */
export function accountingFile(fmt, sales, accounts, stamp) {
  const a = { debit: plain(accounts?.debit) || ACCT_DEFAULTS.debit, credit: plain(accounts?.credit) || ACCT_DEFAULTS.credit };
  const lines = journalLines(sales);
  if (fmt === 'yayoi') return { name: `reji-yayoi-${stamp}.csv`, bytes: toShiftJis(toCsv(yayoiRows(lines, a))), type: 'text/csv;charset=shift_jis', lines: lines.length };
  const rows = fmt === 'freee' ? freeeRows(lines, a) : mfRows(lines, a);
  const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
  const body = new TextEncoder().encode(toCsv(rows));
  const bytes = new Uint8Array(bom.length + body.length);
  bytes.set(bom);
  bytes.set(body, bom.length);
  return { name: `reji-${fmt}-${stamp}.csv`, bytes, type: 'text/csv;charset=utf-8', lines: lines.length };
}
