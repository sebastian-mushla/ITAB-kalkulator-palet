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

export function renderCatalog(catalog, view, pallets, combos) {
  pallets = pallets || []; combos = combos || [];
  // how the article is packed – only from Způsob balení (the catalog holds no packing)
  const KIND = { group: 'Mix', pallet: 'Solo P.', parcel: 'Solo B.' };
  const balOf = code => { const l = String(code || '').toLowerCase(), rs = combos.filter(r => r.on !== false && String(r.code || '').toLowerCase() === l);
    return rs.length ? rs.map(r => (r.mode === 'host' ? 'Hl.+přibal ' + (r.host || '?') : (KIND[r.mode] || r.mode) + (r.mode === 'group' ? ' ' + (r.group || '') : r.pal ? ' ' + r.pal : '')) + (r.project ? ' · ' + r.project : '')).map(esc).join('<br>') : '<span class="warn">není – čeká vpravo</span>'; };
  const list = filterCatalog(catalog, view.q), pages = Math.max(1, Math.ceil(list.length / PAGE));
  view.page = Math.min(view.page, pages - 1);
  const slice = list.slice(view.page * PAGE, view.page * PAGE + PAGE);
  $('#catBody').innerHTML = slice.map(i => {
    const a = catalog[i];
    const num = (f, min, step) => '<td><input type="number" min="' + (min || 0) + '" step="' + (step || 'any') + '" data-i="' + i + '" data-f="' + f + '" value="' + (a[f] == null ? '' : a[f]) + '"></td>';
    return '<tr><td><i class="sw" style="background:' + color(i) + '"></i><input type="text" data-i="' + i + '" data-f="code" value="' + esc(a.code) + '" aria-label="Artikl"></td>' +
      '<td>' + (a.name ? '<span class="ro-name" title="Název z ERP, nelze měnit">' + esc(a.name) + '</span>' : '<input type="text" data-i="' + i + '" data-f="name" value="" aria-label="Název" placeholder="doplnit">') + '</td>' +
      '<td><select data-i="' + i + '" data-f="pack" aria-label="Druh"><option value="neurceno"' + (a.pack !== 'sluzba' && a.pack !== 'kit' ? ' selected' : '') + '>zboží</option><option value="sluzba"' + (a.pack === 'sluzba' ? ' selected' : '') + '>služba</option><option value="kit"' + (a.pack === 'kit' ? ' selected' : '') + '>kit item</option></select></td>' +
      '<td class="muted small">' + (a.pack === 'sluzba' || a.pack === 'kit' ? 'nic se neveze' : balOf(a.code)) + '</td>' +
      num('kg') +
      // size of the article itself when it is bigger than its pallet (posts, tubes): pallet + overhang
      '<td><span class="dims"><input type="number" min="0" data-i="' + i + '" data-f="aL" value="' + (a.aL || '') + '" placeholder="–" aria-label="Délka artiklu, mm"> × <input type="number" min="0" data-i="' + i + '" data-f="aW" value="' + (a.aW || '') + '" placeholder="–" aria-label="Šířka artiklu, mm"></span></td>' +
      '<td><input type="checkbox" data-i="' + i + '" data-f="rot"' + (a.rot ? ' checked' : '') + ' aria-label="Lze otáčet"></td>' +
      '<td><button class="btn small" data-del="' + i + '">Smazat</button></td></tr>';
  }).join('') || '<tr><td colspan="8" class="empty">Nic nenalezeno.</td></tr>';
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
    const palSel = '<select data-i="' + i + '" data-f="pal" data-lazy="g" aria-label="Typ palety">' + (r.pal ? '<option value="' + esc(r.pal) + '" selected>' + esc(r.pal) + ' · ' + esc((pallets.find(p => p.code === r.pal) || {}).name || '') + '</option>' : (group ? '<option value="">– typ palety –</option>' : '<option value="">rozměr níže</option>')) + '</select>';
    const projSel = '<select data-i="' + i + '" data-f="project" aria-label="Projekt"><option value="">všechny projekty</option>' + projects.map(n => '<option' + (n === r.project ? ' selected' : '') + '>' + esc(n) + '</option>').join('') + (r.project && !projects.includes(r.project) ? '<option selected>' + esc(r.project) + '</option>' : '') + '</select>';
    // kinds of packaging: 1 main item + přibal (pallet of the main item), 2 mix (pallet from the list, by balení number), balík (parcel)
    const main = !group && !parcel && !pallet;
    const kind = main ? 'main' : group ? 'mix' : pallet ? 'solo' : 'parcel', kn = main ? 1 : group ? 2 : pallet ? 3 : 4;
    const kindSel = '<select class="kind-sel k-' + kn + '" data-i="' + i + '" data-f="kind" aria-label="Typ balení">' +
      [['main', '1 · Hl.+přibal'], ['mix', '2 · Mix'], ['solo', '3 · Solo P. (paleta)'], ['parcel', '4 · Solo B. (balík)']].map(m => '<option value="' + m[0] + '"' + (kind === m[0] ? ' selected' : '') + '>' + m[1] + '</option>').join('') + '</select>';
    const codeF = main ? 'koli' : group ? 'group' : '';
    const codeIn = codeF ? '<input type="text" class="bal-code" data-i="' + i + '" data-f="' + codeF + '" value="' + esc(r[codeF] || '') + '" placeholder="BAL-?">' : '<span class="bal-none">bez čísla</span>';
    const nm = names.get(String(r.code || '').toLowerCase()) || r.name || '';
    const pt = c => pallets.find(p => String(p.code).toLowerCase() === String(c || '').toLowerCase());
    const ptxt = t => t ? '<small class="c-name">' + esc(t.code) + ' · ' + (t.L || 0) + ' × ' + (t.W || 0) + ' mm</small>' : '<small class="c-name warn">paleta neurčena</small>';
    // "Typ palety" first, the fields of the chosen type below
    // pallet type follows the kind of balení (fixed, change the kind in the first column)
    const typSel = '<div class="ro">' + (main ? 'Paleta hlavního artiklu' : group || pallet ? 'Paleta ze seznamu' : 'Balík') + '</div>';
    let pal = fld('Typ palety', typSel);
    if (main) { const hl = String(r.host || '').toLowerCase(), hs = combos.find(x => x.mode === 'pallet' && String(x.code).toLowerCase() === hl && (!x.project || x.project === r.project)) || combos.find(x => x.mode === 'pallet' && String(x.code).toLowerCase() === hl), ha = hs || catalog.find(x => String(x.code).toLowerCase() === hl), t = pt(ha && ha.pal); pal += fld('Paleta hlavního artiklu', '<div class="ro">' + esc(t ? t.name || t.code : (ha && ha.pal) || (r.host ? 'hlavní položka nemá solo paletu' : 'zadejte hlavní položku')) + '</div>') + (t ? ptxt(t) : ''); }
    else if (group || pallet) pal += fld('Paleta ze seznamu', palSel) + ptxt(pt(r.pal));
    else pal += '<div class="cf2">' + fld('Délka balíku, mm', num('pl', 'mm')) + fld('Šířka balíku, mm', num('pw', 'mm')) + '</div>';
    const pocty = main
      ? fld('Max ks na 1 hlavní položku', num('per', 'bez limitu'), 'Kolik kusů smí jet na jedné paletě hlavní položky. Co se nevejde, čeká vpravo.')
      : group ? fld('Ověřeno ks', num('per', '–'), 'Tolik kusů už na této paletě jelo. Víc jich pojede také, paleta jen svítí oranžově.') + fld('Max ks', num('cap', 'bez limitu'), 'Víc kusů na paletu balení nejde – kusy navíc se přepočítají (jiné balení, solo), jinak čekají vpravo.')
      : fld(pallet ? 'Ks na paletě' : 'Ks v balíku', num('per', 'vše na jedné'), 'Prázdné = celé množství na jedné paletě / v jednom balíku. 1 = každý kus zvlášť.') +
        // solo / balík can depend on the quantity in the order (e.g. from 150 ks on a pallet, up to 149 ks as balík)
        '<div class="cf2">' + fld('Od ks v zakázce', num('min', '–'), 'Platí, když je v zakázce aspoň tolik kusů.') + fld('Do ks v zakázce', num('max', '–'), 'Platí, když je v zakázce nejvýš tolik kusů.') + '</div>';
    const day = r.at ? String(r.at).slice(0, 10) : '';
    return '<tr data-by="' + esc(r.by || '') + '" data-day="' + day + '" class="' + (r.on === false ? 'off ' : '') + 'kind-' + kn + '"' + (r.note ? ' title="' + esc(r.note) + '"' : '') + '>' +
      '<td><input type="checkbox" data-i="' + i + '" data-f="on"' + (r.on !== false ? ' checked' : '') + ' aria-label="Aktivní"></td>' +
      '<td class="c-bal">' + fld('Číslo balení', codeIn) + fld('Typ', kindSel) + '</td>' +
      '<td class="c-art">' + fld('Artikl', inp('code', 'artikl', ' class="code-in"')) + (nm ? '<small class="c-name">' + esc(nm) + '</small>' : '') + (main ? fld('Hlavní položka', inp('host', 'artikl hlavní položky')) : '') + '</td>' +
      '<td class="c-kam">' + pal + '</td>' +
      '<td class="c-num">' + pocty + '</td>' +
      '<td class="c-proj">' + fld('Projekt', projSel) + '</td>' +
      '<td class="nowrap"><button class="btn small" data-up="' + i + '" aria-label="Výš"' + (i === 0 ? ' disabled' : '') + '>↑</button> <button class="btn small" data-down="' + i + '" aria-label="Níž"' + (i === combos.length - 1 ? ' disabled' : '') + '>↓</button> <button class="btn small" data-del="' + i + '" title="Smazat" aria-label="Smazat">×</button></td>' +
      '<td class="c-who">' + (r.by ? esc(r.by) + '<br><small class="muted">' + new Date(r.at).toLocaleString('cs-CZ') + '</small>' : '<small class="muted">–</small>') + '</td></tr>';
  }).join('') || '<tr><td colspan="8" class="empty">Zatím žádná pravidla. Bez pravidel platí běžný výpočet z číselníku.</td></tr>';
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
