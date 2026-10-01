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
  const drag = v.idx != null;
  let s = '<svg viewBox="0 0 ' + vbW + ' ' + vbH + '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Schéma nakládky: ' + esc(v.title) + '"' + (drag ? ' class="veh-svg" data-v="' + v.idx + '" data-x0="' + x0 + '" data-y0="' + y0 + '" data-s="' + S + '"' : '') + ' style="min-width:' + Math.min(560, Math.max(320, Math.round(vbW * 0.62))) + 'px;max-width:' + Math.round(vbW * 1.15) + 'px">';
  const depot = v.type === 'depot';
  if (depot) {
    // handover floor: hatched outline, carrier names, no cab
    s += '<defs><pattern id="hatch' + (v.idx || 0) + '" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="10" style="stroke:var(--line);stroke-width:4"/></pattern></defs>';
    s += '<rect x="' + (x0 - 70) + '" y="' + y0 + '" width="62" height="' + Hw + '" rx="8" style="fill:var(--green-t);stroke:var(--green);stroke-width:1.5"/>';
    s += '<text transform="translate(' + (x0 - 39) + ' ' + (y0 + Hw / 2) + ') rotate(-90)" style="fill:var(--green);font-size:12px;font-weight:700;text-anchor:middle;letter-spacing:.04em">PŘEDÁVKA</text>';
    s += '<rect x="' + x0 + '" y="' + y0 + '" width="' + Lw + '" height="' + Hw + '" rx="6" style="fill:url(#hatch' + (v.idx || 0) + ');stroke:var(--green);stroke-width:2;stroke-dasharray:8 5"/>';
  }
  const ch = Hw * 0.78, cy = y0 + (Hw - ch) / 2;
  if (!depot) s += '<path d="M 12 ' + (cy + ch * 0.25) + ' L 30 ' + cy + ' L ' + (x0 - 6) + ' ' + cy + ' L ' + (x0 - 6) + ' ' + (cy + ch) + ' L 30 ' + (cy + ch) + ' L 12 ' + (cy + ch * 0.75) + ' Z" style="fill:var(--truck);stroke:var(--truck-line);stroke-width:2"/>';
  if (!depot) {
    s += '<rect x="24" y="' + (cy + ch * 0.2) + '" width="9" height="' + (ch * 0.6) + '" style="fill:var(--ink2);fill-opacity:.55"/>';
    s += '<rect x="' + x0 + '" y="' + y0 + '" width="' + Lw + '" height="' + Hw + '" style="fill:var(--truck);stroke:var(--truck-line);stroke-width:2"/>';
  }
  if (v.lift) s += '<rect x="' + (x0 + Lw + 3) + '" y="' + (y0 + Hw * 0.1) + '" width="' + (lift - 6) + '" height="' + (Hw * 0.8) + '" rx="2" style="fill:none;stroke:var(--truck-line);stroke-width:2;stroke-dasharray:4 3"/>';
  v.items.forEach(it => {
    const px = x0 + it.x / S + 1.5, py = y0 + it.y / S + 1.5, pw = it.w / S - 3, ph = it.h / S - 3, col = color(it.ci), partial = it.fill < 0.999;
    if (drag) s += '<g class="pal" data-v="' + v.idx + '" data-p="' + it.id + '"><title>' + esc(it.code) + ', ' + it.units + ' ks – přetáhněte, dvojklik otočí</title>';
    if (partial) {
      s += '<rect x="' + px + '" y="' + py + '" width="' + pw + '" height="' + ph + '" rx="2" style="fill:' + col + ';fill-opacity:.3;stroke:' + col + ';stroke-width:2"/>';
      if (pw >= ph) s += '<rect x="' + px + '" y="' + py + '" width="' + (pw * it.fill) + '" height="' + ph + '" rx="2" style="fill:' + col + '"/>';
      else s += '<rect x="' + px + '" y="' + py + '" width="' + pw + '" height="' + (ph * it.fill) + '" rx="2" style="fill:' + col + '"/>';
    } else s += '<rect x="' + px + '" y="' + py + '" width="' + pw + '" height="' + ph + '" rx="2" style="fill:' + col + '"/>';
    if (ph >= 24 && pw >= 50) {
      const l1 = it.code, l2 = it.units + ' ks' + (partial ? ', ' + Math.round(it.fill * 100) + '%' : '');
      const l3 = it.extra ? '+ ' + it.extra.map(e => e.code + ' ' + e.units + ' ks').join(', ') : '';
      const fs = Math.max(9, Math.min(18, ph / (l3 ? 5.4 : 4.2), pw / (0.6 * Math.max(l1.length, l2.length, l3.length) + 0.6)));
      const cx = px + pw / 2, cyy = py + ph / 2;
      const st = 'fill:#fff;font-weight:600;text-anchor:middle;paint-order:stroke;stroke:' + col + ';stroke-width:3px;stroke-linejoin:round;font-size:' + fs.toFixed(1) + 'px';
      s += '<text x="' + cx + '" y="' + (cyy - fs * 0.1) + '" style="' + st + '">' + esc(l1) + '</text>';
      s += '<text x="' + cx + '" y="' + (cyy + fs * 1.1) + '" style="' + st + '">' + esc(l2) + '</text>';
      if (l3) s += '<text x="' + cx + '" y="' + (cyy + fs * 2.3) + '" style="' + st + '">' + esc(l3) + '</text>';
    }
    if (drag) s += '</g>';
  });
  const ry = y0 + Hw + 6;
  if (depot) return s + '<text x="' + x0 + '" y="' + (ry + 18) + '" style="fill:var(--ink2);font-size:12px">PPL · DPD · UPS · Česká pošta — palety se předávají přepravci, bez vlastního vozidla</text></svg>';
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
    r.vehicles.forEach(v => L.push(v.title + ' (' + fmtM(v.L) + ' m): ' + groupItems(v.items).map(g => g.code + ' ' + g.count + ' ' + palWord(g.count) + ' (' + g.units + ' ks)').concat(extrasOf(v.items).map(e => '+ ' + e.code + ' ' + e.units + ' ks na paletách ' + e.host)).join(', ')));
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
  } else if (r.manualOn && r.mode === 'trucks') {
    h2 = 'Objednat: ' + (r.reco || 'žádné vozidlo');
    p = 'Rozložení upraveno ručně.' + (r.overweight.length ? ' Přetížené: ' + r.overweight.map(v => v.title).join(', ') + '.' : '') + parcelNote;
    if (r.overweight.length) cls = 'warn';
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
  return '<div class="decision ' + cls + '"><div><h2>' + esc(h2) + '</h2><p>' + esc(p) + '</p></div>' + (btn ? '<div class="dec-acts"><button class="btn primary" id="ringilBtn">Objednat dopravu (Ringil)</button><button class="btn primary" id="packBtn">Tisk pro balení</button><button class="btn" id="loadPrintBtn">Tisk nakládky</button><button class="btn" id="copyBtn">Zkopírovat text</button></div>' : '') + '</div>';
}
function compositionHtml(r) {
  const body = r.rows.map(x => {
    const parts = [];
    if (x.onHost) parts.push(x.onHost + ' ks na paletách ' + x.host);
    if (!x.count) { /* everything rides on host pallets */ }
    else if (x.pack === 'balik') parts.push(x.count + ' ' + balWord(x.count) + ' po ' + x.per + ' ks' + (x.rem ? ' (poslední ' + x.rem + ' ks)' : ''));
    else if (x.per === 1) parts.push(x.full + ' ' + palWord(x.full));
    else {
      if (x.full > 0) parts.push(x.full + ' ' + plural(x.full, ['plná', 'plné', 'plných']));
      if (x.rem > 0) parts.push('1 neúplná: ' + x.rem + ' ks, ' + Math.round(x.fillRem * 100) + '%');
    }
    return '<tr><td><i class="sw" style="background:' + color(x.ci) + '"></i>' + esc(x.code) + '<br><span class="hint">' + esc(x.name || '') + '</span></td><td class="num">' + fmtN(x.qty) + ' ks</td><td>' + esc(parts.join(', ')) + (x.rule ? '<br><span class="rule-note">Pravidlo: ' + esc(x.rule) + '</span>' : '') + '</td><td class="num">' + fmtKg(x.kg) + '</td></tr>';
  }).join('');
  return '<div class="panel"><h3>Složení zakázky</h3><div class="tscroll"><table><thead><tr><th>Artikl</th><th class="num">Množství</th><th>Palety / balíky</th><th class="num">Váha</th></tr></thead><tbody>' + body + '</tbody></table></div></div>';
}
function extrasOf(items) {
  const m = new Map();
  items.forEach(it => (it.extra || []).forEach(e => {
    const k = e.code + '|' + it.code, g = m.get(k) || { code: e.code, ci: e.ci, host: it.code, units: 0 };
    g.units += e.units; m.set(k, g);
  }));
  return [...m.values()];
}
function vehicleHtml(v) {
  const legend = groupItems(v.items).map(g => '<li><i class="sw" style="background:' + color(g.ci) + '"></i>' + esc(g.code) + ': ' + g.count + ' ' + palWord(g.count) + ', ' + g.units + ' ks</li>').join('') +
    extrasOf(v.items).map(e => '<li><i class="sw" style="background:' + color(e.ci) + '"></i>' + esc(e.code) + ': ' + e.units + ' ks na paletách ' + esc(e.host) + '</li>').join('');
  const load = v.maxKg ? Math.round(v.kg / v.maxKg * 100) : 0, over = v.kg > v.maxKg;
  const rm = v.idx != null && !v.items.length ? '<button class="veh-x" data-rmveh="' + v.idx + '" aria-label="Odebrat vozidlo">×</button>' : '';
  return '<article class="panel veh' + (over ? ' over' : '') + '"><header><h3>' + esc(v.title) + ', korba ' + fmtM(v.L) + ' × ' + fmtM(v.W) + ' m</h3><p>' + (v.items.length ? v.items.length + ' ' + palWord(v.items.length) + ', ' + fmtKg(v.kg) + ' (' + load + ' % nosnosti' + (over ? ', přetíženo!' : '') + ')' : 'prázdné – přetáhněte sem palety') + rm + '</p></header><ul class="legend">' + legend + '</ul><div class="plan">' + svgVehicle(v) + '</div></article>';
}
function depotHtml(d, rules) {
  const nonEuro = [...new Set(d.items.filter(p => !p.euro).map(p => p.code))];
  const issues = [];
  if (d.items.length > rules.gMax) issues.push(d.items.length + ' palet, limit sběrné služby je ' + rules.gMax);
  if (nonEuro.length) issues.push('nejsou europalety: ' + nonEuro.join(', '));
  const rm = !d.items.length ? '<button class="veh-x" data-rmveh="' + d.idx + '" aria-label="Odebrat sběrnou službu">×</button>' : '';
  return '<article class="panel veh depot' + (issues.length ? ' over' : '') + '"><header><h3>Sběrná služba – předávka přepravci</h3><p>' +
    (d.items.length ? d.items.length + ' ' + palWord(d.items.length) + ', ' + fmtKg(d.kg) + (issues.length ? ' – ' + esc(issues.join('; ')) : '') : 'prázdné – přetáhněte sem palety') + rm + '</p></header>' +
    '<div class="plan">' + svgVehicle(Object.assign({}, d, { lift: false })) + '</div></article>';
}
function vehiclePicker(r, vehicles) {
  if (!r.pallets.length) return '';
  const opts = ['<option value="">Automaticky (nejvýhodnější)</option>'].concat(vehicles.map((v, i) =>
    '<option value="' + i + '"' + (r.forced === i ? ' selected' : '') + '>' + esc(v.name) + ' – ' + String(v.L).replace('.', ',') + ' m, ' + fmtN(v.kg) + ' kg</option>'));
  return '<label class="picker"><span>Vozidlo</span><select id="forceVeh">' + opts.join('') + '</select></label>';
}

// Printable loading plan: every vehicle drawn from above with its legend.
export function loadPlanHtml(r, vehicles) {
  const vs = r.vehicles.filter(v => v.items.length).concat(r.depot && r.depot.items.length ? [r.depot] : []);
  const body = vs.length ? vs.map(v => {
    const plain = Object.assign({}, v, { idx: null, lift: vehicles[v.vi] && vehicles[v.vi].lift });
    const legend = groupItems(v.items).map(g => '<li><i style="background:' + color(g.ci) + '"></i>' + esc(g.code) + ': ' + g.count + ' ' + palWord(g.count) + ', ' + g.units + ' ks</li>').join('') +
      extrasOf(v.items).map(e => '<li><i style="background:' + color(e.ci) + '"></i>' + esc(e.code) + ': ' + e.units + ' ks na paletách ' + esc(e.host) + '</li>').join('');
    return '<section><h2>' + esc(v.title) + ' <small>korba ' + fmtM(v.L) + ' × ' + fmtM(v.W) + ' m · ' + v.items.length + ' ' + palWord(v.items.length) + ' · ' + fmtKg(v.kg) + '</small></h2><ul>' + legend + '</ul>' + svgVehicle(plain) + '</section>';
  }).join('') : '<p>Zakázka nemá vlastní vozidlo (jede sběrnou službou).</p>';
  return '<!DOCTYPE html><html lang="cs"><head><meta charset="utf-8"><title>Nakládka – zakázka ' + esc(r.id) + '</title><style>' +
    ':root{--truck:#F1EFFA;--truck-line:#4A4568;--ink2:#555}' +
    'body{font-family:Inter,Arial,sans-serif;color:#111;margin:24px;font-size:13px}h1{font-size:22px;margin:0 0 4px}.meta{color:#555}' +
    'section{margin-top:20px;break-inside:avoid}h2{font-size:16px;margin:0 0 6px}h2 small{color:#555;font-weight:400;font-size:13px}' +
    'ul{list-style:none;padding:0;margin:0 0 8px;display:flex;flex-wrap:wrap;gap:4px 16px}ul i{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:6px;vertical-align:-1px}' +
    'svg{width:100%;height:auto;max-width:100%!important;min-width:0!important}' +
    '@media print{body{margin:10mm}button{display:none}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}@page{size:landscape}' +
    '</style></head><body><button onclick="print()" style="float:right;padding:8px 16px">Tisknout</button>' +
    '<h1>Nakládka – zakázka ' + esc(r.id) + '</h1><div class="meta">' + new Date().toLocaleDateString('cs-CZ') + (r.reco ? ' · ' + esc(r.reco) : '') + ' · ' + fmtKg(r.kg) + ' · pohled shora, přední čelo vlevo</div>' + body + '</body></html>';
}

export function renderDetail(r, { rules, vehicles, isAdmin }) {
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
  const unk = r.unknown || [];
  const tray = unk.length ? '<aside class="tray" aria-label="Neznámé artikly"><h3>Neznámé artikly</h3><p class="hint">' +
    (isAdmin ? 'Přetáhněte na paletu (uloží se kombinace) nebo na volné místo ve vozidle (nový artikl).' : 'Tyto artikly nejsou v číselníku. Požádejte administrátora o doplnění.') + '</p>' +
    unk.map(u => '<div class="unk' + (isAdmin ? '' : ' ro') + '" data-code="' + esc(u.code) + '" data-qty="' + u.qty + '" data-name="' + esc(u.name || '') + '"' + (isAdmin ? ' title="Přetáhněte do vozidla"' : '') + '><div class="unk-top"><b>' + esc(u.code) + '</b><span>' + fmtN(u.qty) + ' ks</span></div>' + (u.name ? '<div class="unk-name">' + esc(u.name) + '</div>' : '') + '</div>').join('') + '</aside>' : '';
  if (r.vehicles.length || r.pallets.length || unk.length) {
    const opts = vehicles.map((v, i) => '<option value="' + i + '">' + esc(v.name) + ' – ' + String(v.L).replace('.', ',') + ' × ' + String(v.W).replace('.', ',') + ' m</option>').join('') +
      (r.depot ? '' : '<option value="depot">Sběrná služba (PPL, DPD, UPS…)</option>');
    h += '<div class="sec-head vis"><h2>Nakládka' + (r.vehicles.length ? ': ' + esc(r.reco || 'žádné vozidlo') : '') + '</h2>' +
      '<div class="vehtools"><select id="addVehSel" aria-label="Vozidlo k přidání">' + opts + '</select><button class="btn" id="addVehBtn">+ Přidat vozidlo</button>' +
      (r.manualOn ? '<button class="btn" id="resetManual">Vrátit automatické rozložení</button>' : '') + '</div></div>';
    h += '<div class="load' + (tray ? ' with-tray' : '') + '"><div class="load-main">';
    if (r.vehicles.length || r.depot) h += '<p class="hint drag-hint">Paletu chyťte myší a přetáhněte jinam nebo do jiného vozidla. Dvojklik paletu otočí. Prázdné vozidlo odeberete křížkem.</p>';
    h += r.vehicles.map((v, i) => vehicleHtml(Object.assign({ idx: i }, v, { lift: vehicles[v.vi] && vehicles[v.vi].lift }))).join('');
    if (r.depot) h += depotHtml(r.depot, rules);
    if (!r.vehicles.length && unk.length) h += '<div class="panel empty-load">Zatím žádné vozidlo. Přidejte vozidlo tlačítkem „+ Přidat vozidlo“ a pak do něj přetáhněte neznámý artikl.</div>';
    h += '</div>' + tray + '</div>';
    h += '<p class="note">Rozložení je orientační: pohled shora, palety nestohujeme, váha je bez vlastních palet. Nakládku a konečné rozhodnutí určuje dopravce.</p>';
  }
  const shipment = [];
  if (r.mode === 'groupage' && !r.depot) r.pallets.forEach(p => shipment.push(Object.assign({ kind: 'paleta' }, p)));
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

// ring like a usage meter: share of the order's articles that are in the catalog
function ring(known, total) {
  const p = total ? known / total : 1, C = 2 * Math.PI * 14;
  const col = p >= 1 ? 'var(--green)' : p >= 0.5 ? 'var(--amber)' : 'var(--red)';
  return '<svg class="ring" viewBox="0 0 36 36" width="38" height="38" role="img" aria-label="Zařazeno ' + known + ' z ' + total + ' artiklů"><title>Zařazeno ' + known + ' z ' + total + ' artiklů</title>' +
    '<circle cx="18" cy="18" r="14" style="fill:none;stroke:var(--line);stroke-width:4"/>' +
    '<circle cx="18" cy="18" r="14" transform="rotate(-90 18 18)" style="fill:none;stroke:' + col + ';stroke-width:4;stroke-linecap:round;stroke-dasharray:' + (C * p).toFixed(1) + ' ' + C.toFixed(1) + '"/>' +
    '<text x="18" y="21.5" style="fill:var(--ink);font-size:' + (total >= 10 ? 8 : 10) + 'px;font-weight:700;text-anchor:middle">' + known + '/' + total + '</text></svg>';
}
function unkChip(r) {
  const n = (r.unknown || []).length;
  return n ? '<span class="unk-line" title="' + esc(r.unknown.map(u => u.code).join(', ')) + '">' + n + ' ' + plural(n, ['nezařazený artikl', 'nezařazené artikly', 'nezařazených artiklů']) + '</span>' : '';
}
// what to order, as one short text for the list
function transportText(r) {
  const parts = [];
  if (r.reco) parts.push(r.reco);
  else if (r.mode === 'groupage') parts.push('Sběrná služba (palety)');
  if (r.parcels && r.parcels.length) parts.push('Sběrná služba (' + r.parcels.length + ' ' + balWord(r.parcels.length) + ')');
  return parts.length ? ' · ' + esc(parts.join(' + ')) : '';
}
export function renderList(orders, results, sel, q, done) {
  done = done || new Set();
  const ul = $('#orderList');
  q = (q || '').trim().toLowerCase();
  const ids = [...orders.keys()].filter(id => {
    if (!q || id.toLowerCase().includes(q)) return true;
    return [...orders.get(id).lines.values()].some(l => l.code.toLowerCase().includes(q));
  });
  // finished orders go to the bottom
  ids.sort((a, b) => (done.has(a) ? 1 : 0) - (done.has(b) ? 1 : 0));
  $('#orderCount').textContent = zak(ids.length);
  if (!ids.length) { ul.innerHTML = '<li class="empty">' + (orders.size ? 'Nic nenalezeno.' : 'Zakázky zatím nejsou.') + '</li>'; return; }
  ul.innerHTML = ids.map(id => {
    const r0 = results.get(id), total = orders.get(id).lines.size;
    const r = Object.assign({}, r0, { total, known: total - new Set((r0.unknown || []).map(u => u.code.toLowerCase())).size });
    const c = (r.mode === 'groupage' || r.mode === 'parcels') ? 'green' : (r.mode === 'trucks' ? 'blue' : 'amber');
    const full = r.known === r.total, isDone = done.has(id);
    const tick = '<label class="feed-done" title="' + (full ? 'Označit jako vyřízenou' : 'Nejdřív zařaďte všechny artikly') + '"><input type="checkbox" data-done="' + esc(id) + '"' + (isDone ? ' checked' : '') + (full ? '' : ' disabled') + ' aria-label="Zakázka ' + esc(id) + ' vyřízena"></label>';
    return '<li class="feedrow' + (isDone ? ' done' : '') + '">' + tick + '<button class="feed" data-id="' + esc(id) + '"' + (id === sel ? ' aria-current="true"' : '') + '>' + ring(r.known, r.total) + '<span class="ftext"><b>Zakázka ' + esc(id) + '</b><span>' + esc(r.listInfo) + transportText(r) + '</span>' + unkChip(r) + '</span><span class="chip ' + c + '">' + esc(r.stat) + '</span></button>' +
      '<button class="feed-x" data-del="' + esc(id) + '" aria-label="Odebrat zakázku ' + esc(id) + '" title="Odebrat ze seznamu">×</button></li>';
  }).join('');
}
