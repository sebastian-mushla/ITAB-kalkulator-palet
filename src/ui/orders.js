import { esc, plural, fmtM, fmtKg, fmtN, color, palWord, balWord, vehWord } from '../core/util.js';
import { groupItems } from '../core/solve.js';

const $ = s => document.querySelector(s);
const ldmText = r => r.ldm.toLocaleString('cs-CZ', { maximumFractionDigits: 1 });
const zak = n => n + ' ' + plural(n, ['zakázka', 'zakázky', 'zakázek']);
const PARCEL_SERVICES = 'PPL, DPD, UPS, Česká pošta';

const ICONS = {
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  box: '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  truck: '<path d="M2 6h12v10H2z"/><path d="M14 9h4l4 4v3h-8z"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>'
};
export function icon(n) {
  return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[n] + '</svg>';
}

// ---------- drawings ----------
export function svgVehicle(v) {
  const S = 10, x0 = 86, y0 = 6, Lw = v.L / S, Hw = v.W / S, lift = v.lift ? 26 : 0, vbW = x0 + Lw + 14 + lift, vbH = y0 + Hw + 36;
  let s = '<svg viewBox="0 0 ' + vbW + ' ' + vbH + '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Schéma nakládky: ' + esc(v.title) + '" style="min-width:' + Math.max(320, Math.round(vbW * 0.62)) + 'px;max-width:' + Math.round(vbW * 1.15) + 'px">';
  const ch = Hw * 0.78, cy = y0 + (Hw - ch) / 2;
  s += '<path d="M 12 ' + (cy + ch * 0.25) + ' L 30 ' + cy + ' L ' + (x0 - 6) + ' ' + cy + ' L ' + (x0 - 6) + ' ' + (cy + ch) + ' L 30 ' + (cy + ch) + ' L 12 ' + (cy + ch * 0.75) + ' Z" style="fill:var(--truck);stroke:var(--truck-line);stroke-width:2"/>';
  s += '<rect x="24" y="' + (cy + ch * 0.2) + '" width="9" height="' + (ch * 0.6) + '" style="fill:var(--ink2);fill-opacity:.55"/>';
  s += '<rect x="' + x0 + '" y="' + y0 + '" width="' + Lw + '" height="' + Hw + '" style="fill:var(--truck);stroke:var(--truck-line);stroke-width:2"/>';
  if (v.lift) s += '<rect x="' + (x0 + Lw + 3) + '" y="' + (y0 + Hw * 0.1) + '" width="' + (lift - 6) + '" height="' + (Hw * 0.8) + '" rx="2" style="fill:none;stroke:var(--truck-line);stroke-width:2;stroke-dasharray:4 3"/>';
  v.items.forEach(it => {
    const px = x0 + it.x / S + 1.5, py = y0 + it.y / S + 1.5, pw = it.w / S - 3, ph = it.h / S - 3, col = color(it.ci), partial = it.fill < 0.999;
    if (partial) {
      s += '<rect x="' + px + '" y="' + py + '" width="' + pw + '" height="' + ph + '" rx="2" style="fill:' + col + ';fill-opacity:.3;stroke:' + col + ';stroke-width:2"/>';
      if (pw >= ph) s += '<rect x="' + px + '" y="' + py + '" width="' + (pw * it.fill) + '" height="' + ph + '" rx="2" style="fill:' + col + '"/>';
      else s += '<rect x="' + px + '" y="' + py + '" width="' + pw + '" height="' + (ph * it.fill) + '" rx="2" style="fill:' + col + '"/>';
    } else s += '<rect x="' + px + '" y="' + py + '" width="' + pw + '" height="' + ph + '" rx="2" style="fill:' + col + '"/>';
    if (ph >= 24 && pw >= 50) {
      const l1 = it.code, l2 = it.units + ' ks' + (partial ? ', ' + Math.round(it.fill * 100) + '%' : '');
      const fs = Math.max(9, Math.min(18, ph / 4.2, pw / (0.6 * Math.max(l1.length, l2.length) + 0.6)));
      const cx = px + pw / 2, cyy = py + ph / 2;
      const st = 'fill:#fff;font-weight:600;text-anchor:middle;paint-order:stroke;stroke:' + col + ';stroke-width:3px;stroke-linejoin:round;font-size:' + fs.toFixed(1) + 'px';
      s += '<text x="' + cx + '" y="' + (cyy - fs * 0.1) + '" style="' + st + '">' + esc(l1) + '</text>';
      s += '<text x="' + cx + '" y="' + (cyy + fs * 1.1) + '" style="' + st + '">' + esc(l2) + '</text>';
    }
  });
  const ry = y0 + Hw + 6;
  s += '<line x1="' + x0 + '" y1="' + ry + '" x2="' + (x0 + Lw) + '" y2="' + ry + '" style="stroke:var(--ink2);stroke-width:1.5"/>';
  for (let m = 0; m <= Math.floor(v.L / 1000); m++) {
    const x = x0 + m * 100, major = v.L <= 6000 || m % 2 === 0;
    s += '<line x1="' + x + '" y1="' + ry + '" x2="' + x + '" y2="' + (ry + (major ? 9 : 5)) + '" style="stroke:var(--ink2);stroke-width:1.5"/>';
    if (major) s += '<text x="' + x + '" y="' + (ry + 23) + '" style="fill:var(--ink2);font-size:11px;text-anchor:middle">' + m + ' m</text>';
  }
  if (v.lift) s += '<text x="' + (x0 + Lw + lift / 2) + '" y="' + (ry + 23) + '" style="fill:var(--ink2);font-size:11px;text-anchor:middle">čelo</text>';
  return s + '</svg>';
}

// Groupage / parcels: pallets and boxes in a row as they go to the depot.
function svgShipment(units) {
  const gap = 10, size = u => (u.kind === 'paleta' ? 64 : 40);
  const shown = units.slice(0, 24), W = shown.reduce((s, u) => s + size(u) + gap, gap) + (units.length > shown.length ? 60 : 0), H = 96;
  let x = gap, s = '<svg viewBox="0 0 ' + Math.max(W, 200) + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Zásilka pro sběrnou službu" style="max-width:' + Math.max(W, 200) + 'px">';
  s += '<line x1="0" y1="' + (H - 18) + '" x2="' + Math.max(W, 200) + '" y2="' + (H - 18) + '" style="stroke:var(--line);stroke-width:2"/>';
  shown.forEach(u => {
    const z = size(u), y = H - 18 - z, col = color(u.ci);
    if (u.kind === 'paleta') {
      s += '<rect x="' + x + '" y="' + (H - 26) + '" width="' + z + '" height="8" style="fill:var(--truck-line);fill-opacity:.5"/>';
      s += '<rect x="' + x + '" y="' + (y - 8) + '" width="' + z + '" height="' + z + '" rx="3" style="fill:' + col + ';fill-opacity:' + (0.35 + 0.65 * u.fill) + '"/>';
    } else {
      s += '<rect x="' + x + '" y="' + y + '" width="' + z + '" height="' + z + '" rx="3" style="fill:' + col + '"/>';
      s += '<line x1="' + (x + z / 2) + '" y1="' + y + '" x2="' + (x + z / 2) + '" y2="' + (y + z) + '" style="stroke:#fff;stroke-opacity:.6;stroke-width:3"/>';
    }
    s += '<text x="' + (x + z / 2) + '" y="' + (H - 4) + '" style="fill:var(--ink2);font-size:10px;text-anchor:middle">' + esc(u.code) + '</text>';
    x += z + gap;
  });
  if (units.length > shown.length) s += '<text x="' + (x + 24) + '" y="' + (H - 40) + '" style="fill:var(--ink2);font-size:13px;text-anchor:middle">+' + (units.length - shown.length) + '</text>';
  return s + '</svg>';
}

// ---------- detail parts ----------
function cargoRows(r) {
  const out = [];
  if (r.pallets.length) {
    const std = r.pallets.length - r.euroCount;
    out.push(['Palet', r.pallets.length + ' (' + r.euroCount + ' euro' + (std ? ', ' + std + ' nestandardních' : '') + ')']);
  }
  if (r.parcels.length) out.push(['Balíků', r.parcels.length + ', ' + fmtKg(r.parcelInfo.kg)]);
  out.push(['Váha', fmtKg(r.kg)]);
  if (r.pallets.length) {
    out.push(['Nakládací metry (LDM)', 'přibližně ' + ldmText(r)]);
    out.push(['Nadrozměr', r.big.length ? 'ano: ' + r.big.join('; ') : 'ne']);
    out.push(['Stohování', 'ne']);
  }
  return out;
}
export function requestText(r) {
  const L = ['Zakázka ' + r.id, 'Odeslání: Česko, továrna'];
  cargoRows(r).forEach(x => L.push(x[0] + ': ' + x[1]));
  if (r.mode === 'groupage') L.push('Doprava palet: sběrná služba');
  else if (r.vehicles.length) {
    L.push('Doprava: ' + r.reco);
    r.vehicles.forEach(v => L.push(v.title + ' (' + fmtM(v.L) + ' m): ' + groupItems(v.items).map(g => g.code + ' ' + g.count + ' ' + palWord(g.count) + ' (' + g.units + ' ks)').join(', ')));
  }
  if (r.parcels.length) L.push('Balíky: sběrná služba (' + PARCEL_SERVICES + '), ' + r.parcels.length + ' ' + balWord(r.parcels.length));
  return L.join('\n');
}
function decisionHtml(r, rules) {
  if (r.mode === 'empty') return '<div class="decision empty"><div><h2>Není co počítat</h2><p>Žádný artikl ze zakázky nebyl nalezen v číselníku. Zkontrolujte artikly nebo je přidejte na záložce „Číselník artiklů“.</p></div></div>';
  let h2, p, cls = r.mode, btn = true;
  const parcelNote = r.parcels.length && r.pallets.length ? ' Navíc ' + r.parcels.length + ' ' + balWord(r.parcels.length) + ' sběrnou službou.' : '';
  if (r.mode === 'groupage') {
    h2 = 'Objednat: sběrná služba';
    p = r.pallets.length + ' ' + palWord(r.pallets.length) + ' (euro), limit ' + rules.gMax + '.' + parcelNote;
  } else if (r.mode === 'parcels') {
    h2 = 'Objednat: sběrná služba – balíky'; cls = 'groupage';
    p = PARCEL_SERVICES + '. ' + r.parcels.length + ' ' + balWord(r.parcels.length) + ', ' + fmtKg(r.parcelInfo.kg) + '.';
  } else if (r.mode === 'trucks') {
    h2 = 'Objednat: ' + r.reco;
    p = (r.forced != null ? 'Vozidlo zvoleno ručně.' : 'Sběrná služba nevyhovuje: ' + r.groupage.reasons.join('; ') + '.') + parcelNote;
  } else {
    btn = false;
    const why = [];
    if (r.oversize.length) why.push('nevejde se na korbu: ' + [...new Set(r.oversize.map(o => o.code + ' (' + o.pl + '×' + o.pw + ' mm, ' + fmtKg(o.kg) + ')'))].join(', '));
    if (r.parcelInfo && !r.parcelInfo.ok) why.push('balíky nesplňují limit sběrné služby: ' + r.parcelInfo.reasons.join('; '));
    h2 = 'Zkontrolovat zakázku';
    p = why.join('. ') + '.';
  }
  return '<div class="decision ' + cls + '"><div><h2>' + esc(h2) + '</h2><p>' + esc(p) + '</p></div>' + (btn ? '<button class="btn primary" id="copyBtn">Zkopírovat poptávku</button>' : '') + '</div>';
}
function compositionHtml(r) {
  const body = r.rows.map(x => {
    const parts = [];
    if (x.pack === 'balik') parts.push(x.count + ' ' + balWord(x.count) + ' po ' + x.per + ' ks' + (x.rem ? ' (poslední ' + x.rem + ' ks)' : ''));
    else if (x.per === 1) parts.push(x.full + ' ' + palWord(x.full));
    else {
      if (x.full > 0) parts.push(x.full + ' ' + plural(x.full, ['plná', 'plné', 'plných']));
      if (x.rem > 0) parts.push('1 neúplná: ' + x.rem + ' ks, ' + Math.round(x.fillRem * 100) + '%');
    }
    return '<tr><td><i class="sw" style="background:' + color(x.ci) + '"></i>' + esc(x.code) + '<br><span class="hint">' + esc(x.name || '') + '</span></td><td class="num">' + fmtN(x.qty) + ' ks</td><td>' + esc(parts.join(', ')) + '</td><td class="num">' + fmtKg(x.kg) + '</td></tr>';
  }).join('');
  return '<div class="panel"><h3>Složení zakázky</h3><div class="tscroll"><table><thead><tr><th>Artikl</th><th class="num">Množství</th><th>Palety / balíky</th><th class="num">Váha</th></tr></thead><tbody>' + body + '</tbody></table></div></div>';
}
function vehicleHtml(v) {
  const legend = groupItems(v.items).map(g => '<li><i class="sw" style="background:' + color(g.ci) + '"></i>' + esc(g.code) + ': ' + g.count + ' ' + palWord(g.count) + ', ' + g.units + ' ks</li>').join('');
  const load = Math.round(v.kg / v.maxKg * 100);
  return '<article class="panel veh"><header><h3>' + esc(v.title) + ', korba ' + fmtM(v.L) + ' × ' + fmtM(v.W) + ' m</h3><p>' + v.items.length + ' ' + palWord(v.items.length) + ', ' + fmtKg(v.kg) + ' (' + load + ' % nosnosti)</p></header><ul class="legend">' + legend + '</ul><div class="plan">' + svgVehicle(v) + '</div></article>';
}
function vehiclePicker(r, vehicles) {
  if (!r.pallets.length) return '';
  const opts = ['<option value="">Automaticky (nejvýhodnější)</option>'].concat(vehicles.map((v, i) =>
    '<option value="' + i + '"' + (r.forced === i ? ' selected' : '') + '>' + esc(v.name) + ' – ' + String(v.L).replace('.', ',') + ' m, ' + fmtN(v.kg) + ' kg</option>'));
  return '<label class="picker"><span>Vozidlo</span><select id="forceVeh">' + opts.join('') + '</select></label>';
}

export function renderDetail(r, { rules, vehicles }) {
  const el = $('#detail');
  if (!r) { el.innerHTML = '<div class="empty">Vložte zakázky do importu a klikněte na „Spočítat“.</div>'; return; }
  let h = '<div class="sec-head"><h2>Detail zakázky ' + esc(r.id) + '</h2>' + vehiclePicker(r, vehicles) + '</div>' + decisionHtml(r, rules);
  if (r.pallets.length || r.parcels.length) {
    h += '<div class="stats">';
    if (r.pallets.length) h += '<div><b>' + r.pallets.length + '</b><span>' + palWord(r.pallets.length) + '</span></div>';
    if (r.parcels.length) h += '<div><b>' + r.parcels.length + '</b><span>' + balWord(r.parcels.length) + '</span></div>';
    h += '<div><b>' + fmtN(r.kg) + '</b><span>kg</span></div>';
    if (r.pallets.length) h += '<div><b>' + ldmText(r) + '</b><span>LDM</span></div>';
    h += '</div>';
  }
  if (r.errors.length) h += '<ul class="errors">' + r.errors.map(e => '<li>' + esc(e) + '</li>').join('') + '</ul>';
  h += compositionHtml(r);
  if (r.pallets.length || r.parcels.length) h += '<details class="panel"><summary>Parametry nákladu pro poptávku</summary><table><tbody>' + cargoRows(r).map(x => '<tr><th scope="row">' + esc(x[0]) + '</th><td>' + esc(x[1]) + '</td></tr>').join('') + '</tbody></table><p class="hint">LDM je odhad podle plochy palet: plocha ÷ šířka korby největšího vozidla.</p></details>';

  // visual at the bottom
  if (r.vehicles.length) {
    h += '<div class="sec-head vis"><h2>Nakládka: ' + esc(r.reco) + '</h2></div>';
    h += r.vehicles.map(v => vehicleHtml(Object.assign({}, v, { lift: vehicles[v.vi] && vehicles[v.vi].lift }))).join('');
    h += '<p class="note">Rozložení je orientační: pohled shora, palety nestohujeme, váha je bez vlastních palet. Nakládku a konečné rozhodnutí určuje dopravce.</p>';
  }
  const shipment = [];
  if (r.mode === 'groupage') r.pallets.forEach(p => shipment.push(Object.assign({ kind: 'paleta' }, p)));
  r.parcels.forEach(p => shipment.push(Object.assign({ kind: 'balik' }, p)));
  if (shipment.length) {
    h += '<div class="sec-head vis"><h2>Sběrná služba</h2></div><div class="panel"><p class="hint">' + (r.mode === 'groupage' ? 'Palety' + (r.parcels.length ? ' a balíky' : '') : 'Balíky') + ' předáte přepravci (' + PARCEL_SERVICES + '). Vlastní vozidlo není potřeba.</p><div class="plan">' + svgShipment(shipment) + '</div></div>';
  }
  if (r.mode !== 'warn' && r.mode !== 'empty') h += '<details><summary>Text poptávky</summary><textarea id="reqText" readonly>' + esc(requestText(r)) + '</textarea></details>';
  el.innerHTML = h;
}

// ---------- overview ----------
export function renderKpis(res) {
  const el = $('#kpis');
  if (!res.length) { el.innerHTML = ''; return; }
  let pal = 0, kg = 0, euro = 0, grp = 0, veh = 0, big = 0, par = 0;
  res.forEach(r => {
    pal += r.pallets.length; kg += r.kg; euro += r.euroCount || 0; par += r.parcels.length;
    if (r.mode === 'groupage' || r.mode === 'parcels') grp++;
    veh += r.vehicles.length; if (r.big && r.big.length) big++;
  });
  const card = (cls, ic, label, val, sub, chip) =>
    '<div class="kpi ' + cls + '"><span class="kpi-ic">' + icon(ic) + '</span><div class="kpi-label">' + label + '</div><div class="kpi-val">' + val + '</div><div class="kpi-sub"><span>' + sub + '</span>' + (chip ? '<span class="chip ' + chip[0] + '">' + chip[1] + '</span>' : '') + '</div></div>';
  el.innerHTML =
    card('', 'file', 'Zakázky', res.length, fmtKg(kg) + ' celkem') +
    card('', 'box', 'Palety', pal, euro + ' euro, ' + (pal - euro) + ' nestandardních' + (par ? ', ' + par + ' ' + balWord(par) : '')) +
    card('', 'truck', 'Sběrná služba', grp, 'palety a balíky', grp ? ['green', 'k odeslání'] : null) +
    card('alert', 'alert', 'Vlastní vozidlo', veh, big + ' ' + plural(big, ['zakázka', 'zakázky', 'zakázek']) + ' s nadrozměrem', veh ? ['red', 'k objednání'] : null);
}

export function renderPriorities(res, hidden) {
  const el = $('#prio');
  if (!res.length || hidden) { el.innerHTML = ''; return; }
  const items = [];
  const warn = res.filter(r => r.mode === 'warn'), trucks = res.filter(r => r.mode === 'trucks');
  const big = res.filter(r => r.big && r.big.length), grp = res.filter(r => r.mode === 'groupage' || r.mode === 'parcels');
  const errs = res.reduce((s, r) => s + r.errors.length, 0);
  if (warn.length) items.push({ c: 'red', t: 'Ke kontrole: <b>' + zak(warn.length) + '</b> (nevejde se nebo balík nad limit)', a: 'Zkontrolovat', id: warn[0].id });
  if (trucks.length) {
    const vc = trucks.reduce((s, r) => s + r.vehicles.length, 0);
    items.push({ c: 'red', t: 'Objednat vlastní vozidlo pro <b>' + trucks.length + ' ' + plural(trucks.length, ['zakázku', 'zakázky', 'zakázek']) + '</b> (' + vc + ' ' + vehWord(vc) + ')', a: 'Zobrazit', id: trucks[0].id });
  }
  if (big.length) items.push({ c: 'amber', t: 'S nadrozměrem: <b>' + zak(big.length) + '</b>, ověřte podmínky u dopravce', a: 'Zobrazit', id: big[0].id });
  if (grp.length) items.push({ c: 'blue', t: 'Sběrná služba: <b>' + zak(grp.length) + '</b>', a: 'Zobrazit', id: grp[0].id });
  if (errs) items.push({ c: 'gray', t: 'Chybí v číselníku: <b>' + errs + ' ' + plural(errs, ['položka', 'položky', 'položek']) + '</b>', a: 'Otevřít číselník', view: 'catalog' });
  if (!items.length) { el.innerHTML = ''; return; }
  const n = items.length;
  el.innerHTML = '<section class="card prio"><div class="prio-head"><span class="prio-ic">' + icon('alert') + '</span><div><h3>Dnešní priority</h3><p>' + n + ' ' + plural(n, ['položka vyžaduje pozornost', 'položky vyžadují pozornost', 'položek vyžaduje pozornost']) + '</p></div><button class="linkbtn" id="prioHide">Skrýt</button></div><ul>' +
    items.map(it => '<li><i class="pdot ' + it.c + '"></i><span>' + it.t + '</span><button class="linkbtn ' + (it.c === 'red' ? 'red' : '') + '" ' + (it.id ? 'data-id="' + esc(it.id) + '"' : 'data-view="' + it.view + '"') + '>' + it.a + ' ›</button></li>').join('') + '</ul></section>';
}

export function renderList(orders, results, sel, q) {
  const ul = $('#orderList');
  q = (q || '').trim().toLowerCase();
  const ids = [...orders.keys()].filter(id => {
    if (!q || id.toLowerCase().includes(q)) return true;
    return [...orders.get(id).lines.values()].some(l => l.code.toLowerCase().includes(q));
  });
  $('#orderCount').textContent = zak(ids.length);
  if (!ids.length) { ul.innerHTML = '<li class="empty">' + (orders.size ? 'Nic nenalezeno.' : 'Zakázky zatím nejsou.') + '</li>'; return; }
  ul.innerHTML = ids.map(id => {
    const r = results.get(id), c = (r.mode === 'groupage' || r.mode === 'parcels') ? 'green' : (r.mode === 'trucks' ? 'blue' : 'amber');
    return '<li><button class="feed" data-id="' + esc(id) + '"' + (id === sel ? ' aria-current="true"' : '') + '><i class="fdot ' + c + '"></i><span class="ftext"><b>Zakázka ' + esc(id) + '</b><span>' + esc(r.listInfo) + (r.vehicles.length ? ' · ' + esc(r.reco) : '') + '</span></span><span class="chip ' + c + '">' + esc(r.stat) + '</span></button></li>';
  }).join('');
}
