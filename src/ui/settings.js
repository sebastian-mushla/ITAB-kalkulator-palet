import { esc, color, plural } from '../core/util.js';
import { VEHICLE_TYPES, RULE_FIELDS } from '../core/defaults.js';
import { COMBO_MODES } from '../core/combos.js';

const $ = s => document.querySelector(s);
export const PAGE = 100;

export function filterCatalog(catalog, q) {
  q = (q || '').trim().toLowerCase();
  const idx = catalog.map((a, i) => i);
  if (!q) return idx;
  return idx.filter(i => String(catalog[i].code).toLowerCase().includes(q) || String(catalog[i].name || '').toLowerCase().includes(q));
}

export function renderCatalog(catalog, view) {
  const list = filterCatalog(catalog, view.q), pages = Math.max(1, Math.ceil(list.length / PAGE));
  view.page = Math.min(view.page, pages - 1);
  const slice = list.slice(view.page * PAGE, view.page * PAGE + PAGE);
  $('#catBody').innerHTML = slice.map(i => {
    const a = catalog[i];
    const num = (f, min, step) => '<td><input type="number" min="' + (min || 0) + '" step="' + (step || 'any') + '" data-i="' + i + '" data-f="' + f + '" value="' + (a[f] == null ? '' : a[f]) + '"></td>';
    return '<tr><td><i class="sw" style="background:' + color(i) + '"></i><input type="text" data-i="' + i + '" data-f="code" value="' + esc(a.code) + '" aria-label="Artikl"></td>' +
      '<td><input type="text" data-i="' + i + '" data-f="name" value="' + esc(a.name || '') + '" aria-label="Název"></td>' +
      '<td><select data-i="' + i + '" data-f="pack" aria-label="Balení"><option value="paleta"' + (a.pack !== 'balik' ? ' selected' : '') + '>paleta</option><option value="balik"' + (a.pack === 'balik' ? ' selected' : '') + '>balík</option></select></td>' +
      num('pl') + num('pw') + num('per', 1, 1) + num('kg') +
      '<td><input type="checkbox" data-i="' + i + '" data-f="rot"' + (a.rot ? ' checked' : '') + ' aria-label="Lze otáčet"></td>' +
      '<td><button class="btn small" data-del="' + i + '">Smazat</button></td></tr>';
  }).join('') || '<tr><td colspan="9" class="empty">Nic nenalezeno.</td></tr>';
  $('#catInfo').textContent = list.length + ' ' + plural(list.length, ['artikl', 'artikly', 'artiklů']) + (list.length !== catalog.length ? ' z ' + catalog.length : '');
  $('#catPager').innerHTML = pages > 1
    ? '<button class="btn small" data-page="' + (view.page - 1) + '"' + (view.page === 0 ? ' disabled' : '') + '>‹ Předchozí</button><span class="muted">Strana ' + (view.page + 1) + ' z ' + pages + '</span><button class="btn small" data-page="' + (view.page + 1) + '"' + (view.page >= pages - 1 ? ' disabled' : '') + '>Další ›</button>'
    : '';
}

export function renderVehicles(vehicles) {
  $('#vehBody').innerHTML = vehicles.map((v, i) => {
    const num = (f, step, min) => '<td><input type="number" min="' + (min || 0) + '" step="' + step + '" data-i="' + i + '" data-f="' + f + '" value="' + (v[f] == null ? '' : v[f]) + '"></td>';
    return '<tr><td><input type="text" data-i="' + i + '" data-f="name" value="' + esc(v.name) + '" aria-label="Název"></td>' +
      '<td><select data-i="' + i + '" data-f="type" aria-label="Typ">' + VEHICLE_TYPES.map(t => '<option value="' + t[0] + '"' + (v.type === t[0] ? ' selected' : '') + '>' + t[1] + '</option>').join('') + '</select></td>' +
      num('L', '0.05') + num('W', '0.05') + num('kg', '50') + num('eup', '1') +
      '<td><input type="checkbox" data-i="' + i + '" data-f="lift"' + (v.lift ? ' checked' : '') + ' aria-label="Hydraulické čelo"></td>' +
      num('cost', '0.05') +
      '<td><button class="btn small" data-del="' + i + '">Smazat</button></td></tr>';
  }).join('') || '<tr><td colspan="9" class="empty">Žádné vozidlo. Přidejte aspoň jedno.</td></tr>';
}

export function renderCombos(combos, catalog) {
  const codes = '<datalist id="codeList">' + catalog.slice(0, 5000).map(a => '<option value="' + esc(a.code) + '">').join('') + '</datalist>';
  $('#comboBody').innerHTML = combos.map((r, i) => {
    const txt = (f, ph, dis) => '<td><input type="text" list="codeList" data-i="' + i + '" data-f="' + f + '" value="' + esc(r[f] || '') + '" placeholder="' + ph + '"' + (dis ? ' disabled' : '') + '></td>';
    const num = (f, ph, dis) => '<td><input type="number" min="0" step="1" data-i="' + i + '" data-f="' + f + '" value="' + (r[f] > 0 ? r[f] : '') + '" placeholder="' + ph + '"' + (dis ? ' disabled' : '') + '></td>';
    const host = r.mode === 'host';
    return '<tr' + (r.on === false ? ' class="off"' : '') + '>' +
      '<td><input type="checkbox" data-i="' + i + '" data-f="on"' + (r.on !== false ? ' checked' : '') + ' aria-label="Aktivní"></td>' +
      txt('code', 'artikl') + txt('withCode', 'libovolně') + num('min', '–') + num('max', '–') +
      '<td><select data-i="' + i + '" data-f="mode" aria-label="Pojede">' + COMBO_MODES.map(m => '<option value="' + m[0] + '"' + (r.mode === m[0] ? ' selected' : '') + '>' + m[1] + '</option>').join('') + '</select></td>' +
      txt('host', 'artikl', !host) + num('pl', host ? '' : 'z číselníku', host) + num('pw', host ? '' : 'z číselníku', host) + num('per', host ? 'bez limitu' : 'z číselníku') +
      '<td><input type="number" min="0" step="any" data-i="' + i + '" data-f="kg" value="' + (r.kg > 0 ? r.kg : '') + '" placeholder="z číselníku"></td>' +
      '<td><input type="text" data-i="' + i + '" data-f="note" value="' + esc(r.note || '') + '" aria-label="Poznámka"></td>' +
      '<td class="nowrap"><button class="btn small" data-up="' + i + '" aria-label="Výš"' + (i === 0 ? ' disabled' : '') + '>↑</button> <button class="btn small" data-down="' + i + '" aria-label="Níž"' + (i === combos.length - 1 ? ' disabled' : '') + '>↓</button> <button class="btn small" data-del="' + i + '">Smazat</button></td></tr>';
  }).join('') || '<tr><td colspan="14" class="empty">Zatím žádná pravidla. Bez pravidel platí běžný výpočet z číselníku.</td></tr>';
  $('#comboBody').insertAdjacentHTML('beforeend', codes);
}

export function renderRules(rules) {
  $('#rulesGrid').innerHTML = RULE_FIELDS.map(f => f[2] === 'bool'
    ? '<label class="rule-bool"><input type="checkbox" data-r="' + f[0] + '"' + (rules[f[0]] !== false ? ' checked' : '') + '><span>' + f[1] + '</span></label>'
    : '<label><span>' + f[1] + '</span><input type="number" step="' + f[2] + '" min="0" data-r="' + f[0] + '" value="' + rules[f[0]] + '"></label>').join('');
}

export function importReport(el, res, merged, replaced) {
  let h = '';
  if (merged) {
    h += '<p class="ok-line">' + (replaced ? 'Nahrazeno: ' + merged.list.length + ' řádků.' : 'Přidáno: ' + merged.added + ', aktualizováno: ' + merged.updated + '.') + '</p>';
  }
  if (res.errors.length) {
    h += '<p class="problems">Chyby (' + res.errors.length + '), tyto řádky se nenačetly:</p><ul class="errlist">' +
      res.errors.slice(0, 50).map(e => '<li>' + esc(e) + '</li>').join('') + (res.errors.length > 50 ? '<li>… a dalších ' + (res.errors.length - 50) + '</li>' : '') + '</ul>';
  }
  el.innerHTML = h;
}
