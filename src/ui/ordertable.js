// Orders as a table: status, sortable columns (click the header), filter per column (funnel button).
import { esc, fmtN, plural } from '../core/util.js';

export const STATUSES = [
  ['zarazeni', 'Čeká na zařazení', 'amber'],
  ['pripravena', 'Připravená', 'blue'],
  ['rozpracovana', 'Rozpracovaná', 'violet'],
  ['objednana', 'Doprava objednána', 'green'],
  ['vyrizena', 'Vyřízená', 'gray']
];
const ST = Object.fromEntries(STATUSES.map((s, i) => [s[0], { label: s[1], color: s[2], rank: i }]));

export function statusOf(r, id, { done, ordered, edited }) {
  if (done.has(id)) return 'vyrizena';
  if (ordered.has(id)) return 'objednana';
  if ((r.unknown || []).length) return 'zarazeni';
  if (edited(id)) return 'rozpracovana';
  return 'pripravena';
}
export function transportOf(r) {
  if (r.reco) return r.reco;
  if (r.mode === 'groupage') return 'Sběrná služba';
  if (r.mode === 'parcels') return 'Sběrná služba – balíky';
  return '';
}

const COLS = [
  ['id', 'Zakázka', 'text'],
  ['status', 'Stav', 'status'],
  ['known', 'Artikly', 'num'],
  ['pallets', 'Palety', 'num'],
  ['kg', 'Váha', 'num'],
  ['transport', 'Doprava', 'text']
];

function ring(known, total) {
  const p = total ? known / total : 1, C = 2 * Math.PI * 14;
  const col = p >= 1 ? 'var(--green)' : p >= 0.5 ? 'var(--amber)' : 'var(--red)';
  return '<svg class="ring" viewBox="0 0 36 36" width="32" height="32" role="img" aria-label="Zařazeno ' + known + ' z ' + total + '"><title>Zařazeno ' + known + ' z ' + total + ' artiklů</title>' +
    '<circle cx="18" cy="18" r="14" style="fill:none;stroke:var(--line);stroke-width:4"/>' +
    '<circle cx="18" cy="18" r="14" transform="rotate(-90 18 18)" style="fill:none;stroke:' + col + ';stroke-width:4;stroke-linecap:round;stroke-dasharray:' + (C * p).toFixed(1) + ' ' + C.toFixed(1) + '"/>' +
    '<text x="18" y="21.5" style="fill:var(--ink);font-size:' + (total >= 10 ? 8 : 10) + 'px;font-weight:700;text-anchor:middle">' + known + '/' + total + '</text></svg>';
}

// rows: [{ id, r, status, total, known }]
function matches(row, f) {
  if (f.id && !row.id.toLowerCase().includes(f.id.toLowerCase())) return false;
  if (f.transport && !row.transport.toLowerCase().includes(f.transport.toLowerCase())) return false;
  if (f.status && f.status.length && !f.status.includes(row.status)) return false;
  for (const k of ['known', 'pallets', 'kg']) {
    const v = k === 'known' ? row.known / (row.total || 1) * 100 : row[k];
    if (f[k + 'Min'] !== '' && f[k + 'Min'] != null && v < Number(f[k + 'Min'])) return false;
    if (f[k + 'Max'] !== '' && f[k + 'Max'] != null && v > Number(f[k + 'Max'])) return false;
  }
  return true;
}

function filterPopover(col, f) {
  const [key, label, type] = col;
  let body = '';
  if (type === 'text') body = '<input type="search" data-f="' + key + '" value="' + esc(f[key] || '') + '" placeholder="obsahuje…">';
  else if (type === 'status') body = STATUSES.map(s => '<label class="inline"><input type="checkbox" data-fs="' + s[0] + '"' + ((f.status || []).includes(s[0]) ? ' checked' : '') + '> <span class="st st-' + s[2] + '">' + s[1] + '</span></label>').join('');
  else body = '<div class="fp-range"><input type="number" data-f="' + key + 'Min" value="' + esc(f[key + 'Min'] ?? '') + '" placeholder="od"><input type="number" data-f="' + key + 'Max" value="' + esc(f[key + 'Max'] ?? '') + '" placeholder="do"></div>' + (key === 'known' ? '<small class="muted">v % zařazených artiklů</small>' : '');
  return '<div class="fpop" data-col="' + key + '"><b>Filtr: ' + label + '</b>' + body + '<div class="fp-acts"><button type="button" class="linkbtn" data-fclear="' + key + '">Zrušit filtr</button><button type="button" class="btn small" data-fclose="1">Hotovo</button></div></div>';
}
const active = (key, f) => key === 'status' ? (f.status || []).length > 0 : ['text'].includes((COLS.find(c => c[0] === key) || [])[2]) ? !!f[key] : (f[key + 'Min'] !== '' && f[key + 'Min'] != null) || (f[key + 'Max'] !== '' && f[key + 'Max'] != null);

export function renderOrderTable(el, countEl, rows, ui, sel) {
  const f = ui.filters, sort = ui.sort;
  let list = rows.filter(r => matches(r, f));
  const val = (row, k) => k === 'status' ? ST[row.status].rank : k === 'known' ? row.known / (row.total || 1) : k === 'id' || k === 'transport' ? String(row[k]).toLowerCase() : row[k];
  if (sort.key) list.sort((a, b) => { const x = val(a, sort.key), y = val(b, sort.key); return (x < y ? -1 : x > y ? 1 : 0) * (sort.dir === 'desc' ? -1 : 1); });
  else list.sort((a, b) => (a.status === 'vyrizena' ? 1 : 0) - (b.status === 'vyrizena' ? 1 : 0));
  const nf = COLS.filter(c => active(c[0], f)).length;
  countEl.innerHTML = list.length + ' ' + plural(list.length, ['zakázka', 'zakázky', 'zakázek']) + (list.length !== rows.length ? ' z ' + rows.length : '') + (nf ? ' · <button class="linkbtn" data-fclearall="1">zrušit filtry (' + nf + ')</button>' : '');
  const head = '<tr><th class="c-done" title="Vyřízeno">✓</th>' + COLS.map(c => {
    const s = sort.key === c[0] ? (sort.dir === 'desc' ? ' ▼' : ' ▲') : '';
    return '<th class="c-' + c[0] + (c[2] === 'num' ? ' num' : '') + '"><span class="th-in"><button type="button" class="th-sort" data-sort="' + c[0] + '" title="Seřadit">' + c[1] + s + '</button>' +
      '<button type="button" class="th-filt' + (active(c[0], f) ? ' on' : '') + '" data-filt="' + c[0] + '" aria-label="Filtr ' + c[1] + '" title="Filtr"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h18l-7 8v6l-4-2v-4z"/></svg></button></span>' +
      (ui.open === c[0] ? filterPopover(c, f) : '') + '</th>';
  }).join('') + '<th></th></tr>';
  const body = list.length ? list.map(row => {
    const st = ST[row.status], full = row.known === row.total;
    return '<tr class="orow' + (row.status === 'vyrizena' ? ' done' : '') + '" data-id="' + esc(row.id) + '"' + (row.id === sel ? ' aria-current="true"' : '') + '>' +
      '<td class="c-done"><input type="checkbox" data-done="' + esc(row.id) + '"' + (row.status === 'vyrizena' ? ' checked' : '') + (full ? '' : ' disabled') + ' title="' + (full ? 'Označit jako vyřízenou' : 'Nejdřív zařaďte všechny artikly') + '"></td>' +
      '<td class="c-id"><b>' + esc(row.id) + '</b></td>' +
      '<td><span class="st st-' + st.color + '">' + st.label + '</span></td>' +
      '<td class="num">' + ring(row.known, row.total) + '</td>' +
      '<td class="num">' + row.pallets + (row.parcels ? '<small> +' + row.parcels + ' bal.</small>' : '') + '</td>' +
      '<td class="num">' + fmtN(row.kg) + ' kg</td>' +
      '<td class="c-tr" title="' + esc(row.transport) + '">' + esc(row.transport || '–') + '</td>' +
      '<td><button class="feed-x" data-del="' + esc(row.id) + '" aria-label="Odebrat zakázku ' + esc(row.id) + '" title="Odebrat ze seznamu">×</button></td></tr>';
  }).join('') : '<tr><td colspan="9" class="empty">' + (rows.length ? 'Žádná zakázka neodpovídá filtrům.' : 'Zakázky zatím nejsou.') + '</td></tr>';
  el.innerHTML = '<table class="otable"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';
}
