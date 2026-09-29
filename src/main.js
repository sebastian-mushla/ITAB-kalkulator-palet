import { clone, toNum } from './core/util.js';
import { DEFAULT_CATALOG, DEFAULT_VEHICLES, DEFAULT_RULES, SAMPLE } from './core/defaults.js';
import { parseOrders, rowsToOrderText } from './core/parse.js';
import { solve } from './core/solve.js';
import { readFileRows, isSpreadsheet, rowsToCatalog, rowsToVehicles, mergeBy, toCsv } from './io/importTable.js';
import { renderKpis, renderPriorities, renderList, renderDetail, requestText } from './ui/orders.js';
import { renderCatalog, renderVehicles, renderRules, importReport } from './ui/settings.js';

const $ = s => document.querySelector(s);
const KEYS = { catalog: 'itab.catalog.v1', vehicles: 'itab.vehicles.v1', rules: 'itab.rules.v1', csv: 'itab.orders.v1' };
function load(key, def) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch (e) { return def; } }
function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* storage full or blocked */ } }

// the prototype stored the catalog under this key; take it over once
const oldCat = load('palcalc.catalog.v3', null);
const savedCat = load(KEYS.catalog, null) || (Array.isArray(oldCat) ? oldCat.map(a => Object.assign({ pack: 'paleta' }, a)) : null);
const savedVeh = load(KEYS.vehicles, null);
const state = {
  catalog: Array.isArray(savedCat) && savedCat.length ? savedCat : clone(DEFAULT_CATALOG),
  vehicles: Array.isArray(savedVeh) && savedVeh.length ? savedVeh : clone(DEFAULT_VEHICLES),
  rules: Object.assign(clone(DEFAULT_RULES), load(KEYS.rules, {})),
  csv: load(KEYS.csv, SAMPLE),
  orders: new Map(), results: new Map(), forced: new Map(), sel: null, prioHidden: false,
  catView: { q: '', page: 0 }
};

// ---------- calculation ----------
function ctx(id) {
  return { catalog: state.catalog, vehicles: state.vehicles, rules: state.rules, forced: state.forced.has(id) ? state.forced.get(id) : null };
}
function recalc() {
  state.results = new Map();
  state.forced.forEach((vi, id) => { if (!(vi < state.vehicles.length)) state.forced.delete(id); });
  state.orders.forEach(o => state.results.set(o.id, solve(o, ctx(o.id))));
  if (!state.orders.has(state.sel)) state.sel = state.orders.size ? state.orders.keys().next().value : null;
  renderOverview();
}
function renderOverview() {
  const res = [...state.results.values()];
  renderKpis(res);
  renderPriorities(res, state.prioHidden);
  renderList(state.orders, state.results, state.sel, $('#q').value);
  renderDetail(state.results.get(state.sel), state);
}
function importOrders(text) {
  const res = parseOrders(text);
  state.orders = res.orders; state.forced = new Map(); state.prioHidden = false;
  $('#problems').textContent = res.problems.length ? 'Nerozpoznáno: ' + res.problems.join('; ') + '.' : '';
  state.sel = state.orders.size ? state.orders.keys().next().value : null;
  recalc();
}
let timer = null;
function later() { clearTimeout(timer); timer = setTimeout(recalc, 250); }

// ---------- navigation ----------
const VIEWS = ['orders', 'catalog', 'vehicles', 'rules'];
function showView(v) {
  VIEWS.forEach(x => {
    const on = x === v;
    $('#view-' + x).hidden = !on;
    $('#tab-' + x).setAttribute('aria-selected', on ? 'true' : 'false');
  });
}
document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => showView(b.getAttribute('data-view'))));
function goDetail() {
  const d = $('#detail');
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (d && d.scrollIntoView) d.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
}
function select(id) { state.sel = id; renderList(state.orders, state.results, state.sel, $('#q').value); renderDetail(state.results.get(id), state); goDetail(); }

$('#q').addEventListener('input', () => { showView('orders'); renderList(state.orders, state.results, state.sel, $('#q').value); });
$('#prio').addEventListener('click', e => {
  if (e.target.id === 'prioHide') { state.prioHidden = true; renderPriorities([], true); return; }
  const b = e.target.closest('button[data-id],button[data-view]'); if (!b) return;
  if (b.getAttribute('data-view')) { showView(b.getAttribute('data-view')); return; }
  select(b.getAttribute('data-id'));
});
$('#orderList').addEventListener('click', e => { const b = e.target.closest('.feed'); if (b) select(b.getAttribute('data-id')); });

// ---------- order import ----------
$('#btnCalc').addEventListener('click', () => { state.csv = $('#csv').value; save(KEYS.csv, state.csv); importOrders(state.csv); });
async function orderFile(f) {
  try {
    const { rows, text } = await readFileRows(f);
    const t = isSpreadsheet(f.name) || /\.csv$/i.test(f.name) ? rowsToOrderText(rows) : text;
    $('#csv').value = t; state.csv = t; save(KEYS.csv, t); importOrders(t);
  } catch (err) { $('#problems').textContent = err.message; }
}
$('#file').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; if (f) orderFile(f); e.target.value = ''; });
const drop = $('#dropZone');
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('drag'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('drag'); }));
drop.addEventListener('drop', e => { const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) orderFile(f); });

// ---------- detail ----------
$('#detail').addEventListener('change', e => {
  if (e.target.id !== 'forceVeh') return;
  const id = state.sel, v = e.target.value;
  if (v === '') state.forced.delete(id); else state.forced.set(id, Number(v));
  const o = state.orders.get(id);
  state.results.set(id, solve(o, ctx(id)));
  renderOverview();
});
$('#detail').addEventListener('click', e => {
  if (e.target.id !== 'copyBtn') return;
  const r = state.results.get(state.sel); if (!r) return;
  const btn = e.target;
  const done = msg => { btn.textContent = msg; setTimeout(() => { btn.textContent = 'Zkopírovat poptávku'; }, 2000); };
  const fallback = () => {
    const d = document.querySelector('#detail details:last-of-type'), ta = $('#reqText');
    if (d) d.open = true;
    if (ta) { ta.focus(); ta.select(); try { if (document.execCommand('copy')) { done('Zkopírováno'); return; } } catch (x) { /* ignore */ } }
    done('Označte text a zkopírujte ručně');
  };
  try { navigator.clipboard.writeText(requestText(r)).then(() => done('Zkopírováno'), fallback); } catch (x) { fallback(); }
});

// ---------- shared table helpers ----------
function download(name, rows) {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function cellValue(t) {
  if (t.type === 'checkbox') return t.checked;
  if (t.type === 'number') return toNum(t.value) || 0;
  return t.value;
}
function bindTable(body, list, key, rerender) {
  body.addEventListener('input', e => {
    const t = e.target, i = t.getAttribute('data-i'), f = t.getAttribute('data-f');
    if (i == null || t.type === 'checkbox' || t.tagName === 'SELECT') return;
    list()[i][f] = cellValue(t); save(key, list()); later();
  });
  body.addEventListener('change', e => {
    const t = e.target, i = t.getAttribute('data-i'), f = t.getAttribute('data-f');
    if (i == null || !(t.type === 'checkbox' || t.tagName === 'SELECT')) return;
    list()[i][f] = cellValue(t); save(key, list()); later();
  });
  body.addEventListener('click', e => {
    const i = e.target.getAttribute('data-del'); if (i == null) return;
    list().splice(Number(i), 1); save(key, list()); rerender(); recalc();
  });
}

// ---------- catalog ----------
const drawCatalog = () => renderCatalog(state.catalog, state.catView);
bindTable($('#catBody'), () => state.catalog, KEYS.catalog, drawCatalog);
$('#catSearch').addEventListener('input', e => { state.catView.q = e.target.value; state.catView.page = 0; drawCatalog(); });
$('#catPager').addEventListener('click', e => { const p = e.target.getAttribute('data-page'); if (p == null) return; state.catView.page = Number(p); drawCatalog(); });
$('#catAdd').addEventListener('click', () => {
  state.catalog.unshift({ code: 'NOVY-' + (state.catalog.length + 1), name: '', pack: 'paleta', pl: 1200, pw: 800, per: 1, kg: 0, rot: true });
  state.catView = { q: '', page: 0 }; $('#catSearch').value = '';
  save(KEYS.catalog, state.catalog); drawCatalog(); recalc();
});
$('#catReset').addEventListener('click', () => {
  if (!confirm('Vrátit číselník na ukázková data? Nahrané artikly se smažou.')) return;
  state.catalog = clone(DEFAULT_CATALOG); save(KEYS.catalog, state.catalog); drawCatalog(); recalc(); $('#catReport').innerHTML = '';
});
$('#catExport').addEventListener('click', () => download('ciselnik-artiklu.csv',
  [['artikl', 'nazev', 'baleni', 'delka_mm', 'sirka_mm', 'ks_na_palete', 'vaha_kusu_kg', 'lze_otacet']]
    .concat(state.catalog.map(a => [a.code, a.name, a.pack || 'paleta', a.pl, a.pw, a.per, String(a.kg).replace('.', ','), a.rot ? 'ano' : 'ne']))));
$('#catFile').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const { rows } = await readFileRows(f), res = rowsToCatalog(rows), replace = $('#catReplace').checked;
    let merged = null;
    if (res.items.length) {
      merged = replace ? { list: res.items } : mergeBy(state.catalog, res.items, a => String(a.code).trim().toLowerCase());
      state.catalog = merged.list; save(KEYS.catalog, state.catalog); drawCatalog(); recalc();
    }
    importReport($('#catReport'), res, merged, replace);
  } catch (err) { $('#catReport').innerHTML = '<p class="problems">' + err.message + '</p>'; }
});

// ---------- vehicles ----------
const drawVehicles = () => renderVehicles(state.vehicles);
bindTable($('#vehBody'), () => state.vehicles, KEYS.vehicles, drawVehicles);
$('#vehAdd').addEventListener('click', () => {
  state.vehicles.push({ name: 'Nové vozidlo', type: 'jine', L: 4, W: 2, kg: 1000, eup: 0, lift: false, cost: 0.5 });
  save(KEYS.vehicles, state.vehicles); drawVehicles(); recalc();
});
$('#vehReset').addEventListener('click', () => {
  if (!confirm('Vrátit vozidla na výchozí hodnoty?')) return;
  state.vehicles = clone(DEFAULT_VEHICLES); save(KEYS.vehicles, state.vehicles); drawVehicles(); recalc(); $('#vehReport').innerHTML = '';
});
$('#vehExport').addEventListener('click', () => download('vozidla.csv',
  [['nazev', 'typ', 'delka_m', 'sirka_m', 'nosnost_kg', 'max_palet', 'celo', 'cena']]
    .concat(state.vehicles.map(v => [v.name, v.type, String(v.L).replace('.', ','), String(v.W).replace('.', ','), v.kg, v.eup, v.lift ? 'ano' : 'ne', String(v.cost).replace('.', ',')]))));
$('#vehFile').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const { rows } = await readFileRows(f), res = rowsToVehicles(rows), replace = $('#vehReplace').checked;
    let merged = null;
    if (res.items.length) {
      merged = replace ? { list: res.items } : mergeBy(state.vehicles, res.items, v => String(v.name).trim().toLowerCase());
      state.vehicles = merged.list; save(KEYS.vehicles, state.vehicles); drawVehicles(); recalc();
    }
    importReport($('#vehReport'), res, merged, replace);
  } catch (err) { $('#vehReport').innerHTML = '<p class="problems">' + err.message + '</p>'; }
});

// ---------- rules ----------
$('#rulesGrid').addEventListener('input', e => {
  const k = e.target.getAttribute('data-r'); if (!k) return;
  const v = toNum(e.target.value); if (!(v > 0)) return;
  state.rules[k] = v; save(KEYS.rules, state.rules); later();
});

// ---------- start ----------
const td = new Date().toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
$('#today').textContent = td.charAt(0).toUpperCase() + td.slice(1);
$('#csv').value = state.csv;
drawCatalog(); drawVehicles(); renderRules(state.rules);
importOrders(state.csv);
