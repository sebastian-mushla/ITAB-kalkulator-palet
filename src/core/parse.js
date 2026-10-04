import { toNum } from './util.js';
import { findColumns, parseCsvRows } from '../io/importTable.js';

// Structure: ID (one address / shipment) → zakázky (SO) → lines.
// Text formats: ERP ("ID 123" optional, "SO 505111", "r10 V06 kabina 6"), or a table with columns
// ID;zakázka;artikl;název;množství (header needed for the ID column). Without an ID the zakázka is its own ID.
export function parseOrders(text) {
  const orders = new Map(), problems = [];
  // a pasted table with a header that names an ID column: convert to ERP text first
  const firstLine = (text.split(/\r?\n/).find(l => l.trim()) || '');
  if (/[;\t,]/.test(firstLine)) {
    const rows = parseCsvRows(text), cols = findColumns(rows[0] || [], ORDER_FIELDS);
    if (cols.id != null && cols.order != null && cols.code != null && cols.qty != null) text = rowsToOrderText(rows);
  }
  let first = true, cur = null, curId = null;
  function add(id, so, code, qty, name) {
    if (!orders.has(id)) orders.set(id, { id, sos: [], lines: new Map() });
    const o = orders.get(id), k = so.toLowerCase() + '|' + code.toLowerCase();
    if (!o.sos.includes(so)) o.sos.push(so);
    if (o.lines.has(k)) { const l = o.lines.get(k); l.qty += qty; if (!l.name && name) l.name = name; }
    else o.lines.set(k, { so, code, qty, name: name && name !== '-' ? name : '' });
  }
  text.split(/\r?\n/).forEach((raw, idx) => {
    const line = raw.trim(); if (!line) return;
    const isFirst = first; first = false;
    const idm = line.match(/^ID[\s:.\-]*(\S+)$/i);
    if (idm) { curId = idm[1]; cur = null; return; }
    const so = line.match(/^SO[\s:.\-]*(\S+)$/i);
    if (so) { cur = so[1]; return; }
    const rw = line.match(/^r\d+\s+(\S+)\s+(?:(.*?)\s+)?([\d.,]+)$/i);
    if (rw) {
      if (!cur) { problems.push('řádek ' + (idx + 1) + ': chybí hlavička zakázky (SO číslo)'); return; }
      const q = toNum(rw[3]);
      if (!isFinite(q) || q % 1 !== 0 || q <= 0) { problems.push('řádek ' + (idx + 1) + ': množství musí být celé číslo větší než nula'); return; }
      add(curId || cur, cur, rw[1], q, (rw[2] || '').trim()); return;
    }
    const sep = line.indexOf(';') >= 0 ? ';' : (line.indexOf('\t') >= 0 ? '\t' : ',');
    const p = line.split(sep).map(s => s.trim().replace(/^"(.*)"$/, '$1'));
    if (p.length < 3 || !p[0] || !p[1]) { problems.push('řádek ' + (idx + 1) + ': nerozpoznaný formát'); return; }
    // order;article;qty or order;article;name…;qty (pasted from Excel): quantity is the last filled column
    while (p.length > 3 && p[p.length - 1] === '') p.pop();
    const qCell = p[p.length - 1];
    const qty = toNum(qCell);
    if (!isFinite(qty)) { if (isFirst) return; problems.push('řádek ' + (idx + 1) + ': množství „' + qCell + '“ není číslo'); return; }
    if (qty % 1 !== 0 || qty <= 0) { problems.push('řádek ' + (idx + 1) + ': množství musí být celé číslo větší než nula'); return; }
    add(p[0], p[0], p[1], qty, p.slice(2, -1).join(' ').trim());
  });
  return { orders, problems };
}

// Orders back to ERP text (keeps ID → zakázka → lines), used to remember the list.
export function ordersToText(orders) {
  const out = [];
  orders.forEach(o => {
    out.push('ID ' + o.id);
    o.sos.forEach(so => {
      out.push('SO ' + so);
      let n = 10;
      o.lines.forEach(l => { if (l.so === so) { out.push('r' + n + ' ' + l.code + ' ' + (l.name || '-').replace(/\s+/g, ' ') + ' ' + l.qty); n += 10; } });
    });
    out.push('');
  });
  return out.join('\n');
}

const ORDER_FIELDS = {
  id: ['id', 'id adresy', 'adresa id', 'zasilka', 'shipment', 'adresa'],
  order: ['zakazka', 'objednavka', 'order', 'so', 'заказ', 'doklad'],
  code: ['artikl', 'artikel', 'article', 'артикул', 'sku', 'kod', 'code', 'polozka'],
  name: ['nazev', 'name', 'popis', 'название', 'description'],
  qty: ['mnozstvi', 'quantity', 'qty', 'pocet', 'количество', 'kusu', 'ks', 'pcs']
};

// Rows from a spreadsheet: if a header with order/article/qty is found use it,
// otherwise every row is joined back into text for parseOrders (ERP lines or 3 columns).
export function rowsToOrderText(rows) {
  const hi = rows.findIndex(r => r.some(c => String(c).trim() !== ''));
  if (hi >= 0) {
    const cols = findColumns(rows[hi], ORDER_FIELDS);
    if (cols.id != null && cols.order != null && cols.code != null && cols.qty != null) {
      // ID column: write ERP text so the ID → zakázka structure survives
      const out = []; let lastId = null, lastSo = null, n = 10;
      rows.slice(hi + 1).filter(r => r.some(c => String(c).trim() !== '')).forEach(r => {
        const id = String(r[cols.id]).trim(), so = String(r[cols.order]).trim();
        if (id !== lastId) { out.push('ID ' + id); lastId = id; lastSo = null; }
        if (so !== lastSo) { out.push('SO ' + so); lastSo = so; n = 10; }
        out.push('r' + n + ' ' + String(r[cols.code]).trim() + ' ' + (cols.name != null ? String(r[cols.name] || '-').trim().replace(/\s+/g, ' ') || '-' : '-') + ' ' + String(r[cols.qty]).trim());
        n += 10;
      });
      return out.join('\n');
    }
    if (cols.order != null && cols.code != null && cols.qty != null) {
      return rows.slice(hi + 1)
        .filter(r => r.some(c => String(c).trim() !== ''))
        .map(r => [r[cols.order], r[cols.code]].concat(cols.name != null ? [r[cols.name]] : [], [r[cols.qty]]).map(c => String(c == null ? '' : c).trim()).join(';'))
        .join('\n');
    }
  }
  return rows.map(r => {
    const cells = r.map(c => String(c == null ? '' : c).trim());
    while (cells.length && cells[cells.length - 1] === '') cells.pop();
    if (cells.length === 1) return cells[0];
    if (cells.length >= 3 && /^r\d+$/i.test(cells[0])) return cells.join(' ');
    return cells.join(';');
  }).join('\n');
}
