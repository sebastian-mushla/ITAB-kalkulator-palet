// Printable packing list for the warehouse: every pallet, its size, what is on it and what rides on top.
import { esc, fmtN } from '../core/util.js';

const cm = mm => Math.round(mm / 10);

export function packListHtml(r, names) {
  const nm = code => names.get(String(code).toLowerCase()) || '';
  const today = new Date().toLocaleDateString('cs-CZ');
  let n = 0;
  const palletRows = items => items.map(p => {
    n++;
    const extra = (p.extra || []).map(e => '<tr class="extra"><td></td><td></td><td>+ ' + esc(e.code) + '</td><td>' + esc(nm(e.code)) + '</td><td class="num">' + fmtN(e.units) + '</td><td></td><td class="chk">☐</td></tr>').join('');
    return '<tr><td class="num"><b>' + n + '</b></td><td>' + (p.pal ? '<b>' + esc(p.pal) + '</b> ' + esc(p.palName || '') + '<br>' : '') + cm(p.pl) + ' × ' + cm(p.pw) + ' cm' + (p.fill < 0.999 ? '<br><small>neúplná ' + Math.round(p.fill * 100) + ' %</small>' : '') + '</td><td><b>' + esc(p.code) + '</b>' + (p.so && (r.sos || []).length > 1 ? '<br><small>zakázka ' + esc(p.so) + '</small>' : '') + '</td><td>' + esc(nm(p.code)) + '</td><td class="num">' + fmtN(p.units) + '</td><td class="num">' + fmtN(p.kg) + '</td><td class="chk">☐</td></tr>' + extra;
  }).join('');
  const head = '<thead><tr><th>#</th><th>Paleta</th><th>Artikl</th><th>Název</th><th class="num">Ks</th><th class="num">kg</th><th>✓</th></tr></thead>';

  let body = '';
  const vehicles = r.vehicles.filter(v => v.items.length);
  const groupage = r.depot ? r.depot.items : (!vehicles.length ? r.pallets : []);
  {
    vehicles.forEach(v => {
      body += '<h2>' + esc(v.title) + ' <small>' + v.items.length + ' palet, ' + fmtN(v.kg) + ' kg</small></h2><table>' + head + '<tbody>' + palletRows(v.items.slice().sort((a, b) => a.x - b.x || a.y - b.y)) + '</tbody></table>';
    });
  }
  if (groupage.length) body += '<h2>Sběrná služba <small>' + groupage.length + ' palet</small></h2><table>' + head + '<tbody>' + palletRows(groupage) + '</tbody></table>';
  if (r.parcels.length) {
    const m = new Map();
    r.parcels.forEach(p => { const g = m.get(p.code) || { p, n: 0, units: 0, kg: 0 }; g.n++; g.units += p.units; g.kg += p.kg; m.set(p.code, g); });
    body += '<h2>Balíky – sběrná služba <small>' + r.parcels.length + ' ks</small></h2><table><thead><tr><th>Artikl</th><th>Název</th><th>Rozměr balíku</th><th class="num">Balíků</th><th class="num">Ks celkem</th><th class="num">kg</th><th>✓</th></tr></thead><tbody>' +
      [...m.values()].map(g => '<tr><td><b>' + esc(g.p.code) + '</b></td><td>' + esc(nm(g.p.code)) + '</td><td>' + cm(g.p.pl) + ' × ' + cm(g.p.pw) + ' cm</td><td class="num">' + g.n + '</td><td class="num">' + fmtN(g.units) + '</td><td class="num">' + fmtN(g.kg) + '</td><td class="chk">☐</td></tr>').join('') + '</tbody></table>';
  }
  const unk = (r.unknown || []).length ? '<p class="warn">Pozor: v zakázce jsou artikly mimo číselník (nejsou v seznamu): ' + esc(r.unknown.map(u => u.code + ' ' + u.qty + ' ks').join(', ')) + '</p>' : '';

  return '<!DOCTYPE html><html lang="cs"><head><meta charset="utf-8"><title>Balení – ID ' + esc(r.id) + '</title><style>' +
    'body{font-family:Inter,Arial,sans-serif;color:#111;margin:24px;font-size:13px}' +
    'h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:22px 0 6px}h2 small,.meta{color:#555;font-weight:400;font-size:13px}' +
    'table{width:100%;border-collapse:collapse}th,td{border:1px solid #999;padding:6px 8px;text-align:left;vertical-align:top}th{background:#eee}' +
    '.num{text-align:right}.chk{text-align:center;font-size:18px;width:28px}tr.extra td{background:#f6f6f6;font-style:italic}' +
    '.warn{border:2px solid #000;padding:8px;font-weight:700}.sign{margin-top:28px;display:flex;gap:40px}.sign span{flex:1;border-top:1px solid #000;padding-top:4px}' +
    '@media print{body{margin:10mm}button{display:none}h2{break-after:avoid}tr{break-inside:avoid}}' +
    '</style></head><body><button onclick="print()" style="float:right;padding:8px 16px">Tisknout</button>' +
    '<h1>Balení – ' + ((r.sos || []).length > 1 ? 'ID ' + esc(r.id) + '</h1><div class="meta">Zakázky: ' + esc(r.sos.join(', ')) + '</div>' : 'zakázka ' + esc(r.id) + '</h1>') + '<div class="meta">' + today + ' · ' + r.pallets.length + ' palet, ' + fmtN(r.kg) + ' kg' + (r.reco ? ' · ' + esc(r.reco) : '') + '</div>' +
    unk + body + '<div class="sign"><span>Zabalil</span><span>Zkontroloval</span><span>Datum</span></div></body></html>';
}
