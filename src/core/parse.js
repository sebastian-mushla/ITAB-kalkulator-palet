import { toNum } from './util.js';
import { findColumns } from '../io/importTable.js';

// ERP text ("SO 505111" + "r10 V06 kabina 6") or 3-column CSV/TSV (order;article;qty).
export function parseOrders(text) {
  const orders = new Map(), problems = [];
  let first = true, cur = null;
  function add(id, code, qty, name) {
    if (!orders.has(id)) orders.set(id, { id, lines: new Map() });
    const o = orders.get(id), k = code.toLowerCase();
    if (o.lines.has(k)) { const l = o.lines.get(k); l.qty += qty; if (!l.name && name) l.name = name; }
    else o.lines.set(k, { code, qty, name: name || '' });
  }
  text.split(/\r?\n/).forEach((raw, idx) => {
    const line = raw.trim(); if (!line) return;
    const isFirst = first; first = false;
    const so = line.match(/^SO[\s:.\-]*(\S+)$/i);
    if (so) { cur = so[1]; return; }
    const rw = line.match(/^r\d+\s+(\S+)\s+(?:(.*?)\s+)?([\d.,]+)$/i);
    if (rw) {
      if (!cur) { problems.push('řádek ' + (idx + 1) + ': chybí hlavička zakázky (SO číslo)'); return; }
      const q = toNum(rw[3]);
      if (!isFinite(q) || q % 1 !== 0 || q <= 0) { problems.push('řádek ' + (idx + 1) + ': množství musí být celé číslo větší než nula'); return; }
      add(cur, rw[1], q, (rw[2] || '').trim()); return;
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
    add(p[0], p[1], qty, p.slice(2, -1).join(' ').trim());
  });
  return { orders, problems };
}

const ORDER_FIELDS = {
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
