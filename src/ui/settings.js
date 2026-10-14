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

export function renderCatalog(catalog, view, pallets) {
  pallets = pallets || [];
  const list = filterCatalog(catalog, view.q), pages = Math.max(1, Math.ceil(list.length / PAGE));
  view.page = Math.min(view.page, pages - 1);
  const slice = list.slice(view.page * PAGE, view.page * PAGE + PAGE);
  $('#catBody').innerHTML = slice.map(i => {
    const a = catalog[i];
    const num = (f, min, step) => '<td><input type="number" min="' + (min || 0) + '" step="' + (step || 'any') + '" data-i="' + i + '" data-f="' + f + '" value="' + (a[f] == null ? '' : a[f]) + '"></td>';
    return '<tr><td><i class="sw" style="background:' + color(i) + '"></i><input type="text" data-i="' + i + '" data-f="code" value="' + esc(a.code) + '" aria-label="Artikl"></td>' +
      '<td>' + (a.name ? '<span class="ro-name" title="Název z ERP, nelze měnit">' + esc(a.name) + '</span>' : '<input type="text" data-i="' + i + '" data-f="name" value="" aria-label="Název" placeholder="doplnit">') + '</td>' +
      '<td><select data-i="' + i + '" data-f="pack" aria-label="Balení"><option value="paleta"' + (a.pack !== 'balik' && a.pack !== 'neurceno' ? ' selected' : '') + '>paleta</option><option value="balik"' + (a.pack === 'balik' ? ' selected' : '') + '>balík</option><option value="neurceno"' + (a.pack === 'neurceno' ? ' selected' : '') + '>neurčeno</option><option value="sluzba"' + (a.pack === 'sluzba' ? ' selected' : '') + '>služba</option></select></td>' +
      (a.pack === 'sluzba' ? '<td class="muted">nic se neveze</td>' : a.pack === 'neurceno' ? '<td class="muted">určí se při prvním zařazení</td>' : a.pack === 'balik'
        ? '<td><span class="dims"><input type="number" min="1" data-i="' + i + '" data-f="pl" value="' + (a.pl || '') + '" aria-label="Délka balíku, mm"> × <input type="number" min="1" data-i="' + i + '" data-f="pw" value="' + (a.pw || '') + '" aria-label="Šířka balíku, mm"> mm</span></td>'
        : '<td><select data-i="' + i + '" data-f="pal" aria-label="Typ palety">' + (a.pal ? '' : '<option value="">– vyberte –</option>') + pallets.map(p => '<option value="' + esc(p.code) + '"' + (p.code === a.pal ? ' selected' : '') + '>' + esc(p.code) + ' · ' + esc(p.name) + ' (' + Math.round(p.L / 10) + '×' + Math.round(p.W / 10) + ')</option>').join('') + '</select></td>') +
      num('per', 1, 1) + num('kg') +
      '<td><input type="checkbox" data-i="' + i + '" data-f="rot"' + (a.rot ? ' checked' : '') + ' aria-label="Lze otáčet"></td>' +
      '<td><button class="btn small" data-del="' + i + '">Smazat</button></td></tr>';
  }).join('') || '<tr><td colspan="9" class="empty">Nic nenalezeno.</td></tr>';
  $('#catInfo').textContent = list.length + ' ' + plural(list.length, ['artikl', 'artikly', 'artiklů']) + (list.length !== catalog.length ? ' z ' + catalog.length : '');
  $('#catPager').innerHTML = pages > 1
    ? '<button class="btn small" data-page="' + (view.page - 1) + '"' + (view.page === 0 ? ' disabled' : '') + '>‹ Předchozí</button><span class="muted">Strana ' + (view.page + 1) + ' z ' + pages + '</span><button class="btn small" data-page="' + (view.page + 1) + '"' + (view.page >= pages - 1 ? ' disabled' : '') + '>Další ›</button>'
    : '';
}

export function renderPallets(pallets, catalog, q) {
  const used = code => catalog.filter(a => a.pal === code).length;
  q = (q || '').trim().toLowerCase();
  const idx = pallets.map((p, i) => i).filter(i => !q || (pallets[i].code + ' ' + pallets[i].name + ' ' + pallets[i].L + '×' + pallets[i].W).toLowerCase().includes(q));
  $('#palInfo').textContent = idx.length + ' ' + plural(idx.length, ['typ', 'typy', 'typů']) + (idx.length !== pallets.length ? ' z ' + pallets.length : '');
  $('#palBody').innerHTML = idx.map(i => { const p = pallets[i];
    const num = (f, step) => '<td><input type="number" min="0" step="' + step + '" data-i="' + i + '" data-f="' + f + '" value="' + (p[f] == null ? '' : p[f]) + '"></td>';
    const n = used(p.code);
    return '<tr><td><input type="text" class="pal-code-in" data-pcode="' + i + '" value="' + esc(p.code) + '" aria-label="Kód palety"></td><td><input type="text" data-i="' + i + '" data-f="name" value="' + esc(p.name || '') + '" aria-label="Název"></td>' +
      num('L', '1') + num('W', '1') + num('H', '1') + num('tare', 'any') + num('maxKg', '1') +
      '<td><input type="checkbox" data-i="' + i + '" data-f="rot"' + (p.rot !== false ? ' checked' : '') + ' aria-label="Lze otáčet"></td>' +
      '<td class="num">' + n + '</td>' +
      '<td><button class="btn small" data-del="' + i + '"' + (n ? ' disabled title="Typ používají artikly"' : '') + '>Smazat</button></td></tr>';
  }).join('') || '<tr><td colspan="10" class="empty">Žádný typ palety.</td></tr>';
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

export function renderCombos(combos, catalog, pallets, projects) {
  pallets = pallets || []; projects = projects || [];
  // article codes for the inputs: one datalist outside the table, rebuilt only when the catalog changes
  const key = catalog.length + '|' + (catalog[0] && catalog[0].code) + '|' + (catalog[catalog.length - 1] && catalog[catalog.length - 1].code);
  let dl = document.getElementById('codeList');
  if (!dl) { dl = document.createElement('datalist'); dl.id = 'codeList'; document.body.appendChild(dl); }
  if (dl.dataset.key !== key) { dl.innerHTML = catalog.slice(0, 5000).map(a => '<option value="' + esc(a.code) + '">').join(''); dl.dataset.key = key; }
  const names = new Map(catalog.map(a => [String(a.code).toLowerCase(), a.name || '']));
  // one labelled field inside a cell (label above the input, so it is clear what each number means)
  const fld = (label, html, title) => '<label class="cf"' + (title ? ' title="' + esc(title) + '"' : '') + '><span>' + label + '</span>' + html + '</label>';
  $('#comboBody').innerHTML = combos.map((r, i) => {
    const inp = (f, ph, extra) => '<input type="text" list="codeList" data-i="' + i + '" data-f="' + f + '" value="' + esc(r[f] || '') + '" placeholder="' + ph + '"' + (extra || '') + '>';
    const num = (f, ph, step) => '<input type="number" min="0" step="' + (step || 1) + '" data-i="' + i + '" data-f="' + f + '" value="' + (r[f] > 0 ? r[f] : '') + '" placeholder="' + ph + '">';
    const host = r.mode === 'host', group = r.mode === 'group', pallet = r.mode === 'pallet', parcel = r.mode === 'parcel';
    const palSel = '<select data-i="' + i + '" data-f="pal" data-lazy="' + (group ? 'g' : 'p') + '" aria-label="Typ palety">' + (r.pal ? '<option value="' + esc(r.pal) + '" selected>' + esc(r.pal) + ' · ' + esc((pallets.find(p => p.code === r.pal) || {}).name || '') + '</option>' : (group ? '<option value="">– typ palety –</option>' : '<option value="">rozměr níže</option>')) + '</select>';
    const projSel = '<select data-i="' + i + '" data-f="project" aria-label="Projekt"><option value="">všechny projekty</option>' + projects.map(n => '<option' + (n === r.project ? ' selected' : '') + '>' + esc(n) + '</option>').join('') + (r.project && !projects.includes(r.project) ? '<option selected>' + esc(r.project) + '</option>' : '') + '</select>';
    // two kinds of packaging: 1 main item + přibal (rides on the main item's pallet), 2 mix (shared pallet by balení number)
    const main = !group;
    const kindSel = '<select class="kind-sel k-' + (main ? 1 : 2) + '" data-i="' + i + '" data-f="kind" aria-label="Typ balení">' +
      [['main', '1 · Hlavní položka'], ['mix', '2 · Mix paleta']].map(m => '<option value="' + m[0] + '"' + ((main ? 'main' : 'mix') === m[0] ? ' selected' : '') + '>' + m[1] + '</option>').join('') + '</select>';
    const codeF = main ? 'koli' : 'group';
    const codeIn = '<input type="text" class="bal-code" data-i="' + i + '" data-f="' + codeF + '" value="' + esc(r[codeF] || '') + '" placeholder="BAL-?">';
    const nm = names.get(String(r.code || '').toLowerCase()) || r.name || '';
    // pallet: main item → its pallet from the catalog (read only); mix → chosen pallet type
    const pt = c => pallets.find(p => String(p.code).toLowerCase() === String(c || '').toLowerCase());
    const ptxt = t => t ? '<small class="c-name">' + esc(t.code) + ' · ' + (t.L || 0) + ' × ' + (t.W || 0) + ' mm</small>' : '<small class="c-name warn">paleta neurčena</small>';
    // one pallet field: "Paleta hlavní položky" (type 1, pallet from the catalog of the main item) or a pallet from the list (mix)
    const ha = main ? catalog.find(x => String(x.code).toLowerCase() === String(r.host || '').toLowerCase()) : null;
    const shown = main ? pt(ha && ha.pal) : pt(r.pal);
    const pkSel = '<select data-i="' + i + '" data-f="palkind" data-lazy="m"' + (main ? '' : ' data-mix="1"') + ' aria-label="Paleta">' + (main
      ? '<option value="" selected>Paleta hlavní položky</option>'
      : '<option value="">Paleta hlavní položky</option>' + (r.pal ? '<option value="' + esc(r.pal) + '" selected>' + esc(r.pal) + ' · ' + esc((shown || {}).name || '') + '</option>' : '<option value="" selected disabled>– vyberte paletu –</option>')) + '</select>';
    const pal = fld('Paleta', pkSel) + (main ? '<div class="ro">' + esc(shown ? shown.name || shown.code : (ha && ha.pal) || 'hlavní položka nemá paletu') + '</div>' : '') + ptxt(shown);
    const pocty = main
      ? fld('Max ks na 1 hlavní položku', num('per', 'bez limitu'), 'Kolik kusů smí jet na jedné paletě hlavní položky. Co se nevejde, čeká vpravo.')
      : fld('Ověřeno ks', num('per', '–'), 'Tolik kusů už na této paletě jelo. Víc jich pojede také, paleta jen svítí oranžově.') + fld('Max ks', num('cap', 'bez limitu'), 'Když je v zakázce víc kusů, na paletu balení nepůjde žádný – všechny čekají vpravo.');
    return '<tr class="' + (r.on === false ? 'off ' : '') + 'kind-' + (main ? 1 : 2) + '"' + (r.note ? ' title="' + esc(r.note) + '"' : '') + '>' +
      '<td><input type="checkbox" data-i="' + i + '" data-f="on"' + (r.on !== false ? ' checked' : '') + ' aria-label="Aktivní"></td>' +
      '<td class="c-bal">' + fld('Číslo balení', codeIn) + fld('Typ', kindSel) + '</td>' +
      '<td class="c-art">' + fld('Artikl', inp('code', 'artikl', ' class="code-in"')) + (nm ? '<small class="c-name">' + esc(nm) + '</small>' : '') + (main ? fld('Hlavní položka', inp('host', 'artikl hlavní položky')) : '') + '</td>' +
      '<td class="c-kam">' + pal + '</td>' +
      '<td class="c-num">' + pocty + '</td>' +
      '<td class="c-proj">' + fld('Projekt', projSel) + '</td>' +
      '<td class="nowrap"><button class="btn small" data-up="' + i + '" aria-label="Výš"' + (i === 0 ? ' disabled' : '') + '>↑</button> <button class="btn small" data-down="' + i + '" aria-label="Níž"' + (i === combos.length - 1 ? ' disabled' : '') + '>↓</button> <button class="btn small" data-del="' + i + '" title="Smazat" aria-label="Smazat">×</button></td></tr>';
  }).join('') || '<tr><td colspan="7" class="empty">Zatím žádná pravidla. Bez pravidel platí běžný výpočet z číselníku.</td></tr>';
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
