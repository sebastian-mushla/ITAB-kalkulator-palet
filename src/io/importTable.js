import { toNum } from '../core/util.js';

// ---------- reading files ----------
export function parseCsvRows(text) {
  text = text.replace(/^﻿/, '');
  const firstLine = (text.split(/\r?\n/).find(l => l.trim()) || '');
  const counts = [';', '\t', ','].map(s => [s, firstLine.split(s).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  const sep = counts[0][1] > 0 ? counts[0][0] : null;
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (sep && c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.map(r => r.map(c => c.trim()));
}

function decode(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch (e) { return new TextDecoder('windows-1250').decode(buf); } // Czech Excel CSV export
}

let xlsxPromise = null;
function loadXlsx() {
  if (globalThis.XLSX) return Promise.resolve(globalThis.XLSX);
  if (!xlsxPromise) {
    xlsxPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = () => resolve(globalThis.XLSX);
      s.onerror = () => { xlsxPromise = null; reject(new Error('Nepodařilo se načíst knihovnu pro Excel.')); };
      document.head.appendChild(s);
    });
  }
  return xlsxPromise;
}

export function isSpreadsheet(name) { return /\.(xlsx|xlsm|xls|ods)$/i.test(name); }

// Returns { rows, text } — text only for non-spreadsheet files.
export async function readFileRows(file) {
  const buf = await file.arrayBuffer();
  if (isSpreadsheet(file.name)) {
    const XLSX = await loadXlsx();
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
    return { rows: rows.map(r => r.map(c => (c == null ? '' : c))), text: null };
  }
  const text = decode(buf);
  return { rows: parseCsvRows(text), text };
}

// ---------- column mapping ----------
export function norm(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9а-яё]/g, '');
}

// fields: { key: [aliases...] }, in priority order. Exact match first, then "header contains alias" (aliases of 3+ chars).
export function findColumns(header, fields) {
  const h = header.map(norm), used = new Set(), out = {};
  const keys = Object.keys(fields);
  for (const pass of ['exact', 'contains']) {
    for (const k of keys) {
      if (out[k] != null) continue;
      const aliases = fields[k].map(norm);
      const i = h.findIndex((x, j) => !used.has(j) && x && aliases.some(a =>
        pass === 'exact' ? x === a : (a.length >= 3 && x.includes(a))));
      if (i >= 0) { out[k] = i; used.add(i); }
    }
  }
  return out;
}

function toBool(v, def) {
  const s = norm(v);
  if (!s) return def;
  return ['1', 'true', 'ano', 'yes', 'y', 'a', 'x', 'да', 'lze', 'ok'].includes(s);
}
function headerIndex(rows) { return rows.findIndex(r => r.some(c => String(c).trim() !== '')); }

// ---------- catalog ----------
export const CATALOG_FIELDS = {
  code: ['artikl', 'article', 'artikel', 'артикул', 'sku', 'kod', 'code', 'cislo artiklu'],
  name: ['nazev', 'name', 'название', 'наименование', 'popis', 'description'],
  pack: ['baleni', 'pack', 'packaging', 'упаковка', 'typ baleni'],
  per: ['units_per_pallet', 'ks na palete', 'kusu na palete', 'ks/paleta', 'per pallet', 'шт на паллете', 'шт на палете', 'per', 'ks', 'pcs'],
  pl: ['pallet_length_mm', 'delka', 'length', 'длина', 'pl'],
  pw: ['pallet_width_mm', 'sirka', 'width', 'ширина', 'pw'],
  kg: ['unit_kg', 'vaha', 'hmotnost', 'weight', 'вес', 'kg'],
  rot: ['rotatable', 'otacet', 'rotate', 'поворот', 'rot']
};

export function packValue(v) {
  const s = norm(v);
  return ['balik', 'baliky', 'parcel', 'package', 'box', 'krabice', 'посылка', 'коробка', 'упаковка'].includes(s) ? 'balik' : 'paleta';
}

export function rowsToCatalog(rows) {
  const hi = headerIndex(rows);
  if (hi < 0) return { items: [], errors: ['Soubor je prázdný.'], cols: {} };
  const cols = findColumns(rows[hi], CATALOG_FIELDS);
  const missing = ['code', 'per', 'pl', 'pw', 'kg'].filter(k => cols[k] == null);
  if (missing.length) {
    return { items: [], cols, errors: ['Nenalezeny sloupce: ' + missing.map(k => CATALOG_LABELS[k]).join(', ') + '. Zkontrolujte záhlaví prvního řádku.'] };
  }
  const items = [], errors = [];
  const get = (r, k) => (cols[k] == null ? '' : r[cols[k]]);
  rows.slice(hi + 1).forEach((r, i) => {
    const line = hi + i + 2;
    if (!r.some(c => String(c).trim() !== '')) return;
    const code = String(get(r, 'code')).trim();
    if (!code) { errors.push('řádek ' + line + ': chybí artikl'); return; }
    const per = toNum(get(r, 'per')), pl = toNum(get(r, 'pl')), pw = toNum(get(r, 'pw')), kg = toNum(get(r, 'kg') || 0);
    const bad = [];
    if (!(per >= 1) || per % 1 !== 0) bad.push('počet kusů musí být celé číslo ≥ 1');
    if (!(pl > 0)) bad.push('délka musí být > 0');
    if (!(pw > 0)) bad.push('šířka musí být > 0');
    if (!(kg >= 0)) bad.push('váha není číslo');
    if (bad.length) { errors.push('řádek ' + line + ' (' + code + '): ' + bad.join(', ')); return; }
    items.push({
      code, name: String(get(r, 'name')).trim(), pack: packValue(get(r, 'pack')),
      pl, pw, per, kg, rot: toBool(get(r, 'rot'), true)
    });
  });
  return { items, errors, cols };
}
export const CATALOG_LABELS = { code: 'artikl', name: 'název', pack: 'balení', per: 'kusů na paletě', pl: 'délka', pw: 'šířka', kg: 'váha kusu', rot: 'lze otáčet' };

// ---------- vehicles ----------
export const VEHICLE_FIELDS = {
  name: ['nazev', 'name', 'vozidlo', 'vuz', 'машина', 'название'],
  type: ['typ', 'type', 'тип'],
  L: ['delka', 'length', 'длина', 'l'],
  W: ['sirka', 'width', 'ширина', 'w'],
  kg: ['nosnost', 'max kg', 'vaha', 'hmotnost', 'payload', 'грузоподъемность', 'kg', 'вес'],
  eup: ['europalet', 'palet', 'pallets', 'eup', 'паллет', 'палет'],
  lift: ['celo', 'lift', 'hydraul', 'борт', 'лифт'],
  cost: ['cena', 'cost', 'priorita', 'цена', 'стоимость']
};
const TYPE_ALIASES = {
  kamion: ['kamion', 'fura', 'фура', 'kamion', 'navesa', 'naves', 'truck', 'камион'],
  plachta: ['plachta', 'plachtak', 'plachtovy', 'tent', 'тент', 'плахта'],
  celo: ['celo', 'celem', 'lift', 'dodavkascelem', 'чело', 'лифт'],
  dodavka: ['dodavka', 'van', 'mikrobus', 'bus', 'микроавтобус', 'бус']
};
function typeValue(v) {
  const s = norm(v);
  for (const [t, a] of Object.entries(TYPE_ALIASES)) if (a.some(x => s.includes(norm(x)))) return t;
  return 'jine';
}
// metres; values that look like millimetres (> 100) are converted.
function metres(v) { const n = toNum(v); return n > 100 ? n / 1000 : n; }

export function rowsToVehicles(rows) {
  const hi = headerIndex(rows);
  if (hi < 0) return { items: [], errors: ['Soubor je prázdný.'], cols: {} };
  const cols = findColumns(rows[hi], VEHICLE_FIELDS);
  const missing = ['name', 'L', 'W', 'kg'].filter(k => cols[k] == null);
  if (missing.length) return { items: [], cols, errors: ['Nenalezeny sloupce: ' + missing.join(', ') + '.'] };
  const items = [], errors = [];
  const get = (r, k) => (cols[k] == null ? '' : r[cols[k]]);
  rows.slice(hi + 1).forEach((r, i) => {
    const line = hi + i + 2;
    if (!r.some(c => String(c).trim() !== '')) return;
    const name = String(get(r, 'name')).trim();
    const v = {
      name, type: String(get(r, 'type')).trim() ? typeValue(get(r, 'type')) : typeValue(name),
      L: metres(get(r, 'L')), W: metres(get(r, 'W')), kg: toNum(get(r, 'kg')),
      eup: toNum(get(r, 'eup') || 0) || 0, lift: toBool(get(r, 'lift'), false), cost: toNum(get(r, 'cost') || 0) || 0
    };
    if (!name || !(v.L > 0) || !(v.W > 0) || !(v.kg > 0)) { errors.push('řádek ' + line + ': chybí název, délka, šířka nebo nosnost'); return; }
    items.push(v);
  });
  // no price column: bigger body = more expensive
  if (cols.cost == null && items.length) {
    const max = Math.max(...items.map(v => v.L * v.W));
    items.forEach(v => { v.cost = Math.round((0.2 + 0.8 * (v.L * v.W) / max) * 100) / 100; });
  }
  return { items, errors, cols };
}

// ---------- combos ----------
export const COMBO_FIELDS = {
  code: ['artikl', 'article', 'артикул', 'code'],
  withCode: ['kdyz je v zakazce', 'v kombinaci s', 'with', 'spolu s', 'в комбинации'],
  min: ['mnozstvi od', 'od', 'min', 'от'],
  max: ['mnozstvi do', 'do', 'max', 'до'],
  mode: ['pojede', 'mode', 'akce', 'как'],
  host: ['na palete artiklu', 'cil', 'host', 'хозяин', 'na palete'],
  pl: ['delka', 'length', 'длина'],
  pw: ['sirka', 'width', 'ширина'],
  per: ['max ks na paletu', 'ks na paletu', 'per', 'ks', 'шт'],
  note: ['poznamka', 'note', 'комментарий'],
  kg: ['vaha kusu', 'vaha', 'weight', 'вес'],
  name: ['nazev', 'name', 'название'],
  on: ['aktivni', 'active', 'on', 'активно']
};
function comboMode(v) {
  const s = norm(v);
  if (/balik|parcel|посыл/.test(s)) return 'parcel';
  if (/jin|other|drug|друг|pallet$|vlastn/.test(s) && !/artikl|host/.test(s)) return 'pallet';
  return 'host';
}
export function rowsToCombos(rows) {
  const hi = headerIndex(rows);
  if (hi < 0) return { items: [], errors: ['Soubor je prázdný.'], cols: {} };
  const cols = findColumns(rows[hi], COMBO_FIELDS);
  if (cols.code == null) return { items: [], cols, errors: ['Nenalezen sloupec „artikl“.'] };
  const items = [], errors = [];
  const get = (r, k) => (cols[k] == null ? '' : r[cols[k]]);
  rows.slice(hi + 1).forEach((r, i) => {
    if (!r.some(c => String(c).trim() !== '')) return;
    const x = {
      on: toBool(get(r, 'on'), true), code: String(get(r, 'code')).trim(), withCode: String(get(r, 'withCode')).trim(),
      min: toNum(get(r, 'min') || 0) || 0, max: toNum(get(r, 'max') || 0) || 0, mode: comboMode(get(r, 'mode')),
      host: String(get(r, 'host')).trim(), pl: toNum(get(r, 'pl') || 0) || 0, pw: toNum(get(r, 'pw') || 0) || 0,
      per: toNum(get(r, 'per') || 0) || 0, note: String(get(r, 'note')).trim(), kg: toNum(get(r, 'kg') || 0) || 0, name: String(get(r, 'name')).trim()
    };
    if (!x.code) { errors.push('řádek ' + (hi + i + 2) + ': chybí artikl'); return; }
    if (x.mode === 'host' && !x.host) { errors.push('řádek ' + (hi + i + 2) + ': chybí artikl, na jehož paletě pojede'); return; }
    if (x.mode === 'pallet' && !(x.pl > 0 && x.pw > 0 && x.per > 0)) { errors.push('řádek ' + (hi + i + 2) + ': u jiné palety chybí délka, šířka nebo ks'); return; }
    items.push(x);
  });
  return { items, errors, cols };
}

// ---------- merge / export ----------
export function mergeBy(list, incoming, keyFn) {
  const out = list.slice(), idx = new Map(out.map((x, i) => [keyFn(x), i]));
  let added = 0, updated = 0;
  incoming.forEach(x => {
    const k = keyFn(x);
    if (idx.has(k)) { out[idx.get(k)] = x; updated++; } else { idx.set(k, out.length); out.push(x); added++; }
  });
  return { list: out, added, updated };
}

export function toCsv(rows) {
  return '﻿' + rows.map(r => r.map(c => {
    const s = String(c == null ? '' : c);
    return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(';')).join('\r\n');
}
