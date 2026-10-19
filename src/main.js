import { clone, toNum } from './core/util.js';
import { DEFAULT_CATALOG, DEFAULT_VEHICLES, DEFAULT_RULES, DEFAULT_COMBOS, DEFAULT_PALLETS, SAMPLE } from './core/defaults.js';
import { migrateCatalog, nextCode, typeOf } from './core/palletTypes.js';
import { roomFor, freezePlan, moveUnits, setPalletType, removePallet, newId, mergePallets, sameSo } from './core/plan.js';
import { parseOrders, rowsToOrderText, ordersToText } from './core/parse.js';
import { solve } from './core/solve.js';
import { auditOrder } from './core/audit.js';
import { ruleText, parseKolo, nextKoloCode, expandKolo, koloRow, findDuplicateGroups, mergeGroups, koloHostRows, koliOf, defsToSolo, projectOf as projOf, findRules } from './core/combos.js';
import { fromResult, viewOf, movePallet, rotatePallet, addVehicle, removeVehicle, replaceVehicle, DEPOT } from './core/manual.js';
import { readFileRows, isSpreadsheet, rowsToCatalog, rowsToVehicles, rowsToCombos, rowsToPallets, mergeBy, toCsv } from './io/importTable.js';
import { renderKpis, renderPriorities, renderList, renderDetail, renderDock, requestText, loadPlanHtml, palOption, setNameLookup, setKgLookup } from './ui/orders.js';
import { ringilHtml } from './ui/ringil.js';
import { renderOrderTable, statusOf, transportOf } from './ui/ordertable.js';
import { packListHtml } from './ui/packlist.js';
import { requireLogin, loadSettings, saveSetting, signOut, changePassword, listProfiles, setRole, adminUsers } from './auth.js';
import { esc } from './core/util.js';
import { renderCatalog, renderPallets, renderVehicles, renderCombos, renderRules, importReport } from './ui/settings.js';

const $ = s => document.querySelector(s);
// article names for the pallet lists (catalog first, then the order lines)
setNameLookup(code => {
  const k = String(code).toLowerCase(), a = state.catalog.find(x => String(x.code).toLowerCase() === k);
  if (a && a.name) return a.name;
  const o = state.orders.get(state.sel), l = o && [...o.lines.values()].find(x => x.code.toLowerCase() === k);
  return l ? l.name || '' : '';
});
// weight of one piece for the pallet lists (catalog, otherwise the rule's weight); 0 = missing
setKgLookup(code => {
  const k = String(code).toLowerCase(), a = state.catalog.find(x => String(x.code).toLowerCase() === k);
  if (a && a.kg > 0) return a.kg;
  const r = state.combos.find(x => String(x.code).toLowerCase() === k && x.kg > 0);
  return r ? r.kg : 0;
});
// zoom of the vehicle drawings (remembered)
let zoom = load('itab.zoom.v1', 1);
const applyZoom = () => document.documentElement.style.setProperty('--zoom', zoom);
applyZoom();
// calculator (#detail) and loading (#dock) share the same click / drag handlers
function onBoth(type, fn) { $('#detail').addEventListener(type, fn); $('#dock').addEventListener(type, fn); }
const KEYS = { list: 'itab.orderlist.v1', catalog: 'itab.catalog.v1', vehicles: 'itab.vehicles.v1', rules: 'itab.rules.v1', combos: 'itab.combos.v1', csv: 'itab.orders.v1' };
function load(key, def) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch (e) { return def; } }
function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* storage full or blocked */ } }

// the prototype stored the catalog under this key; take it over once
// sign in first; catalog, vehicles, combos and rules are shared for everybody in Supabase
const me = await requireLogin();
const isAdmin = me.role === 'admin';
let shared = {};
if (!me.demo) { try { shared = await loadSettings(); } catch (e) { alert(e.message); } }
const state = {
  // an emptied shared catalog stays empty (demo articles only when nothing was ever saved)
  catalog: Array.isArray(shared.catalog) && (shared.catalog.length || !me.demo) ? shared.catalog : clone(DEFAULT_CATALOG),
  vehicles: Array.isArray(shared.vehicles) && shared.vehicles.length ? shared.vehicles : clone(DEFAULT_VEHICLES),
  combos: Array.isArray(shared.combos) ? shared.combos : clone(DEFAULT_COMBOS),
  pallets: Array.isArray(shared.pallets) && shared.pallets.length ? shared.pallets : clone(DEFAULT_PALLETS),
  rules: Object.assign(clone(DEFAULT_RULES), shared.rules || {}),
  csv: load(KEYS.csv, SAMPLE),
  orders: new Map(), results: new Map(), forced: new Map(), manual: new Map(), board: new Map(), plan: new Map(Object.entries(load('itab.plans.v1', {})).map(([k, v]) => [k, v.plan])),

  projSel: new Map(Object.entries(load('itab.projsel.v1', {}))),
  variant: new Map(), // loading variant per ID: 'min' (fewest vehicles) or 'sep' (every zakázka on its own)
  saved: new Map(Object.entries(load('itab.plans.v1', {})).map(([k, v]) => [k, v.at])),
  ordered: new Set(load('itab.ordered.v1', [])), listUi: Object.assign({ sort: { key: null, dir: 'asc' }, filters: {} }, load('itab.listui.v1', {}), { open: null }), oneOff: new Map(), done: new Set(load('itab.done.v1', [])), isAdmin, sel: null, prioHidden: false,
  catView: { q: '', page: 0 }
};

// first admin login: move what this browser had saved locally into the shared database
if (isAdmin && !me.demo) {
  [['catalog', 'itab.catalog.v1'], ['vehicles', 'itab.vehicles.v1'], ['combos', 'itab.combos.v1'], ['rules', 'itab.rules.v1']].forEach(([name, key]) => {
    if (shared[name] != null) return;
    const local = load(key, null);
    if (local != null && !(Array.isArray(local) && !local.length)) state[name] = name === 'rules' ? Object.assign(clone(DEFAULT_RULES), local) : local;
    setTimeout(() => persist(name), 0);
  });
}

// articles that still carry pallet sizes get a pallet type (PAL-xxxx)
{
  const m = migrateCatalog(state.catalog, state.pallets);
  // older imported balení (one special entry) become normal table rows
  const ek = expandKolo(state.combos);
  if (ek.changed) { state.combos = ek.combos; if (isAdmin && !me.demo) setTimeout(() => persist('combos'), 0); }
  // pallet types first, then the packing moves out of the catalog (else the old catalog copy would come back)
  if (m.changed) { state.catalog = m.catalog; state.pallets = m.types; if (isAdmin && !me.demo) setTimeout(() => { persist('pallets'); persist('catalog'); }, 0); }
  // packing moved from the catalog into Způsob balení (solo / balík rows without project); a backup stays in this browser
  if (state.catalog.some(a => a.pack === 'paleta' || a.pack === 'balik')) {
    try { if (!localStorage.getItem('itab.backup.before-solo')) localStorage.setItem('itab.backup.before-solo', JSON.stringify({ catalog: state.catalog, combos: state.combos })); } catch (e) {}
    if (defsToSolo(state.catalog, state.combos, '') && isAdmin && !me.demo) setTimeout(() => { persist('combos'); persist('catalog'); }, 0);
  }
}

// admin edits go to the shared database; plain users cannot write (RLS)
// who saved which Způsob balení row and when: rows that differ from the last saved state get by / at
const comboSnap = new WeakMap();
const comboKey = r => JSON.stringify(Object.assign({}, r, { by: undefined, at: undefined }));
function stampCombos() {
  const who = (me && me.user && me.user.email) || '', at = new Date().toISOString();
  const trs = document.querySelectorAll('#comboBody tr[data-by]');
  state.combos.forEach((r, i) => {
    const k = comboKey(r); if (comboSnap.get(r) === k) return;
    if (comboSnap.has(r) || !r.at) {
      r.by = who; r.at = at;
      // the open table shows it at once (no redraw while typing)
      const td = trs[i] && trs[i].querySelector('td.c-who'); if (td) { td.innerHTML = esc(who) + '<br><small class="muted">' + new Date(at).toLocaleString('cs-CZ') + '</small>'; trs[i].dataset.by = who; trs[i].dataset.day = at.slice(0, 10); }
    }
    comboSnap.set(r, k);
  });
}
function persist(name) {
  if (name === 'combos') stampCombos();
  // a definition learned in an order (pallet / balík) goes to Způsob balení as solo, in the order's project
  if (name === 'catalog' && state.catalog.some(a => a.pack === 'paleta' || a.pack === 'balik')) {
    const o = state.orders && state.orders.get(state.sel);
    const proj = !o ? '' : state.projSel.has(state.sel) ? state.projSel.get(state.sel) : ((projOf(o, state.rules.projects) || {}).name || '');
    if (defsToSolo(state.catalog, state.combos, proj)) { persist('combos'); try { drawCombos(); drawCatalog(); } catch (e) {} }
  }
  if (!isAdmin || me.demo) return;
  const el = $('#saveState');
  el.textContent = 'Ukládám…'; el.className = 'save-state';
  saveSetting(name, state[name], me.user.id, err => {
    el.textContent = err ? 'Neuloženo: ' + err : 'Uloženo pro všechny';
    el.className = 'save-state ' + (err ? 'bad' : 'ok');
  });
}

// ---------- calculation ----------
function ctx(id) {
  // one-off moves (not remembered) apply only to that order and win over saved rules
  return { catalog: state.catalog, vehicles: state.vehicles, pallets: state.pallets, rules: state.rules, combos: (state.oneOff.get(id) || []).concat(state.combos), forced: state.forced.has(id) ? state.forced.get(id) : null, added: state.board.get(id) || [], plan: state.plan.get(id) || null, project: state.projSel.has(id) ? state.projSel.get(id) : undefined, variant: state.variant.get(id) || null };
}
// Full recalculation (catalog, vehicles, rules … changed): the open order first, the rest in small
// chunks in the background so the page never freezes.
let recalcGen = 0;
function recalc() {
  const gen = ++recalcGen;
  state.forced.forEach((vi, id) => { if (!(vi < state.vehicles.length)) state.forced.delete(id); });
  [...state.results.keys()].forEach(id => { if (!state.orders.has(id)) state.results.delete(id); });
  if (!state.orders.has(state.sel)) state.sel = state.orders.size ? state.orders.keys().next().value : null;
  const ids = [...state.orders.keys()].sort((a, b) => (b === state.sel) - (a === state.sel));
  const one = id => { state.results.set(id, solve(state.orders.get(id), ctx(id))); const m = state.manual.get(id); if (m && !m.touched) state.manual.delete(id); };
  // first paint: the open order plus everything that has no result yet
  ids.filter((id, i) => i === 0 || !state.results.has(id)).forEach(one);
  renderOverview();
  const rest = ids.slice(1).filter(id => state.results.has(id));
  const step = () => {
    if (gen !== recalcGen) return;
    const t0 = performance.now();
    while (rest.length && performance.now() - t0 < 30) one(rest.shift());
    if (rest.length) setTimeout(step, 0); else renderOverview();
  };
  if (rest.length) setTimeout(step, 0);
}
// Only the open order changed (its pallets, board, one-off moves): recalculate just that one.
function recalcOne(id = state.sel) {
  const o = state.orders.get(id); if (!o) { recalc(); return; }
  state.results.set(id, solve(o, ctx(id)));
  const m = state.manual.get(id); if (m && !m.touched) state.manual.delete(id);
  renderOverview();
}
// result as shown: with the operator's manual loading plan applied
function view(id) {
  const r = state.results.get(id); if (!r) return null;
  // groupage orders always get the handover area so their pallets can be dragged
  if (!state.manual.has(id) && r.mode === 'groupage') state.manual.set(id, fromResult(r));
  return viewOf(r, state.manual.get(id), state.vehicles);
}
function views() { return new Map([...state.results.keys()].map(id => [id, view(id)])); }
function renderOverview() {
  const vs = views(), res = [...vs.values()];
  renderKpis(res);
  renderPriorities(res, state.prioHidden);
  drawOrderTable(vs);
  renderDetail(vs.get(state.sel), state);
  renderList(state.orders, vs, state.sel, '', state.done, '#dockList', '#dockCount');
  renderDock(vs.get(state.sel), state);
  markSel();
}
function saveOrderList() {
  save(KEYS.list, ordersToText(state.orders));
}
// new orders go to the top of the list and the first one opens; older ones stay
function importOrders(text, open, initial) {
  const res = parseOrders(text);
  const fresh = [...res.orders.keys()];
  // a new import replaces the list (unless "keep" is ticked); orders marked as done always go
  if (fresh.length && !initial) {
    const drop = $('#keepOld').checked ? [...state.done] : [...state.orders.keys()];
    drop.forEach(id => { state.orders.delete(id); state.forced.delete(id); state.manual.delete(id); state.board.delete(id); state.plan.delete(id); state.oneOff.delete(id); state.done.delete(id); state.ordered.delete(id); });
    save('itab.done.v1', [...state.done]); save('itab.ordered.v1', [...state.ordered]);
  }
  fresh.forEach(id => { state.forced.delete(id); state.manual.delete(id); state.oneOff.delete(id); state.board.delete(id); state.plan.delete(id); state.orders.delete(id); });
  // pallets saved with „Zkontrolovat a uložit“ come back for the same ID
  const savedPlans = load('itab.plans.v1', {});
  fresh.forEach(id => { if (savedPlans[id]) state.plan.set(id, savedPlans[id].plan); });
  state.orders = new Map([...res.orders, ...state.orders]);
  state.prioHidden = false;
  $('#problems').textContent = res.problems.length ? 'Nerozpoznáno: ' + res.problems.join('; ') + '.' : '';
  if (fresh.length) state.sel = fresh[0];
  saveOrderList();
  recalc();
  if (open && fresh.length) goDetail();
}
// the deleted order's lines also leave the import field: blocks under „ID x“ / „SO y“ of that order;
// a pasted text without any ID / SO header belongs to the one order made from it
function dropFromImport(id, sos) {
  const t = $('#csv').value; if (!t.trim()) return;
  const lw = x => String(x || '').trim().toLowerCase(), mine = new Set([lw(id)].concat((sos || []).map(lw)));
  const lines = t.split(/\r?\n/), keep = [];
  let curId = '', curSo = '', any = false;
  lines.forEach(l => {
    const m = l.match(/^\s*(ID|SO)\s+(\S+)/i);
    if (m) { any = true; if (m[1].toUpperCase() === 'ID') { curId = lw(m[2]); curSo = ''; } else curSo = lw(m[2]); }
    if (!(mine.has(curId) || mine.has(curSo))) keep.push(l);
  });
  const nt = any ? keep.join('\n').replace(/\n{3,}/g, '\n\n').trim() : (state.orders.size ? t : '');
  if (nt !== t) { $('#csv').value = nt; state.csv = nt; save(KEYS.csv, nt); }
}
function removeOrder(id) {
  const o0 = state.orders.get(id);
  state.orders.delete(id);
  dropFromImport(id, o0 && o0.sos); state.results.delete(id); state.forced.delete(id); state.manual.delete(id); state.board.delete(id); state.plan.delete(id); state.oneOff.delete(id); unsavePlan(id);
  if (state.done.delete(id)) save('itab.done.v1', [...state.done]);
  if (state.ordered.delete(id)) save('itab.ordered.v1', [...state.ordered]);
  if (state.sel === id) state.sel = state.orders.size ? state.orders.keys().next().value : null;
  saveOrderList();
  renderOverview();
}
let timer = null;
function later() { clearTimeout(timer); timer = setTimeout(recalc, 250); }

// ---------- navigation ----------
const VIEWS = ['orders', 'dock', 'catalog', 'pallets', 'combos', 'projects', 'vehicles', 'rules', 'users', 'help'];
// help page shows the current rule values
function renderHelp() {
  const r = state.rules;
  document.querySelectorAll('[data-help]').forEach(el => {
    const k = el.getAttribute('data-help');
    if (k === 'oneVeh') el.innerHTML = r.oneVeh !== false
      ? '<b>Jedna zakázka = jedno vozidlo</b> (zapnuto na záložce Pravidla): pokud se celá zakázka vejde do jednoho vozidla, vezmeme nejlevnější takové vozidlo, i kdyby několik menších vyšlo levněji.'
      : '<b>Jedna zakázka = jedno vozidlo je vypnuto</b>: hledáme nejlevnější kombinaci vozidel, i když jich bude víc.';
    else el.textContent = String(r[k]).replace('.', ',');
  });
}
function showView(v) {
  VIEWS.forEach(x => {
    const on = x === v;
    $('#view-' + x).hidden = !on;
    if (on && x === 'help') renderHelp();
    $('#tab-' + x).setAttribute('aria-selected', on ? 'true' : 'false');
  });
}
document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => showView(b.getAttribute('data-view'))));
function goDetail() {
  const d = $('#detail');
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (d && d.scrollIntoView) d.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
}
function select(id) { state.sel = id; renderOverview(); goDetail(); }

$('#q').addEventListener('input', () => { showView('orders'); drawOrderTable(views()); });

// ---------- order table: status, sorting, filters ----------
function drawOrderTable(vs) {
  const q = ($('#q').value || '').trim().toLowerCase();
  const edited = id => !!(state.plan.has(id) || (state.manual.get(id) && state.manual.get(id).touched));
  const rows = [...state.orders.keys()].filter(id => !q || id.toLowerCase().includes(q) || [...state.orders.get(id).lines.values()].some(l => l.code.toLowerCase().includes(q))).map(id => {
    const r = vs.get(id), total = state.orders.get(id).lines.size;
    return { id, r, total, project: r.project || '', sos: state.orders.get(id).sos, known: total - (r.unknown || []).length, pallets: r.pallets.length, parcels: r.parcels.length, kg: r.kg, transport: transportOf(r), status: statusOf(r, id, { done: state.done, ordered: state.ordered, edited }) };
  });
  renderOrderTable($('#orderList'), $('#orderCount'), rows, state.listUi, state.sel);
}
function saveListUi() { save('itab.listui.v1', { sort: state.listUi.sort, filters: state.listUi.filters }); drawOrderTable(views()); }
$('#orderList').addEventListener('click', e => {
  const ui = state.listUi;
  const so = e.target.closest('[data-sort]');
  if (so) { const k = so.dataset.sort; ui.sort = ui.sort.key !== k ? { key: k, dir: 'asc' } : ui.sort.dir === 'asc' ? { key: k, dir: 'desc' } : { key: null, dir: 'asc' }; saveListUi(); return; }
  const fi = e.target.closest('[data-filt]');
  if (fi) { ui.open = ui.open === fi.dataset.filt ? null : fi.dataset.filt; drawOrderTable(views()); const inp = $('.fpop input'); if (inp) inp.focus(); return; }
  if (e.target.closest('[data-fclose]')) { ui.open = null; drawOrderTable(views()); return; }
  const fc = e.target.closest('[data-fclear]');
  if (fc) { const k = fc.dataset.fclear; delete ui.filters[k]; delete ui.filters[k + 'Min']; delete ui.filters[k + 'Max']; ui.open = null; saveListUi(); return; }
}, true);
$('#orderList').addEventListener('change', e => {
  const ui = state.listUi;
  if (e.target.dataset.fs != null) { const set = new Set(ui.filters.status || []); if (e.target.checked) set.add(e.target.dataset.fs); else set.delete(e.target.dataset.fs); ui.filters.status = [...set]; saveListUi(); return; }
  if (e.target.dataset.f != null) { ui.filters[e.target.dataset.f] = e.target.value; saveListUi(); }
});
$('#orderList').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset.f != null) { e.preventDefault(); e.target.blur(); } });
$('#orderCount').addEventListener('click', e => { if (e.target.dataset.fclearall) { state.listUi.filters = {}; saveListUi(); } });
document.addEventListener('click', e => {
  if (state.listUi.open && !e.target.closest('.fpop') && !e.target.closest('[data-filt]')) { state.listUi.open = null; drawOrderTable(views()); }
});
$('#prio').addEventListener('click', e => {
  if (e.target.id === 'prioHide') { state.prioHidden = true; renderPriorities([], true); return; }
  const b = e.target.closest('button[data-id],button[data-view]'); if (!b) return;
  if (b.getAttribute('data-view')) { showView(b.getAttribute('data-view')); return; }
  select(b.getAttribute('data-id'));
});
$('#orderList').addEventListener('change', e => {
  const id = e.target.getAttribute('data-done'); if (id == null) return;
  if (e.target.checked) state.done.add(id); else state.done.delete(id);
  save('itab.done.v1', [...state.done]);
  renderOverview();
});
$('#orderList').addEventListener('click', e => {
  const x = e.target.closest('.feed-x');
  if (x) { removeOrder(x.getAttribute('data-del')); return; }
  if (e.target.closest('thead') || e.target.matches('input')) return;
  const b = e.target.closest('.orow'); if (b) select(b.getAttribute('data-id'));
});

// ---------- order import ----------
$('#btnClear').addEventListener('click', async () => {
  if (!state.orders.size && !$('#csv').value) return;
  if (!await ask('Smazat všechny zakázky?', 'Smažou se všechny zakázky z importu i ruční úpravy. Číselník, palety, vozidla a pravidla zůstanou.', 'Smazat vše')) return;
  // everything at once (removing one by one would redraw the page for every order)
  ['orders', 'results', 'forced', 'manual', 'board', 'plan', 'oneOff', 'saved'].forEach(k => state[k].clear()); save('itab.plans.v1', {});
  state.done.clear(); save('itab.done.v1', []); state.ordered.clear(); save('itab.ordered.v1', []);
  saveOrderList();
  state.csv = ''; $('#csv').value = ''; save(KEYS.csv, ''); $('#problems').textContent = '';
  state.sel = null; recalc(); flash('Všechny zakázky smazány.');
});
$('#btnCalc').addEventListener('click', () => { state.csv = $('#csv').value; save(KEYS.csv, state.csv); importOrders(state.csv, true); });
async function orderFile(f) {
  try {
    const { rows, text } = await readFileRows(f);
    const t = isSpreadsheet(f.name) || /\.csv$/i.test(f.name) ? rowsToOrderText(rows) : text;
    $('#csv').value = t; state.csv = t; save(KEYS.csv, t); importOrders(t, true);
  } catch (err) { $('#problems').textContent = err.message; }
}
$('#file').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; if (f) orderFile(f); e.target.value = ''; });
const drop = $('#dropZone');
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('drag'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('drag'); }));
drop.addEventListener('drop', e => { const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) orderFile(f); });

// ---------- detail ----------
onBoth('change', e => {
  if (e.target.id !== 'forceVeh') return;
  const id = state.sel, v = e.target.value;
  if (v === '') state.forced.delete(id); else state.forced.set(id, Number(v));
  state.manual.delete(id);
  const o = state.orders.get(id);
  state.results.set(id, solve(o, ctx(id)));
  renderOverview();
});
// ---------- calculator ↔ loading ----------
onBoth('click', e => {
  if (e.target.id === 'goDock') { showView('dock'); scrollTo(0, 0); }
  if (e.target.id === 'backCalc') { showView('orders'); goDetail(); }
});
$('#dockBack').addEventListener('click', () => { showView('orders'); });
$('#dockList').addEventListener('click', e => {
  const b = e.target.closest('.feed'); if (!b) return;
  state.sel = b.getAttribute('data-id'); renderOverview();
});

// ---------- manual loading ----------
function manualOf(id) {
  if (!state.manual.has(id)) state.manual.set(id, fromResult(state.results.get(id)));
  return state.manual.get(id);
}
// undo for the loading plan: snapshot before every change
const undo = new Map();
function snap(id) {
  const m = state.manual.get(id);
  const list = undo.get(id) || [];
  list.push(m ? JSON.parse(JSON.stringify(m)) : null);
  if (list.length > 50) list.shift();
  undo.set(id, list);
}
function undoStep(id) {
  const list = undo.get(id) || [];
  if (!list.length) { flash('Není co vrátit.'); return; }
  const prev = list.pop();
  if (prev) state.manual.set(id, prev); else state.manual.delete(id);
  flash('Vráceno o krok zpět.');
}
function keepScroll(fn) { const y = window.scrollY; fn(); renderOverview(); window.scrollTo(0, y); }
let flashMsg = null;
function flash(text) {
  clearTimeout(flashMsg);
  let el = $('#dragMsg');
  if (!el) { el = document.createElement('div'); el.id = 'dragMsg'; el.className = 'drag-msg'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = text; el.hidden = false;
  flashMsg = setTimeout(() => { el.hidden = true; }, 2600);
}
onBoth('click', e => {
  const id = state.sel; if (!id) return;
  if (e.target.id === 'addVehBtn') {
    const r = state.results.get(id), sv = $('#addVehSel').value, vi = sv === DEPOT ? DEPOT : Number(sv);
    if (vi === DEPOT) {
      if (view(id).depot) { flash('Sběrná služba už v zakázce je.'); return; }
      snap(id); keepScroll(() => addVehicle(manualOf(id), state.vehicles, DEPOT));
      return;
    }
    // an overloaded vehicle is replaced: its pallets move to the new one and the old one goes away
    const over = view(id).overweight || (view(id).vehicles || []).filter(v => v.kg > v.maxKg + 1e-9 && !v.items.some(i => i.noKg || !(i.kg > (i.tare || 0))));
    if (over.length) {
      const target = over[0];
      if (state.vehicles[vi] && target.kg > state.vehicles[vi].kg + 1e-9) { flash('Nové vozidlo unese jen ' + state.vehicles[vi].kg + ' kg, náklad má ' + Math.round(target.kg) + ' kg.'); return; }
      let ok = false;
      snap(id); keepScroll(() => { ok = replaceVehicle(manualOf(id), state.vehicles, target.idx, vi); });
      flash(ok ? target.title + ' nahrazeno: palety přesunuty do nového vozidla.' : 'Palety z ' + target.title + ' se do nového vozidla nevejdou.');
      return;
    }
    keepScroll(() => {
      snap(id);
      const fresh = !state.manual.has(id);
      const m = manualOf(id);
      addVehicle(m, state.vehicles, vi, fresh && !m.vehicles.length ? r.pallets : null);
    });
    return;
  }
  if (e.target.id === 'resetManual' || e.target.dataset.reset != null) { snap(id); keepScroll(() => state.manual.delete(id)); flash('Vráceno automatické rozložení. ↶ Zpět ho obnoví.'); return; }
  if (e.target.dataset.undo != null) { keepScroll(() => undoStep(id)); return; }
  if (e.target.dataset.zoom != null) { zoom = Math.max(1, Math.min(3, Math.round((zoom + Number(e.target.dataset.zoom) * 0.5) * 2) / 2)); save('itab.zoom.v1', zoom); applyZoom(); flash('Měřítko nákresu ' + Math.round(zoom * 100) + ' %'); return; }
  if (e.target.id === 'addPalBtn') {
    const v = $('#palPick').value.trim(), code = v.split(' · ')[0].trim();
    const t = typeOf(state.pallets, code) || state.pallets.find(p => palOption(p).toLowerCase() === v.toLowerCase());
    if (!t) { flash(v ? 'Paleta „' + v + '“ v seznamu není. Vyberte ji z nabídky nebo použijte „Jiná paleta…“.' : 'Napište kód, název nebo rozměr a vyberte paletu z nabídky.'); $('#palPick').focus(); return; }
    addBoardPallet(id, { pal: t.code });
    flash('Přidána prázdná paleta ' + t.code + '. Přetáhněte na ni materiál.');
    return;
  }
  if (e.target.id === 'newPalBtn') { askPallet(id); return; }
  const rmb = e.target.getAttribute('data-rmb');
  if (rmb) { keepScroll(() => { const P = state.plan.get(id); if (P) removePallet(P, rmb); else state.board.set(id, (state.board.get(id) || []).filter(b => b.id !== rmb)); state.manual.delete(id); recalcOne(); }); return; }
  if (e.target.id === 'resetPlan') { keepScroll(() => { state.plan.delete(id); unsavePlan(id); state.manual.delete(id); recalcOne(); }); return; }
  const bp = e.target.closest('.board-pal');
  if (bp && !e.target.closest('.bp-x') && isAdmin && !suppressClick && !e.shiftKey) { openPalEditor(id, bp.dataset.bid, Number(bp.dataset.pi)); return; }
  const rm = e.target.getAttribute('data-rmveh');
  if (rm != null) { snap(id); keepScroll(() => removeVehicle(manualOf(id), Number(rm))); return; }
});
onBoth('dblclick', e => {
  const g = e.target.closest('.pal'); if (!g) return;
  const id = state.sel;
  snap(id); keepScroll(() => { if (!rotatePallet(manualOf(id), state.vehicles, Number(g.dataset.v), Number(g.dataset.p))) flash('Otočená se paleta nevejde nebo ji nelze otáčet.'); });
});
// drag a pallet: a floating copy follows the pointer, the drop point in the target body is converted to mm
let drag = null, suppressClick = false;
// Shift + click selects several unknown articles / board pallets / vehicle pallets; dragging one of them drags all
const sel = { unk: new Set(), board: new Set(), veh: new Set() };
const boardKey = el => el.dataset.bid || 'i' + el.dataset.pi;
const unkKey = el => (el.dataset.so || '') + '|' + el.dataset.code;
const vehKey = el => el.dataset.v + ':' + el.dataset.p;
// search in the unknown articles tray (kept across redraws)
let unkQ = '';
function filterUnk() {
  const q = unkQ.trim().toLowerCase();
  document.querySelectorAll('.unk-search').forEach(i => { if (i.value !== unkQ) i.value = unkQ; });
  document.querySelectorAll('.tray .unk').forEach(el => { el.hidden = !!q && el.textContent.toLowerCase().indexOf(q) < 0; });
}
document.addEventListener('input', e => { if (e.target.classList && e.target.classList.contains('unk-search')) { unkQ = e.target.value; filterUnk(); } });
function markSel() {
  filterUnk();
  document.querySelectorAll('.unk').forEach(el => el.classList.toggle('selected', sel.unk.has(unkKey(el))));
  // while selecting, articles of other zakázky fade out
  const selSo = sel.unk.size ? [...sel.unk][0].split('|')[0] : null;
  document.querySelectorAll('.unk').forEach(el => el.classList.toggle('drop-no', selSo != null && (el.dataset.so || '') !== selSo));
  document.querySelectorAll('#detail .board-pal').forEach(el => el.classList.toggle('selected', sel.board.has(boardKey(el))));
  document.querySelectorAll('.veh-svg .pal').forEach(el => el.classList.toggle('selected', sel.veh.has(vehKey(el))));
  const n = sel.unk.size + sel.board.size + sel.veh.size;
  let bar = $('#selBar');
  if (!bar) { bar = document.createElement('div'); bar.id = 'selBar'; bar.className = 'sel-bar'; document.body.appendChild(bar); bar.addEventListener('click', e => { if (e.target.id === 'selClear') clearSel(); }); }
  bar.hidden = !n;
  bar.innerHTML = 'Vybráno: <b>' + n + '</b> – přetáhněte kteroukoli z nich <button class="linkbtn" id="selClear">Zrušit výběr</button>';
}
function clearSel() { sel.unk.clear(); sel.board.clear(); sel.veh.clear(); markSel(); }
document.addEventListener('keydown', e => { if (e.key === 'Escape' && (sel.unk.size || sel.board.size || sel.veh.size)) clearSel(); });
const toggle = (set, k) => { if (set.has(k)) set.delete(k); else set.add(k); };
onBoth('pointerdown', e => {
  if (e.shiftKey && e.button === 0) {
    const u0 = e.target.closest('.unk'), b0 = e.target.closest('#detail .board-pal'), v0 = e.target.closest('.veh-svg .pal');
    if (u0 && isAdmin) {
      sel.board.clear(); sel.veh.clear();
      // one zakázka at a time: pieces of different zakázky can never share a pallet
      const so0 = u0.dataset.so || '', other = [...sel.unk].find(k => k.split('|')[0] !== so0);
      if (other && !sel.unk.has(unkKey(u0))) { flash('Vybírat lze jen artikly jedné zakázky (' + other.split('|')[0] + ').'); return; }
      toggle(sel.unk, unkKey(u0));
    }
    else if (b0 && isAdmin && !e.target.closest('.bp-x')) { sel.unk.clear(); sel.veh.clear(); toggle(sel.board, boardKey(b0)); }
    else if (v0) { sel.unk.clear(); sel.board.clear(); toggle(sel.veh, vehKey(v0)); }
    else return;
    e.preventDefault(); suppressClick = true; setTimeout(() => { suppressClick = false; }, 0);
    markSel(); return;
  }
  const bpal = e.target.closest('#detail .board-pal');
  if (bpal && !e.target.closest('.bp-x') && isAdmin && e.button === 0) {
    const rc = bpal.getBoundingClientRect();
    const group = sel.board.has(boardKey(bpal)) && sel.board.size > 1
      ? [...document.querySelectorAll('#detail .board-pal')].filter(el => sel.board.has(boardKey(el))).map(el => ({ bid: el.dataset.bid, pi: el.dataset.pi }))
      : [{ bid: bpal.dataset.bid, pi: bpal.dataset.pi }];
    drag = { g: bpal, n: group.length, boardPal: group, sx: e.clientX, sy: e.clientY, w: rc.width, h: rc.height, color: getComputedStyle(bpal).getPropertyValue('--c') || 'var(--primary)', moved: false };
    bpal.setPointerCapture(e.pointerId);
    return;
  }
  const pt = e.target.closest('.ptype');
  if (pt && isAdmin && e.button === 0) {
    drag = { g: pt, ptype: pt.dataset.pal, sx: e.clientX, sy: e.clientY, w: 84, h: 56, color: 'var(--primary)', moved: false };
    pt.setPointerCapture(e.pointerId);
    return;
  }
  const u = !e.target.closest('.unk-hint') && e.target.closest('.unk');
  if (u && isAdmin && e.button === 0) {
    const rc = u.getBoundingClientRect();
    const pick = el => ({ code: el.dataset.code, qty: Number(el.dataset.qty), name: el.dataset.name || '', so: el.dataset.so || undefined });
    const group = sel.unk.has(unkKey(u)) && sel.unk.size > 1 ? [...document.querySelectorAll('.unk')].filter(el => sel.unk.has(unkKey(el))).map(pick) : [pick(u)];
    // show where the article may go: pallets of its own zakázka light up, the others fade
    const sos = new Set(group.map(x => x.so).filter(Boolean));
    if (sos.size) document.querySelectorAll('.board-pal[data-so]').forEach(el => { if (el.dataset.so) el.classList.add(sos.has(el.dataset.so) ? 'drop-ok' : 'drop-no'); });
    drag = { g: u, n: group.length, unk: group, sx: e.clientX, sy: e.clientY, w: Math.min(rc.width, 120), h: 40, color: 'var(--gray)', moved: false };
    u.setPointerCapture(e.pointerId);
    return;
  }
  const g = e.target.closest('.pal'); if (!g || e.button !== 0) return;
  const svg = g.ownerSVGElement, rect = g.querySelector('rect').getBoundingClientRect();
  const vgroup = sel.veh.has(vehKey(g)) && sel.veh.size > 1 ? [...sel.veh].map(k => k.split(':').map(Number)) : [[Number(g.dataset.v), Number(g.dataset.p)]];
  drag = { g, n: vgroup.length, vgroup, from: Number(g.dataset.v), pid: Number(g.dataset.p), sx: e.clientX, sy: e.clientY, w: rect.width, h: rect.height, color: g.querySelector('rect').style.fill, moved: false, svg };
  g.setPointerCapture(e.pointerId);
});
onBoth('pointermove', e => {
  if (!drag) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 5) return;
  if (!drag.moved) {
    drag.moved = true; drag.g.classList.add('dragging');
    drag.ghost = document.createElement('div'); drag.ghost.className = 'drag-ghost';
    Object.assign(drag.ghost.style, { width: drag.w + 'px', height: drag.h + 'px', background: drag.color });
    if (drag.n > 1) drag.ghost.innerHTML = '<span class="ghost-n">' + drag.n + '</span>';
    document.body.appendChild(drag.ghost);
  }
  drag.ghost.style.left = (e.clientX - drag.w / 2) + 'px';
  drag.ghost.style.top = (e.clientY - drag.h / 2) + 'px';
  document.querySelectorAll('.drop-target,.drop-host').forEach(x => x.classList.remove('drop-target', 'drop-host'));
  const over = document.elementFromPoint(e.clientX, e.clientY);
  const host = drag.unk && over && (over.closest('.pal') || over.closest('.board-pal'));
  if (drag.ptype) { const bd = over && over.closest('.board'); if (bd) bd.classList.add('drop-target'); return; }
  if (drag.boardPal) { const tp = over && over.closest('.board-pal'); if (tp && tp !== drag.g) tp.classList.add('drop-host'); return; }
  if (host) host.classList.add('drop-host');
  else { const t = over && (over.closest('.veh-svg') || (drag.unk && over.closest('.board'))); if (t) t.classList.add('drop-target'); }
});
function endDrag(e, cancel) {
  if (!drag) return;
  const d = drag; drag = null;
  document.querySelectorAll('.drop-ok,.drop-no').forEach(el => el.classList.remove('drop-ok', 'drop-no')); markSel();
  if (d.ghost) d.ghost.remove();
  document.querySelectorAll('.drag-ghost').forEach(x => x.remove()); // never leave a stuck ghost
  d.g.classList.remove('dragging');
  document.querySelectorAll('.drop-target,.drop-host').forEach(x => x.classList.remove('drop-target', 'drop-host'));
  if (cancel || !d.moved) return;
  const over = document.elementFromPoint(e.clientX, e.clientY), svg = over && over.closest('.veh-svg');
  if (d.boardPal) {
    suppressClick = true; setTimeout(() => { suppressClick = false; }, 0);
    const tp = over && over.closest('.board-pal');
    if (!tp || tp === d.g) return;
    const id = state.sel, wasPlan = state.plan.has(id), P = ensurePlan(id);
    const filled = P.filter(b => b.contents.some(c => c.units > 0));
    const pick = el => (wasPlan && el.dataset.bid && P.find(b => b.id === el.dataset.bid)) || filled[Number(el.dataset.pi)] || P.find(b => b.id === el.dataset.bid);
    const dst = pick(tp);
    // resolve all sources before merging (merging removes emptied pallets)
    const srcs = d.boardPal.map(k => (k.bid && wasPlan ? P.find(b => b.id === k.bid) : filled[Number(k.pi)] || P.find(b => b.id === k.bid))).filter(b => b && b !== dst);
    if (!dst || !srcs.length) return;
    askMerge(id, P, srcs, dst, Number(tp.dataset.pi) + 1);
    return;
  }
  if (d.ptype) {
    if (!(over && over.closest('.board'))) { flash('Paletu pusťte na plochu „Palety zakázky“.'); return; }
    const id = state.sel, list = state.board.get(id) || [];
    list.push({ id: 'b' + Date.now().toString(36), pal: d.ptype, contents: [] });
    state.board.set(id, list); state.manual.delete(id);
    keepScroll(() => recalcOne());
    flash('Přidána prázdná paleta ' + d.ptype + '. Přetáhněte na ni materiál.');
    return;
  }
  if (d.unk) {
    const manualPal = over && over.closest('.board-pal[data-bid]');
    // empty pallet: define the article on this pallet type; pallet with goods: the article rides on it
    const mp = manualPal && ((state.plan.get(state.sel) || state.board.get(state.sel) || []).find(b => b.id === manualPal.dataset.bid));
    if (manualPal && !(mp && mp.contents.some(c => c.units > 0))) { askMaterial(d.unk, manualPal.dataset.bid); return; }
    const boardPal = over && over.closest('.board-pal');
    if (boardPal) {
      // pallets never mix zakázky: the article must ride on a pallet of its own zakázka
      const pso = boardPal.dataset.so, bad = pso && d.unk.find(u => u.so && u.so !== pso);
      if (bad) { flash('Artikl ' + bad.code + ' je ze zakázky ' + bad.so + ', paleta ze zakázky ' + pso + '. Zakázky se na paletě nemíchají – položte ho na paletu své zakázky nebo na volné místo.'); return; }
      // a balení pallet: the article joins that balení (learning), otherwise it rides on the article's pallet
      if (boardPal.dataset.group) { askKoloAdd(d.unk, boardPal.dataset.group, boardPal.dataset.pal, boardPal.dataset.bid, boardPal.dataset.pi); return; }
      askCombo(d.unk, boardPal.dataset.code, boardPal.dataset.bid); return;
    }
    if (over && over.closest('.board')) { askArticles(d.unk); return; }
    const hostG = over && over.closest('.pal');
    if (hostG) {
      const v = view(state.sel), vi = Number(hostG.dataset.v);
      const veh = v.vehicles.find(x => x.idx === vi) || v.vehicles[vi] || (v.depot && v.depot.idx === vi ? v.depot : null);
      const hp = veh && veh.items.find(i => i.id === Number(hostG.dataset.p));
      if (hp) askCombo(d.unk, hp.code);
    } else if (svg) askArticles(d.unk);
    else flash('Pusťte artikl na paletu nebo na volné místo ve vozidle.');
    return;
  }
  if (!svg) { flash('Paletu pusťte do některého vozidla.'); return; }
  const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse());
  const S = Number(svg.dataset.s), to = Number(svg.dataset.v);
  const m = manualOf(state.sel), it = m.vehicles[d.from].items.find(i => i.id === d.pid);
  const x = (p.x - Number(svg.dataset.x0)) * S - it.w / 2, y = (p.y - Number(svg.dataset.y0)) * S - it.h / 2;
  let fail = 0;
  snap(state.sel); keepScroll(() => { d.vgroup.forEach(([from, pid]) => { if (!movePallet(m, state.vehicles, from, pid, to, x, y)) fail++; }); });
  if (d.vgroup.length > 1) { clearSel(); flash(fail ? 'Přesunuto ' + (d.vgroup.length - fail) + ' z ' + d.vgroup.length + ' palet, ' + fail + ' se nevešlo.' : 'Přesunuto ' + d.vgroup.length + ' ' + (d.vgroup.length <= 4 ? 'palety' : 'palet') + '.'); }
  else if (fail) flash('Sem se paleta nevejde.');
}
onBoth('pointerup', e => endDrag(e, false));

// ---------- learning: save a combination or a new article from the drop ----------
// ---------- pallet onto pallet: one dialog (capacity, remember combination) ----------
function askMerge(id, P, srcs, dst, dstNo) {
  // different zakázky never share a pallet
  const dry = JSON.parse(JSON.stringify(P));
  let fit = 0, left = 0, blocked = 0;
  srcs.forEach(src => { const r1 = mergePallets(dry, src.id, dst.id, state.pallets); fit += r1.moved; left += r1.left; if (r1.blocked) blocked++; });
  if (blocked === srcs.length) { clearSel(); flash('Nelze: palety jsou z různých zakázek – zakázky se na jedné paletě nemíchají.'); return; }
  const host = (dst.contents.find(c => !c.ride && c.units > 0) || dst.contents[0] || {}).code || '';
  const arts = new Map();
  srcs.forEach(b => b.contents.forEach(c => { if (!(c.units > 0)) return; const k = c.code.toLowerCase(); const g = arts.get(k) || { code: c.code, name: c.name || '', units: 0, kg: c.kg || 0 }; g.units += c.units; arts.set(k, g); }));
  const list = [...arts.values()], riders = list.filter(a => a.code.toLowerCase() !== host.toLowerCase());
  $('#mgTitle').textContent = 'Přeložit na paletu č. ' + dstNo + (host ? ' (' + host + ')' : '');
  $('#mgText').textContent = srcs.length > 1 ? 'Z ' + srcs.length + ' palet:' : 'Z palety:';
  $('#mgRows').innerHTML = '<div class="lr-h"><span>Artikl</span><span>Kusů</span><span></span></div>' + list.map(a => '<div class="lr"><span><b>' + esc(a.code) + '</b><small>' + esc(a.name) + '</small></span><span>' + a.units + ' ks</span><span></span></div>').join('');
  $('#mgOver').hidden = !left;
  $('#mgOverText').textContent = 'Vejde se jen ' + fit + ' ks z ' + (fit + left) + ' (limit kusů / nosnost palety).';
  $('#dlgMerge').querySelector('input[value="fit"]').checked = true;
  $('#mgRemWrap').hidden = !host || !riders.length; $('#mgRemember').checked = !!dst.group; $('#mgRule').hidden = !dst.group;
  $('#mgRule').textContent = dst.group ? 'Artikly ' + riders.map(a => a.code).join(', ') + ' se přidají do balení ' + dst.group + ' (příště pojedou spolu na jedné paletě).' : 'Pravidlo: ' + riders.map(a => a.code).join(', ') + ' pojede na paletách ' + host + ' (když je v zakázce ' + host + ' a kusů je nejvýše tolik jako teď).';
  $('#mgRemember').onchange = e => { $('#mgRule').hidden = !e.target.checked; };
  $('#dlgMerge').querySelector('form').onsubmit = ev => {
    if (!ev.submitter || ev.submitter.value !== 'yes') { clearSel(); return; }
    const force = !!left && $('#dlgMerge').querySelector('input[value="all"]').checked;
    let moved = 0, rest = 0;
    srcs.forEach(src => { const r1 = mergePallets(P, src.id, dst.id, state.pallets, force); moved += r1.moved; rest += r1.left; });
    if ($('#mgRemember').checked && riders.length && dst.group) addToKoli(riders.map(a => ({ code: a.code, name: a.name, units: a.units })), dst.group, dst.pal);
    else if ($('#mgRemember').checked && riders.length) {
      addCombos(riders.map(a => ({ on: true, code: a.code, withCode: host, min: 0, max: a.units, mode: 'host', host, pl: 0, pw: 0, per: 0, kg: a.kg, name: a.name, note: 'Uloženo z palet' })));
      persist('combos'); drawCombos();
    }
    clearSel(); state.manual.delete(id); keepScroll(() => recalcOne());
    flash(!moved ? 'Cílová paleta je plná – nic se nepřesunulo.' : 'Přeloženo ' + moved + ' ks' + (rest ? ', ' + rest + ' ks zůstalo na původní paletě.' : '.') + ($('#mgRemember').checked && riders.length ? ' Způsob balení uložena.' : ''));
  };
  $('#dlgMerge').showModal();
}
// a new rule wins over older ones for the same article + host: those are dropped, the new one goes first
function addCombos(rules) {
  const key = c => (String(c.code) + '|' + String(c.withCode || '')).toLowerCase();
  const codes = new Set(rules.map(key));
  // same rule as before, only more pieces now: keep one rule, max = the larger count, keep its limit per pallet
  const o = state.orders.get(state.sel);
  rules.forEach(r => {
    const total = o ? [...o.lines.values()].filter(l => l.code.toLowerCase() === String(r.code).toLowerCase()).reduce((m, l) => Math.max(m, l.qty), 0) : 0;
    const old = state.combos.find(c => key(c) === key(r));
    r.max = Math.max(r.max || 0, total, old ? old.max || 0 : 0);
    if (old && !(r.per > 0) && old.per > 0) r.per = old.per;
    if (old && !(r.kg > 0) && old.kg > 0) r.kg = old.kg;
    // přibal of a main item stays a fixed per-pallet rule without a quantity limit
    if (old && old.strict) { r.strict = true; r.max = 0; r.note = old.note; }
  });
  state.combos = rules.concat(state.combos.filter(c => !codes.has(key(c))));
}
// small yes/no dialog in the app's style (instead of the browser's confirm, which freezes the page)
function ask(title, text, yes, check) {
  return new Promise(res => {
    $('#askTitle').textContent = title; $('#askText').textContent = text; $('#askYes').textContent = yes || 'Ano';
    $('#askChkWrap').hidden = !check; $('#askChk').checked = false; $('#askChkText').textContent = check || '';
    $('#dlgAsk').querySelector('form').onsubmit = ev => res(!!ev.submitter && ev.submitter.value === 'yes');
    $('#dlgAsk').showModal();
  });
}
// ---------- check & save an order: combinations, article definitions, its pallets ----------
function unsavePlan(id) {
  const all = load('itab.plans.v1', {}); if (!(id in all)) return;
  delete all[id]; save('itab.plans.v1', all); state.saved.delete(id);
}
function logChanges(id, items) {
  const log = load('itab.log.v1', []);
  log.unshift({ at: new Date().toLocaleString('cs-CZ'), who: (me && me.user && me.user.email) || '', id, items });
  save('itab.log.v1', log.slice(0, 300)); drawLog();
}
function drawLog() {
  const el = $('#comboLog'); if (!el) return;
  const log = load('itab.log.v1', []);
  el.innerHTML = log.length ? log.slice(0, 50).map(e => '<li><b>' + esc(e.at) + '</b> · zakázka ' + esc(e.id) + (e.who ? ' · ' + esc(e.who) : '') + '<ul>' + e.items.map(t => '<li>' + esc(t) + '</li>').join('') + '</ul></li>').join('') : '<li class="muted">Zatím žádné změny.</li>';
}
onBoth('click', e => {
  const vk = e.target.closest('[data-variant]'); if (!vk) return;
  state.variant.set(state.sel, vk.dataset.variant); state.manual.delete(state.sel); keepScroll(() => recalcOne());
});
onBoth('click', e => {
  if (e.target.id !== 'auditBtn') return;
  const id = state.sel, o = state.orders.get(id), r = view(id); if (!o || !r) return;
  const plan = state.plan.get(id) || freezePlan(r, state.catalog);
  const res = auditOrder(o, plan, state.combos, state.catalog, r.project || '');
  const rows = [];
  res.drop.forEach(i => { const c = state.combos[i]; rows.push({ k: 'drop', i, t: c.mode === 'group' ? 'Odebrat ' + c.code + ' z balení ' + (c.group || '') + (c.project ? ' (' + c.project + ')' : '') : 'Smazat neplatný způsob balení: ' + ruleText(c) }); });
  res.update.forEach(u => rows.push({ k: 'upd', u, t: 'Upravit způsob balení ' + ruleText(state.combos[u.i]) + ' → ' + Object.entries(u.ch).map(([k, v]) => (k === 'per' ? 'max ' + v + ' ks/paleta' : k === 'pal' ? 'paleta ' + v : 'do ' + v + ' ks')).join(', ') }));
  res.add.forEach(a => rows.push({ k: 'add', a, t: 'Nový způsob balení: ' + ruleText(a) }));
  res.koliAdd.forEach(x => rows.push({ k: 'kadd', x, t: 'Přidat do balení ' + x.group + ': ' + x.code + ' (' + x.units + ' ks)' }));
  res.seen.forEach(x => rows.push({ k: 'seen', x, t: 'Společná paleta ' + (state.combos[x.i].group || '') + ': ' + x.code + ' ověřeno ' + x.from + ' → ' + x.to + ' ks' }));
  res.defs.forEach(d => rows.push({ k: 'def', d, t: 'Artikl ' + d.code + ': typ palety ' + (d.was || '–') + ' → ' + d.pal }));
  const unk = (r.unknown || []).length;
  $('#auTitle').textContent = 'Zkontrolovat a uložit – zakázka ' + id;
  $('#auRows').innerHTML = (rows.length ? rows.map((x, n) => '<label class="inline au-' + x.k + '"><input type="checkbox" data-au="' + n + '" checked>' + esc(x.t) + '</label>').join('') : '<p class="ok">Způsob balení i definice artiklů odpovídají paletám ✓</p>') +
    (unk ? '<p class="problems">Pozor: ' + unk + ' ' + (unk === 1 ? 'artikl ještě není' : 'artiklů ještě není') + ' zařazeno.</p>' : '');
  $('#dlgAudit').querySelector('form').onsubmit = ev => {
    if (!ev.submitter || ev.submitter.value !== 'yes') return;
    const on = n => $('#auRows [data-au="' + n + '"]').checked, done = [];
    rows.forEach((x, n) => {
      if (!on(n)) return;
      if (x.k === 'upd') Object.assign(state.combos[x.u.i], x.u.ch);
      if (x.k === 'seen') state.combos[x.x.i].per = x.x.to;
      if (x.k === 'kadd') addToKoli([{ code: x.x.code, name: x.x.name, units: x.x.units }], x.x.group, x.x.pal);
      if (x.k === 'def') { const a = state.catalog.find(c => String(c.code).toLowerCase() === x.d.code.toLowerCase()); if (a) a.pal = x.d.pal; }
      done.push(x.t);
    });
    const dropSet = new Set(rows.filter((x, n) => x.k === 'drop' && on(n)).map(x => x.i));
    const adds = rows.filter((x, n) => x.k === 'add' && on(n)).map(x => x.a);
    state.combos = adds.concat(state.combos.filter((c, i) => !dropSet.has(i)));
    if (rows.some((x, n) => on(n) && x.k !== 'def')) { persist('combos'); drawCombos(); }
    if (rows.some((x, n) => on(n) && x.k === 'def')) { persist('catalog'); drawCatalog(); }
    // with the saved rules, does the automatic calculation give the same pallets? then the hand-made plan is not needed
    // compare the automatic result with the hand-made pallets directly (no second full calculation)
    const sigOf = list => list.map(x => x.pal + '|' + x.items.map(c => String(c[0]).toLowerCase() + ':' + c[1]).sort().join('|')).sort().join('#');
    const c0 = Object.assign({}, ctx(id), { plan: null });
    const auto = solve(o, c0);
    const autoSig = sigOf(auto.pallets.map(p => ({ pal: p.pal || (p.pl + 'x' + p.pw), items: [[p.code, p.units]].concat((p.extra || []).map(e => [e.code, e.units])) })));
    const planSig = sigOf(plan.filter(b => b.contents.some(c => c.units > 0)).map(b => ({ pal: b.pal || (b.custom ? b.custom.L + 'x' + b.custom.W : ''), items: b.contents.filter(c => c.units > 0).map(c => [c.code, c.units]) })));
    const planLeft = (r.unknown || []).length;
    const at = new Date().toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
    const all = load('itab.plans.v1', {});
    if (!state.plan.has(id) || (autoSig === planSig && auto.unknown.length <= planLeft) || auto.unknown.length < planLeft) {
      // everything is described by the tables: back to the automatic calculation, nothing hand-made remains
      state.plan.delete(id); delete all[id]; save('itab.plans.v1', all); state.saved.set(id, at);
      done.push('Zakázka se počítá automaticky podle tabulek (' + auto.pallets.length + ' palet)');
    } else {
      // some hand moves cannot be written as rules: the pallets are kept as they are now
      state.plan.set(id, plan); all[id] = { plan, at }; save('itab.plans.v1', all); state.saved.set(id, at);
      done.push('Palety uloženy ručně (' + plan.length + ') – automatický výpočet dává ' + auto.pallets.length + ' palet');
    }
    state.manual.delete(id);
    logChanges(id, done);
    recalc();
    flash(done[done.length - 1] + '.');
  };
  $('#dlgAudit').showModal();
});
// articles used as main item or přibal (strict host rules) – they do not go into balení
function hostCodes() {
  const set = new Set();
  state.combos.forEach(r => { if (r.mode === 'host' && r.strict) { set.add(String(r.code).toLowerCase()); set.add(String(r.host).toLowerCase()); } });
  return set;
}
// articles that become a main item / přibal leave their balení rows
function dropFromKoli(codes, project) {
  // only balení of the same project are changed (project undefined = all, used by the pallet editor)
  const set = new Set(codes.map(c => String(c).toLowerCase())), lp = String(project || '').toLowerCase();
  state.combos = state.combos.filter(r => !(r.mode === 'group' && set.has(String(r.code).toLowerCase()) && (project === undefined || String(r.project || '').toLowerCase() === lp)));
}
// weights from the pasted balení (netto column, kg of one piece) for catalog articles without weight
function kgSetPre() {
  let n = 0;
  // pallet types without own weight get it from the PAL line (brutto)
  (koParsed ? koParsed.pals : []).forEach(p => { const t = p.kg > 0 && state.pallets.find(x => String(x.code).toLowerCase() === p.code.toLowerCase()); if (t && !(t.tare > 0)) { t.tare = p.kg; persist('pallets'); drawPallets(); } });
  (koParsed ? koParsed.items : []).forEach(it => { const a = it.kg > 0 && state.catalog.find(x => String(x.code).toLowerCase() === it.code.toLowerCase()); if (a && !(a.kg > 0)) { a.kg = it.kg; n++; } });
  return n;
}
// ---------- import balení (articles that travelled together on one pallet) ----------
let koParsed = { items: [], pals: [] };
function koPalCode() {
  if (!$('#koSelWrap').hidden) return $('#koSel').value;
  const v = $('#koPal').value.trim(), t = typeOf(state.pallets, v.split(' · ')[0].trim()) || state.pallets.find(p => palOption(p).toLowerCase() === v.toLowerCase());
  return t ? t.code : (/^PAL-[0-9][0-9A-Z-]*$/i.test(v) ? v.toUpperCase() : '');
}
function koUpdate() {
  koParsed = parseKolo($('#koText').value);
  const it = koParsed.items;
  $('#koPreview').innerHTML = it.length ? '<p><b>' + it.length + '</b> artiklů' + (koParsed.pals.length ? ', palety v balení: ' + koParsed.pals.map(p => esc(p.code)).join(', ') : '') + '</p><div class="tscroll"><table><thead><tr><th>Artikl</th><th>Název</th><th class="num">Ověřeno ks</th><th class="num">kg / ks</th></tr></thead><tbody>' +
    it.map(x => '<tr><td>' + esc(x.code) + '</td><td>' + esc(x.name) + '</td><td class="num">' + x.seen + '</td><td class="num">' + (x.kg > 0 ? String(x.kg).replace('.', ',') : '–') + '</td></tr>').join('') + '</tbody></table></div>' : '';
  koPalCheck();
}
function koPalCheck() {
  const code = koPalCode(), exists = !!typeOf(state.pallets, code);
  const fromKolo = koParsed.pals.find(p => p.code.toLowerCase() === code.toLowerCase());
  const isNew = !!code && !exists && /^PAL-[0-9][0-9A-Z-]*$/i.test(code);
  $('#koNew').hidden = !isNew;
  if (isNew && $('#koNewCode').textContent !== code) {
    $('#koNewCode').textContent = code;
    const nm = fromKolo ? fromKolo.name : '', nums = (nm.match(/\d{3,4}/g) || []).map(Number);
    $('#koNewName').value = nm || code;
    $('#koNewL').value = nums.length >= 2 ? Math.max(nums[0], nums[1]) : '';
    $('#koNewW').value = nums.length >= 2 ? Math.min(nums[0], nums[1]) : '';
    $('#koNewTare').value = fromKolo && fromKolo.kg > 0 ? fromKolo.kg : 0; // brutto of the PAL line = own weight of the pallet
  }
  const okPal = exists || (isNew && toNum($('#koNewL').value) > 0 && toNum($('#koNewW').value) > 0);
  $('#koSave').disabled = !(koParsed.items.length && okPal);
  $('#koMsg').textContent = !koParsed.items.length ? '' : !code ? 'Zadejte typ palety.' : (!exists && !isNew) ? 'Paleta není v seznamu – vyberte z nabídky nebo zadejte kód PAL-xxxx.' : (isNew && !okPal) ? 'Doplňte délku a šířku nové palety.' : '';
}
$('#koloBtn').addEventListener('click', () => {
  $('#koForm').reset(); $('#koPreview').innerHTML = ''; $('#koMsg').textContent = ''; $('#koNew').hidden = true; $('#koNewCode').textContent = '';
  $('#koSelWrap').hidden = true; $('#koPalWrap').hidden = false; koParsed = { items: [], pals: [] };
  $('#koPalList').innerHTML = state.pallets.map(t => '<option value="' + esc(palOption(t)) + '"></option>').join('');
  // project of the open order is offered first
  const cur = (view(state.sel) || {}).project || '';
  $('#koProj').innerHTML = '<option value="">všechny projekty</option>' + projNames().map(n => '<option' + (n === cur ? ' selected' : '') + '>' + esc(n) + '</option>').join('');
  $('#koSave').disabled = true;
  $('#dlgKolo').showModal(); $('#koText').focus();
});
$('#koText').addEventListener('input', () => {
  koUpdate();
  // pallet from the pasted koli: one → filled in, several → choose from them, none → search all
  const p = koParsed.pals;
  $('#koSelWrap').hidden = p.length < 2; $('#koPalWrap').hidden = p.length >= 2;
  if (p.length >= 2) $('#koSel').innerHTML = '<option value="">— vyberte paletu —</option>' + p.map(x => { const t = typeOf(state.pallets, x.code); return '<option value="' + esc(x.code) + '">' + esc(t ? palOption(t) : x.code + ' · ' + x.name + ' (nová)') + '</option>'; }).join('');
  else if (p.length === 1) { const t = typeOf(state.pallets, p[0].code); $('#koPal').value = t ? palOption(t) : p[0].code; }
  const keep = $('#koMain').value;
  $('#koMain').innerHTML = '<option value="">– žádný, společná paleta –</option>' + koParsed.items.map(x => '<option value="' + esc(x.code) + '"' + (x.code === keep ? ' selected' : '') + '>' + esc(x.code + (x.name ? ' · ' + x.name : '') + ' (' + x.seen + ' ks)') + '</option>').join('');
  koPalCheck();
});
['#koPal', '#koSel', '#koNewL', '#koNewW'].forEach(s => { $(s).addEventListener('input', koPalCheck); $(s).addEventListener('change', koPalCheck); });
$('#koForm').onsubmit = ev => {
  if (!ev.submitter || ev.submitter.value !== 'yes') return;
  const code = koPalCode();
  if (!koParsed.items.length || !code) { ev.preventDefault(); return; }
  if (!typeOf(state.pallets, code)) {
    const L = toNum($('#koNewL').value), W = toNum($('#koNewW').value);
    if (!(L > 0 && W > 0)) { ev.preventDefault(); koPalCheck(); return; }
    state.pallets.push({ code, name: $('#koNewName').value.trim() || code, L: Math.max(L, W), W: Math.min(L, W), H: 0, tare: toNum($('#koNewTare').value) || 0, maxKg: 0, rot: true });
    persist('pallets'); drawPallets();
  }
  // one article alone = its own pallet: that is a catalog definition, not a balení
  if (koParsed.items.length === 1 && !$('#koMain').value) {
    const it = koParsed.items[0], low = x => String(x).toLowerCase();
    const ex = state.catalog.find(a => low(a.code) === low(it.code)), def = { code: it.code, name: (ex && ex.name) || it.name || '', pack: 'paleta', pal: code, per: Math.max(1, it.seen || 1), kg: (ex && ex.kg) || 0, rot: true };
    if (ex) { delete ex.pl; delete ex.pw; Object.assign(ex, def); } else state.catalog.push(def);
    persist('catalog'); drawCatalog();
    logChanges('–', ['Artikl ' + it.code + ' jede sám na paletě ' + code + ' (' + def.per + ' ks)']);
    recalc(); flash('Jeden artikl = vlastní paleta: ' + it.code + ' uložen do číselníku na ' + code + ' (' + def.per + ' ks na paletě).');
    return;
  }
  // one normal table row per article (mode „na společné paletě“), new rows go first
  const lowm = x => String(x || '').toLowerCase(), projSel = $('#koProj').value;
  // main item not chosen: an article that is already a main item (has přibal) in this project is recognised automatically
  const auto = $('#koMain').value ? '' : (koParsed.items.find(it => state.combos.some(r => r.mode === 'host' && r.strict && lowm(r.host) === lowm(it.code) && (!r.project || lowm(r.project) === lowm(projSel)))) || {}).code || '';
  const main = $('#koMain').value || auto;
  if (auto) flash('Rozpoznána hlavní položka ' + auto + ' – ostatní artikly se připojí jako přibal.');
  // one main item = one koli: a main item that already has a balení is completed, no second balení number
  const mainRows = main ? state.combos.filter(r => r.mode === 'host' && r.strict && lowm(r.host) === lowm(main)) : [];
  const group = mainRows.length ? (koliOf(mainRows[0]) || nextKoloCode(state.combos)) : nextKoloCode(state.combos);
  // an article lives in one kind of rule only: main item / přibal, or balení
  const inHost = hostCodes(), lowc = c => String(c).toLowerCase();
  let skipped = [], items = koParsed.items;
  if (!main) { skipped = items.filter(it => inHost.has(lowc(it.code))).map(it => it.code); items = items.filter(it => !inHost.has(lowc(it.code))); }
  else dropFromKoli(items.map(it => it.code), projSel);
  // with a main item: přibal rides on its pallet (fixed max per pallet); without: one shared pallet
  const proj = $('#koProj').value;
  // the same balení imported again (all its articles already in one balení of this project and pallet): no duplicate, only weights and verified counts
  if (!main && items.length) {
    const lw = c => String(c || '').toLowerCase();
    const groups = new Map();
    state.combos.forEach(r => { if (r.mode === 'group' && lw(r.pal) === lw(code) && lw(r.project) === lw(proj)) { const g = groups.get(r.group) || []; g.push(r); groups.set(r.group, g); } });
    const same = [...groups.entries()].find(([, rs]) => items.every(it => rs.some(r => lw(r.code) === lw(it.code))));
    if (same) {
      items.forEach(it => { const r = same[1].find(x => lw(x.code) === lw(it.code)); if (r && it.seen > (r.per || 0)) r.per = it.seen; });
      if (kgSetPre()) { persist('catalog'); drawCatalog(); }
      persist('combos'); drawCombos(); recalc();
      $('#dlgKolo').close(); flash('Balení už existuje (' + same[0] + ') – nic nového se nepřidalo, doplněny váhy a ověřené kusy.');
      return;
    }
  }
  let rows = main ? koloHostRows(items, main, group, $('#koName').value.trim()) : items.map(it => koloRow(it, group, code, $('#koName').value.trim(), true, proj));
  if (main) {
    // přibal rows belong to the chosen project; the main item itself rides on the balení's pallet (Solo P., 1 ks) unless it already has one
    rows.forEach(r => { r.project = proj; });
    const lw = c => String(c || '').toLowerCase();
    if (!state.combos.some(r => r.mode === 'pallet' && lw(r.code) === lw(main) && (lw(r.project) === lw(proj) || !r.project)))
      rows.push({ on: true, code: main, withCode: '', min: 0, max: 0, mode: 'pallet', host: '', pal: code, pl: 0, pw: 0, per: 1, kg: 0, name: (items.find(it => lw(it.code) === lw(main)) || {}).name || '', project: proj, note: 'Hlavní položka balení ' + group });
  }
  if (mainRows.length) rows = rows.filter(n => { const old = mainRows.find(r => lowm(r.code) === lowm(n.code)); if (!old) return true; old.per = Math.max(old.per || 0, n.per || 0); return false; });
  // missing articles get a catalog entry: name, weight 0 to fill in, packing decided later (alone it may be a parcel)
  let addedArt = 0;
  // weight from the „netto hmotnost“ column fills articles that have no weight yet
  const kgSet = kgSetPre();
  if ($('#koCat').checked) koParsed.items.forEach(it => {
    if (state.catalog.some(a => String(a.code).toLowerCase() === it.code.toLowerCase())) return;
    // the machine goes on the balení's pallet type; accessories get their packing later
    state.catalog.push(it.code === main ? { code: it.code, name: it.name || '', pack: 'paleta', pal: code, per: 1, kg: it.kg || 0, rot: true } : { code: it.code, name: it.name || '', pack: 'neurceno', per: 0, kg: it.kg || 0, rot: true }); addedArt++;
  });
  if (addedArt || kgSet) { persist('catalog'); drawCatalog(); }
  state.combos = rows.concat(state.combos); persist('combos'); drawCombos();
  logChanges('–', ['Import balení ' + group + ': ' + rows.length + ' řádků způsobů balení, společná paleta ' + code]);
  recalc();
  flash('Balení ' + group + ': přidáno ' + rows.length + ' řádků do způsobů balení (' + code + ')' + (addedArt ? ', ' + addedArt + ' artiklů do číselníku' : '') + (skipped.length ? '. Vynecháno ' + skipped.length + ' (už jsou jako hlavní položka / přibal): ' + skipped.join(', ') : '') + '.');
};
// ---------- articles used in combinations but missing in the catalog → catalog (packing decided later) ----------
$('#comboToCat').addEventListener('click', async () => {
  const have = new Set(state.catalog.map(a => String(a.code).trim().toLowerCase())), add = new Map();
  state.combos.forEach(r => {
    const k = String(r.code || '').trim().toLowerCase();
    if (k && !have.has(k) && !add.has(k)) add.set(k, { code: String(r.code).trim(), name: r.name || '', pack: 'neurceno', per: 0, kg: r.kg > 0 ? r.kg : 0, rot: true });
  });
  if (!add.size) { flash('Všechny artikly ze způsobů balení už v číselníku jsou.'); return; }
  if (!await ask('Doplnit artikly do číselníku?', add.size + ' artiklů ze způsobů balení v číselníku chybí. Přidají se s názvem, váhou 0 a balením „neurčeno“ (určíte ho při prvním zařazení).', 'Přidat ' + add.size)) return;
  state.catalog.push(...add.values()); persist('catalog'); drawCatalog();
  logChanges('–', ['Do číselníku přidáno ' + add.size + ' artiklů ze způsobů balení (balení neurčeno)']);
  recalc();
  flash('Přidáno do číselníku: ' + add.size + ' artiklů.');
});
// ---------- consolidate koli: groups that say the same as another group ----------
$('#koloMerge').addEventListener('click', () => {
  const found = findDuplicateGroups(state.combos);
  const hint = $('#auHint').innerHTML;
  $('#auTitle').textContent = 'Sloučit balení';
  $('#auHint').textContent = 'Balení na stejném typu palety, která mají společný artikl, jsou jedno balení viděné po částech – spojí se do nejstaršího (1 2 3 4 5 + 3 4 5 6 → 1 2 3 4 5 6). Balení s jediným artiklem, který je ve větším balení, se smaže. Pravidla s podmínkou („když je v zakázce“, hlavní položka) se nemění.';
  $('#auRows').innerHTML = found.length ? found.map((m, n) => '<label class="inline ' + (m.kind === 'merge' ? 'au-add' : 'au-drop') + '"><input type="checkbox" data-au="' + n + '" checked>' +
    esc(m.kind === 'solodup' ? m.code + ': ' + m.what + ' je dvakrát → smazat duplicitní řádek' : m.kind === 'hostmerge' ? 'Hlavní položka ' + m.host + ': balení ' + m.drop.join(', ') + ' → sloučit do ' + m.keep + ' (jedna položka = jedno balení)' : m.kind === 'hostdup' ? 'Přibal ' + m.code + ' na ' + m.host + ' je dvakrát → jedno pravidlo, max ' + m.per + ' ks/paleta' : m.kind === 'merge' ? 'Spojit ' + m.drop.join(', ') + ' → ' + m.keep + ' · ' + m.pal + ' · celkem ' + m.codes + ' artiklů' : 'Smazat ' + m.drop + ' (jen ' + m.code.toUpperCase() + ', ten je v ' + m.into + ')') + '</label>').join('')
    : '<p class="ok">Žádné duplicitní balení ✓</p>';
  $('#dlgAudit').querySelector('form').onsubmit = ev => {
    $('#auHint').innerHTML = hint;
    if (!ev.submitter || ev.submitter.value !== 'yes') return;
    const chosen = found.filter((m, n) => $('#auRows [data-au="' + n + '"]').checked);
    if (!chosen.length) return;
    state.combos = mergeGroups(state.combos, chosen); persist('combos'); drawCombos();
    logChanges('–', chosen.map(m => m.kind === 'solodup' ? m.code + ': duplicitní ' + m.what + ' smazán' : m.kind === 'hostmerge' ? 'Hlavní položka ' + m.host + ': balení ' + m.drop.join(', ') + ' sloučeno do ' + m.keep : m.kind === 'hostdup' ? 'Přibal ' + m.code + ' na ' + m.host + ': duplicitní pravidlo sloučeno (max ' + m.per + ')' : m.kind === 'merge' ? 'Balení ' + m.drop.join(', ') + ' spojeno do ' + m.keep : 'Balení ' + m.drop + ' smazáno (' + m.code.toUpperCase() + ' je v ' + m.into + ')'));
    recalc();
    flash('Sloučeno: ' + chosen.length + ' balení.');
  };
  $('#dlgAudit').showModal();
});
// ---------- projects (kept inside the shared rules) ----------
function projNames() { return (state.rules.projects || []).map(p => p.name).filter(Boolean); }
function drawProjects() {
  const list = state.rules.projects || [];
  const baleniCount = name => new Set(state.combos.filter(r => r.mode === 'group' && r.project === name).map(r => r.group)).size;
  $('#projBody').innerHTML = list.map((p, i) => '<tr><td><input type="text" data-p="' + i + '" data-pf="name" value="' + esc(p.name || '') + '" placeholder="např. Action"></td>' +
    '<td><textarea data-p="' + i + '" data-pf="keys" placeholder="V-06-1019-0-0000-V5/9003">' + esc((p.keys || []).join(', ')) + '</textarea></td><td class="num">' + baleniCount(p.name) + '</td>' +
    '<td><button class="btn small" data-pdel="' + i + '">Smazat</button></td></tr>').join('') || '<tr><td colspan="4" class="empty">Zatím žádný projekt.</td></tr>';
}
$('#projAdd').addEventListener('click', () => { state.rules.projects = (state.rules.projects || []).concat([{ name: '', keys: [] }]); drawProjects(); const ins = document.querySelectorAll('#projBody input'); if (ins.length) ins[ins.length - 1].focus(); });
$('#projBody').addEventListener('change', e => {
  const i = e.target.getAttribute('data-p'); if (i == null) return;
  const p = state.rules.projects[Number(i)], f = e.target.getAttribute('data-pf');
  if (f === 'name') {
    const old = p.name, nu = e.target.value.trim();
    // balení of the project follow the new name
    if (old && nu && old !== nu) { state.combos.forEach(r => { if (r.project === old) r.project = nu; }); persist('combos'); drawCombos(); }
    p.name = nu;
  } else p.keys = e.target.value.split(/[\n,;\t]+/).map(x => x.trim()).filter(Boolean);
  persist('rules'); drawProjects(); recalc();
});
$('#projBody').addEventListener('click', async e => {
  const i = e.target.getAttribute('data-pdel'); if (i == null) return;
  const p = state.rules.projects[Number(i)];
  if (!await ask('Smazat projekt?', 'Projekt „' + (p.name || '') + '“ se smaže. Jeho balení zůstanou a budou platit pro všechny projekty.', 'Smazat')) return;
  state.combos.forEach(r => { if (r.project && r.project === p.name) r.project = ''; });
  state.rules.projects.splice(Number(i), 1); persist('rules'); persist('combos'); drawProjects(); drawCombos(); recalc();
});
$('#tab-projects').addEventListener('click', drawProjects);
// project chosen by hand in the order detail (otherwise recognised by key articles)
onBoth('change', e => {
  if (e.target.id !== 'projSel') return;
  state.projSel.set(state.sel, e.target.value); save('itab.projsel.v1', Object.fromEntries(state.projSel));
  state.manual.delete(state.sel); keepScroll(() => recalcOne());
});
// ---------- learning balení in the order ----------
// articles join balení `group` on pallet `pal`; new rows get the balení's project; verified pcs only grow
function addToKoli(items, group, pal) {
  const low = s => String(s || '').toLowerCase(), inHost = hostCodes();
  const mine = state.combos.filter(r => r.mode === 'group' && low(r.group) === low(group) && low(r.pal) === low(pal));
  const project = mine.length ? mine[0].project || '' : ((view(state.sel) || {}).project || '');
  const added = [], skipped = [];
  items.forEach(it => {
    if (inHost.has(low(it.code))) { skipped.push(it.code); return; }
    const r = mine.find(x => low(x.code) === low(it.code));
    if (r) { r.per = Math.max(r.per || 0, it.units || 0); return; }
    const row = koloRow({ code: it.code, name: it.name, seen: it.units || 1 }, group, pal, '', true, project);
    const at = state.combos.indexOf(mine[mine.length - 1]);
    state.combos.splice(at >= 0 ? at + 1 : 0, 0, row); mine.push(row); added.push(it.code);
  });
  persist('combos'); drawCombos();
  if (added.length) logChanges(state.sel, ['Do balení ' + group + ' přidáno: ' + added.join(', ')]);
  return { added, skipped };
}
// unknown article dropped on a balení pallet
async function askKoloAdd(list, group, pal, bid, pi) {
  const what = list.map(u => u.code + ' ' + u.qty + ' ks').join(', ');
  const p0 = ask('Přidat na paletu balení ' + group + '?', what + ' se položí na paletu balení ' + group + ' (' + pal + ').', 'Potvrdit',
    'Zapamatovat – přidat do balení ' + group + ' (příště pojede spolu s ostatními artikly)');
  $('#askChk').checked = true;
  if (!(await p0)) { clearSel(); return; }
  const remember = $('#askChk').checked;
  let added = list.map(u => u.code);
  if (remember) {
    const res = addToKoli(list.map(u => ({ code: u.code, name: u.name, units: u.qty })), group, pal);
    added = res.added;
    if (res.skipped.length) flash('Vynecháno (hlavní položka / přibal): ' + res.skipped.join(', '));
  }
  // only this order (or pallets edited by hand): put the pieces on that pallet in the order's plan
  const id = state.sel;
  if (!remember || state.plan.has(id)) {
    const wasPlan = state.plan.has(id), P = ensurePlan(id);
    const filled = P.filter(x => x.contents.some(c => c.units > 0));
    const b = (wasPlan && bid && P.find(x => x.id === bid)) || filled[Number(pi)] || P.find(x => x.id === bid);
    if (b) list.filter(u => added.includes(u.code)).forEach(u => b.contents.push({ code: u.code, name: u.name || '', units: u.qty, per: u.qty, kg: 0, so: u.so, ride: !remember }));
  }
  clearSel();
  if (remember) relearn(); else keepScroll(() => recalcOne());
  flash(remember ? 'Přidáno do balení ' + group + ': ' + (added.join(', ') || '–') + '.' : 'Položeno na paletu ' + group + ' jen pro tuto zakázku (balení se nemění).');
}
// pallet editor: the pallet as it is now becomes a balení (or a main item + přibal)
$('#peKoli').addEventListener('click', async () => {
  const { id, pid } = peCur, P = state.plan.get(id), b = P && P.find(x => x.id === pid); if (!b) return;
  if (!typeOf(state.pallets, b.pal)) { flash('Nejdřív paletu uložte jako typ (Změnit typ / Jiná paleta se „Zapamatovat“).'); return; }
  const items = b.contents.filter(c => c.units > 0).map(c => ({ code: c.code, name: c.name || '', seen: c.units }));
  if (items.length < 2) { flash('Na paletě je jen jeden artikl – to není balení.'); return; }
  const main = b.contents.filter(c => c.units > 0 && !c.ride).sort((x, y) => y.units - x.units)[0] || b.contents[0];
  const ok = await ask('Uložit jako balení?', items.length + ' artiklů na paletě ' + b.pal + ' se uloží jako balení.', 'Uložit balení', main.code + ' je hlavní položka (pokladna) – ostatní jsou přibal na její paletě');
  if (!ok) return;
  const group = nextKoloCode(state.combos), project = (view(id) || {}).project || '';
  if ($('#askChk').checked) {
    dropFromKoli(items.map(x => x.code), project);
    state.combos = koloHostRows(items, main.code, group, '').concat(state.combos);
    const a = state.catalog.find(x => String(x.code).toLowerCase() === main.code.toLowerCase());
    if (a && (a.pack === 'neurceno' || !a.pal)) { Object.assign(a, { pack: 'paleta', pal: b.pal, per: 1 }); persist('catalog'); drawCatalog(); }
  } else if (b.group) {
    // already a balení pallet: complete that balení instead of creating a second one
    addToKoli(items.map(x => ({ code: x.code, name: x.name, units: x.seen })), b.group, b.pal);
  } else {
    const inHost = hostCodes(), keep = items.filter(x => !inHost.has(x.code.toLowerCase()));
    state.combos = keep.map(x => koloRow(x, group, b.pal, '', true, project)).concat(state.combos);
    b.group = group;
  }
  persist('combos'); drawCombos();
  logChanges(id, ['Paleta uložena jako balení ' + (b.group || group) + ' (' + items.length + ' artiklů, ' + b.pal + ')' + ($('#askChk').checked ? ', hlavní položka ' + main.code : '')]);
  $('#dlgPalEdit').close(); keepScroll(() => recalcOne());
  flash('Uloženo jako balení ' + (b.group || group) + '.');
});

// hint „z balení BAL-8“ on an unknown article: show the balení and offer to use it in this order anyway
onBoth('click', async e => {
  const h = e.target.closest('.unk-hint'); if (!h) return;
  e.stopPropagation();
  const g = h.dataset.koli, low = s => String(s || '').toLowerCase();
  const rows = state.combos.filter(r => r.mode === 'group' && low(r.group) === low(g));
  if (!rows.length) return;
  const o = state.orders.get(state.sel), inOrder = new Set([...o.lines.values()].map(l => low(l.code)));
  const t = typeOf(state.pallets, rows[0].pal);
  const list = rows.map(r => r.code + (inOrder.has(low(r.code)) ? ' ✓' : '')).join(', ');
  const ok = await ask('Balení ' + rows[0].group + ' – ' + rows[0].pal + (t ? ' ' + t.name : ''),
    'Artikly balení (✓ = jsou v této zakázce): ' + list + '. Tento artikl má v zakázce víc kusů, než balení dovoluje (Max ks). Přetáhněte ho na jinou paletu nebo na volné místo; nebo zvyšte Max ks v Způsobech balení.', 'Rozumím');
  void ok;
});
function relearn() { state.manual.delete(state.sel); recalc(); }

// one or more unknown articles ride on the pallets of article `host`
// přibal dropped again on its main item: suggest a max per pallet that fits everything of this order
function suggestPer(u, host) {
  const low = s => String(s).toLowerCase();
  const old = state.combos.find(r => r.mode === 'host' && low(r.code) === low(u.code) && low(r.host) === low(host));
  if (!old || !(old.per > 0)) return '';
  const r0 = view(state.sel), o = state.orders.get(state.sel); if (!r0 || !o) return old.per;
  const total = [...o.lines.values()].filter(l => low(l.code) === low(u.code) && (!u.so || l.so === u.so)).reduce((s, l) => s + l.qty, 0);
  const hosts = r0.pallets.filter(p => low(p.code) === low(host) && (!u.so || p.so === u.so)).length || 1;
  return Math.max(old.per, Math.ceil(total / hosts));
}
function askCombo(list, host, bid) {
  // the rule only works inside one zakázka: the host article must be on a pallet of the same zakázka
  const r0 = view(state.sel), lowH = host.toLowerCase();
  const miss = r0 && list.find(u => u.so && !r0.pallets.some(p => p.so === u.so && p.code.toLowerCase() === lowH));
  if (miss) { flash('Artikl ' + miss.code + ' je v zakázce ' + miss.so + ', kde nejsou palety ' + host + '. Zakázky se na paletě nemíchají – vyberte paletu ze stejné zakázky nebo volné místo (nový artikl).'); return; }
  const dlg = $('#dlgCombo');
  const hostArt = state.catalog.find(a => String(a.code).toLowerCase() === host.toLowerCase());
  $('#dcTitle').textContent = list.length > 1 ? 'Přesunout ' + list.length + ' artikly na paletu' : 'Přesunout artikl na paletu';
  $('#dcText').innerHTML = 'Pojedou na paletě <b>' + esc(host) + '</b>' + (hostArt && hostArt.name ? ' <span class="dlg-name">' + esc(hostArt.name) + '</span>' : '') + '.';
  $('#dcRows').innerHTML = '<div class="lr-h m"><span>Artikl</span><span>Kusů</span><span>Max ks / paleta</span><span>Váha kusu, kg</span></div>' + list.map((u, i) =>
    '<div class="lr m"><span><b>' + esc(u.code) + '</b><small>' + esc(u.name || '') + '</small></span><span>' + u.qty + ' ks</span><input type="number" min="0" step="1" data-cp="' + i + '" placeholder="bez limitu" value="' + suggestPer(u, host) + '"><input type="number" min="0" step="any" data-ck="' + i + '" placeholder="neznámá"></div>').join('');
  $('#dcRule').textContent = 'Pravidlo: když je v zakázce ' + host + ' a artikl je nejvýše tolik kusů jako teď, jede na paletách ' + host + ' (nejvýše „Max ks / paleta“ na každou). Co se nevejde, zůstane vpravo.';
  $('#dcRemember').checked = true; $('#dcRule').hidden = false;
  // act on the button press itself; the dialog's close event is not reliable in every browser
  dlg.querySelector('form').onsubmit = ev => {
    if (!ev.submitter || ev.submitter.value !== 'yes') return;
    const rules = list.map((u, i) => ({ on: true, code: u.code, withCode: host, min: 0, max: u.qty, mode: 'host', host, pl: 0, pw: 0, per: Math.max(0, Math.floor(toNum($('#dcRows [data-cp="' + i + '"]').value) || 0)), kg: toNum($('#dcRows [data-ck="' + i + '"]').value) || 0, name: u.name || '', note: 'Uloženo z nakládky' }));
    if ($('#dcRemember').checked) { addCombos(rules); persist('combos'); drawCombos(); flash('Přesunuto ' + rules.length + '× a způsoby balení uloženy.'); }
    else { const id = state.sel; state.oneOff.set(id, (state.oneOff.get(id) || []).concat(rules)); flash('Přesunuto jen pro tuto zakázku.'); }
    // pallets edited by hand: rules do not change them, so the pieces are put on the host pallets right away
    const P = state.plan.get(state.sel);
    if (P) list.forEach((u, i) => {
      const rule = rules[i], cap = rule.per > 0 ? rule.per : Infinity;
      const hosts = P.filter(b => b.contents.some(c => c.units > 0 && c.code.toLowerCase() === lowH && (!u.so || !c.so || c.so === u.so)));
      hosts.sort((a, b) => (b.id === bid) - (a.id === bid));
      let left = u.qty;
      hosts.forEach(b => {
        if (left <= 0) return;
        const has = b.contents.filter(c => c.ride && c.code === u.code).reduce((s, c) => s + c.units, 0), n = Math.min(left, cap - has);
        if (n <= 0) return;
        b.contents.push({ code: u.code, name: u.name || '', units: n, per: n, kg: rule.kg, so: u.so, ride: true }); left -= n;
      });
    });
    clearSel(); relearn();
  };
  dlg.returnValue = ''; dlg.showModal();
}
// ---------- pallet editor ----------
function ensurePlan(id) {
  if (!state.plan.has(id)) {
    state.plan.set(id, freezePlan(view(id), state.catalog));
    state.board.delete(id); state.manual.delete(id);
  }
  return state.plan.get(id);
}
let peCur = null;
function openPalEditor(id, bid, pi) {
  const wasPlan = state.plan.has(id), P = ensurePlan(id);
  const filled = P.filter(b => b.contents.some(c => c.units > 0));
  const b = (wasPlan && bid && P.find(x => x.id === bid)) || filled[pi] || P.find(x => x.id === bid);
  if (!b) return;
  peCur = { id, pid: b.id, row: null, wasPlan, snap: JSON.stringify(P) };
  if (!wasPlan) keepScroll(() => recalcOne());
  drawPalEditor();
  $('#dlgPalEdit').showModal();
}
// closing the editor without any change: the order stays automatic (no "edited by hand" banner)
function peClosed() {
  if (!peCur || peCur.wasPlan) return;
  const P = state.plan.get(peCur.id); peCur.wasPlan = true;
  if (P && JSON.stringify(P) === peCur.snap) { state.plan.delete(peCur.id); keepScroll(() => recalcOne()); }
}
// the dialog's close event is not reliable: also the form submit (Hotovo) and Esc
$('#dlgPalEdit').addEventListener('close', peClosed);
$('#dlgPalEdit').addEventListener('cancel', () => setTimeout(peClosed, 0));
$('#dlgPalEdit').querySelector('form').addEventListener('submit', () => setTimeout(peClosed, 0));
// problems of one pallet: pieces over the verified count / over the max of the rule
function palIssues(b) {
  const low = s => String(s || '').toLowerCase(), main = b.contents.find(c => c.units > 0 && !c.ride);
  return b.contents.map((c, i) => {
    if (!(c.units > 0)) return null;
    if (b.group) {
      const r = state.combos.find(x => x.mode === 'group' && low(x.group) === low(b.group) && low(x.code) === low(c.code));
      if (!r) return { i, c, r: null, t: 'není v balení ' + b.group };
      if (r.cap > 0 && c.units > r.cap) return { i, c, r, t: c.units + ' ks, max ' + r.cap + ' ks' };
      if (r.per > 0 && c.units > r.per) return { i, c, r, t: c.units + ' ks, ověřeno jen ' + r.per + ' ks', fix: { per: c.units } };
      return null;
    }
    if (c.ride && main) {
      const r = state.combos.find(x => x.mode === 'host' && low(x.code) === low(c.code) && low(x.host) === low(main.code));
      if (r && r.per > 0 && c.units > r.per) return { i, c, r, t: c.units + ' ks, max ' + r.per + ' ks na hlavní položku', fix: { per: c.units } };
    }
    return null;
  }).filter(Boolean);
}
function drawPalEditor() {
  const { id, pid } = peCur, P = state.plan.get(id), b = P.find(x => x.id === pid);
  if (!b) { $('#dlgPalEdit').close(); return; }
  const filled = P.filter(x => x.contents.some(c => c.units > 0)), n = filled.indexOf(b) + 1;
  const t = typeOf(state.pallets, b.pal) || b.custom || { code: b.pal, name: '', L: 0, W: 0, tare: 0 };
  const fill = b.contents.filter(c => !c.ride).reduce((s, c) => s + c.units / (c.per || c.units || 1), 0);
  const kg = (t.tare || 0) + b.contents.reduce((s, c) => s + c.units * (c.kg || 0), 0);
  const label = x => { const i = filled.indexOf(x), main = x.contents.find(c => c.units > 0); return (i >= 0 ? 'č. ' + (i + 1) : 'prázdná') + ' · ' + (x.pal || 'JINÁ') + (main ? ' · ' + main.code + ' ' + main.units + ' ks' : ''); };
  const soNow = (b.contents.find(c => c.units > 0) || {}).so;
  const others = P.filter(x => x !== b && sameSo(x, soNow)).map(x => '<option value="' + esc(x.id) + '">' + esc(label(x)) + '</option>').join('');
  $('#peTitle').textContent = (n ? 'Paleta č. ' + n : 'Prázdná paleta') + ' – zakázka ' + id;
  const iss = palIssues(b);
  const cm = mm => Math.round((mm || 0) / 10);
  // panel for moving pieces of one article: same type / other type from the database / brand new pallet / existing pallet
  const movePanel = (c, i) => '<div class="pe-move">' +
    '<label class="pm-qty">Kolik kusů přesunout<input type="number" id="pmQty" min="1" max="' + c.units + '" value="' + c.units + '"></label>' +
    '<div class="pm-opts">' +
    '<label class="pm-opt"><input type="radio" name="pmKind" value="same" checked><span><b>Stejná paleta</b><small>nová ' + esc(t.code || '') + ' · ' + esc(t.name || '') + ' (' + cm(t.L) + ' × ' + cm(t.W) + ' cm)</small></span></label>' +
    '<label class="pm-opt"><input type="radio" name="pmKind" value="other"><span><b>Jiná paleta</b><small>vyhledat v databázi typů palet</small><input type="search" id="pmOther" list="palList2" placeholder="kód, název nebo rozměr…" class="pm-sub"></span></label>' +
    '<label class="pm-opt"><input type="radio" name="pmKind" value="new"><span><b>Nová paleta</b><small>zadat rozměry palety, která v databázi není</small>' +
      '<span class="pm-sub pm-grid"><input id="pmName" placeholder="Název (např. Paleta 200 × 100)"><input type="number" id="pmL" placeholder="Délka mm" min="1"><input type="number" id="pmW" placeholder="Šířka mm" min="1"><input type="number" id="pmH" placeholder="Výška mm" min="0"><input type="number" id="pmTare" placeholder="Vlastní váha kg" min="0" step="any"><input type="number" id="pmMax" placeholder="Nosnost kg (0 = ne)" min="0">' +
      '<label class="inline"><input type="checkbox" id="pmSave" checked> Zapamatovat – uložit mezi typy palet</label></span></span></label>' +
    (others ? '<label class="pm-opt"><input type="radio" name="pmKind" value="exist"><span><b>Na paletu v zakázce</b><small>přidat k už existující paletě</small><select id="pmExist" class="pm-sub">' + others + '</select></span></label>' : '') +
    '</div><div class="pm-acts"><button type="button" class="btn" data-pcancel="1">Zpět</button><button type="button" class="btn primary" data-pgo="' + i + '">Přesunout ' + esc(c.code) + '</button></div></div>';
  // two bars: pieces against "fits on pallet", load against the pallet max weight (when set)
  const bar = t.maxKg ? Math.max(0, kg - (t.tare || 0)) / t.maxKg : 0;
  const fillBar = (lab, f) => '<div class="pe-bar"><span>' + lab + ' ' + Math.round(f * 100) + ' %</span><div class="pe-fill' + (f > 1.001 ? ' over' : '') + '"><i style="width:' + Math.min(100, Math.round(f * 100)) + '%"></i></div></div>';
  $('#peBody').innerHTML =
    '<div class="pe-head"><input type="search" id="peType" list="palList2" value="' + esc(t.code ? t.code + ' · ' + t.name : '') + '" aria-label="Typ palety" style="flex:1 1 260px"><datalist id="palList2">' + state.pallets.map(p => '<option value="' + esc(palOption(p)) + '"></option>').join('') + '</datalist><button type="button" class="btn small" id="peTypeBtn">Změnit typ</button></div>' +
    '<p class="muted">' + cm(t.L) + ' × ' + cm(t.W) + ' cm · ' + Math.round(kg) + ' kg (tara ' + (t.tare || 0) + ' kg)' + (t.maxKg ? ' · nosnost ' + t.maxKg + ' kg' : '') + '</p>' +
    fillBar('Kusy', fill) + (t.maxKg ? fillBar('Váha', bar) : '') +
    (iss.length ? '<div class="pe-issues"><b>Problémy na paletě</b><ul>' + iss.map(x => '<li><b>' + esc(x.c.code) + '</b>: ' + esc(x.t) + '</li>').join('') + '</ul>' +
      (iss.some(x => x.fix) ? '<div class="pe-iss-acts"><button type="button" class="btn small primary" id="peConfirm">✓ Potvrdit množství</button><small class="muted">ověřené / max kusy se zvýší</small></div>' +
      (iss.some(x => x.fix && x.r && x.r.mode === 'group') ? '<div class="pe-iss-acts"><button type="button" class="btn small" id="peNoConfirm">✗ Nepotvrzovat množství</button><small class="muted">Max ks = ověřeno; kusy navíc se přepočítají (jiné balení, solo, jinak vpravo)</small></div>' : '') : '') + '</div>' : '') +
    // shown A→Z by article code; i stays the index in b.contents for the actions
    (b.contents.length ? b.contents.map((c, i) => [c, i]).sort((x, y) => String(x[0].code).localeCompare(String(y[0].code), 'cs', { numeric: true })).map(([c, i]) => '<div class="pe-row' + (iss.some(x => x.i === i) ? ' bad' : '') + '"><span><b>' + esc(c.code) + '</b><span class="muted">' + esc(c.name || '') + (c.ride ? ' · navrch' : '') + '</span></span><span>' + c.units + ' ks</span>' +
      (peCur.row === i ? '' : '<button type="button" class="btn small" data-po="' + i + '">Přesunout…</button>') + '</div>' + (peCur.row === i ? movePanel(c, i) : '')).join('')
      : '<p class="muted">Paleta je prázdná. Přetáhněte na ni materiál na ploše nebo ji smažte.</p>');
  $('#peDelete').hidden = false;
}
$('#peBody').addEventListener('click', e => {
  if (e.target.id === 'peNoConfirm') {
    const { id, pid } = peCur, b = state.plan.get(id).find(x => x.id === pid), done = [];
    palIssues(b).filter(x => x.fix && x.r && x.r.mode === 'group').forEach(x => { x.r.cap = x.r.per; done.push(x.c.code + ': max ' + x.r.per + ' ks v ' + x.r.group); });
    persist('combos'); drawCombos(); logChanges(id, done.map(t => 'Nepotvrzeno, ' + t));
    // back to the automatic calculation so the extra pieces are calculated again
    if (!peCur.wasPlan) { state.plan.delete(id); peCur.wasPlan = true; }
    else { const all = load('itab.plans.v1', {}); state.plan.delete(id); delete all[id]; save('itab.plans.v1', all); }
    $('#dlgPalEdit').close(); keepScroll(() => recalcOne()); flash('Nepotvrzeno: ' + done.join(', ') + ' – kusy navíc přepočítány.');
    return;
  }
  if (e.target.id === 'peConfirm') {
    const { id, pid } = peCur, b = state.plan.get(id).find(x => x.id === pid), done = [];
    palIssues(b).filter(x => x.fix && x.r).forEach(x => { Object.assign(x.r, x.fix); done.push(x.c.code + ' → ' + x.fix.per + ' ks'); });
    persist('combos'); drawCombos(); logChanges(id, done.map(t => 'Potvrzeno množství: ' + t));
    // nothing else changed on the pallets: back to the automatic calculation
    const P = state.plan.get(id);
    if (!peCur.wasPlan && JSON.stringify(P) === peCur.snap) { state.plan.delete(id); peCur.wasPlan = true; $('#dlgPalEdit').close(); }
    else drawPalEditor();
    keepScroll(() => recalcOne()); flash('Potvrzeno: ' + done.join(', '));
    return;
  }
  const po = e.target.getAttribute('data-po');
  if (po != null) { peCur.row = Number(po); drawPalEditor(); return; }
  if (e.target.getAttribute('data-pcancel')) { peCur.row = null; drawPalEditor(); return; }
  const go = e.target.getAttribute('data-pgo');
  if (go != null) {
    const { id, pid } = peCur, P = state.plan.get(id), b = P.find(x => x.id === pid), c = b.contents[Number(go)];
    const q = Math.max(1, Math.min(c.units, Math.round(toNum($('#pmQty').value) || c.units)));
    const kind = ($('#peBody input[name="pmKind"]:checked') || {}).value;
    let to = 'new', after = null;
    // an empty pallet of the wanted type that the operator already added is used first
    const emptyOf = pal => P.find(x => x !== b && x.pal === pal && !x.contents.some(k => k.units > 0));
    if (kind === 'exist') to = $('#pmExist').value;
    if (kind === 'same') { const e0 = emptyOf(b.pal); if (e0) to = e0.id; }
    if (kind === 'other') {
      const v = $('#pmOther').value.trim(), t = typeOf(state.pallets, v.split(' · ')[0].trim());
      if (!t) { flash('Vyberte typ palety z nabídky.'); $('#pmOther').focus(); return; }
      const e0 = emptyOf(t.code);
      if (e0) to = e0.id; else after = nid => setPalletType(P, nid, t.code);
    }
    if (kind === 'new') {
      const L = toNum($('#pmL').value), W = toNum($('#pmW').value);
      if (!(L > 0 && W > 0)) { flash('Zadejte délku a šířku nové palety.'); $('#pmL').focus(); return; }
      const nt = { name: $('#pmName').value.trim() || 'Paleta ' + Math.round(L / 10) + ' × ' + Math.round(W / 10), L, W, H: toNum($('#pmH').value) || 0, tare: toNum($('#pmTare').value) || 0, maxKg: toNum($('#pmMax').value) || 0, rot: true };
      if ($('#pmSave').checked) { nt.code = nextCode(state.pallets); state.pallets.push(nt); persist('pallets'); drawPallets(); drawCatalog(); after = nid => setPalletType(P, nid, nt.code); }
      else { nt.code = 'JINÁ'; after = nid => setPalletType(P, nid, 'JINÁ', nt); }
    }
    if (to !== 'new') {
      const tb = P.find(x => x.id === to), room = tb && sameSo(tb, c.so) ? roomFor(tb, c, state.pallets) : Infinity;
      if (room < q) {
        ask('Přes kapacitu palety?', (room > 0 ? 'Na cílovou paletu se vejde jen ' + room + ' ks ' + c.code + '.' : 'Cílová paleta je plná.') + ' Přesunout i tak všech ' + q + ' ks?', 'Přesunout vše').then(ok => { if (ok) doMove(); });
        return;
      }
    }
    doMove();
    function doMove() {
    const nid = moveUnits(P, pid, c.code, q, to);
    if (!nid) { flash(to !== 'new' && !sameSo(P.find(x => x.id === to) || { contents: [] }, c.so) ? 'Nelze: na cílové paletě je jiná zakázka.' : 'Přesun se nepovedl.'); return; }
    if (after) after(nid);
    peCur.row = null;
    state.manual.delete(id); keepScroll(() => recalcOne());
    flash('Přesunuto ' + q + ' ks ' + c.code + '.');
    drawPalEditor();
    }
    return;
  }
  if (e.target.id === 'peTypeBtn') {
    const v = $('#peType').value.trim(), code = v.split(' · ')[0].trim(), t = typeOf(state.pallets, code);
    if (!t) { flash('Vyberte typ palety z nabídky.'); return; }
    setPalletType(state.plan.get(peCur.id), peCur.pid, t.code); state.manual.delete(peCur.id); keepScroll(() => recalcOne()); drawPalEditor();
  }
});
// show the extra fields only for the chosen option
$('#peBody').addEventListener('change', e => {
  if (e.target.name !== 'pmKind') return;
  const f = { other: '#pmOther', new: '#pmL', exist: '#pmExist' }[e.target.value];
  if (f && $(f)) $(f).focus();
});
// delete a pallet: its pieces go back to the right side; optionally the article definition is deleted too
$('#peDelete').addEventListener('click', async () => {
  const { id, pid } = peCur, P = state.plan.get(id), b = P && P.find(x => x.id === pid); if (!b) return;
  const full = b.contents.filter(c => c.units > 0);
  if (!full.length) { removePallet(P, pid); state.manual.delete(id); $('#dlgPalEdit').close(); keepScroll(() => recalcOne()); return; }
  const codes = [...new Set(full.map(c => c.code))];
  const inCat = codes.filter(c => state.catalog.some(a => String(a.code).toLowerCase() === c.toLowerCase()));
  // the Způsob balení row that applies now (order's project, priority order) for each article
  const o = state.orders.get(id), proj = (view(id) || {}).project || '';
  const present = new Set(o ? [...o.lines.values()].map(l => l.code.toLowerCase()) : []);
  const qtyOf = c => o ? [...o.lines.values()].filter(l => l.code.toLowerCase() === c.toLowerCase()).reduce((t, l) => t + l.qty, 0) : 0;
  const rules = codes.map(c => findRules(c, qtyOf(c), present, state.combos).find(r => !r.project || String(r.project).toLowerCase() === proj.toLowerCase())).filter(Boolean);
  const label = r => r.mode === 'group' ? 'balení ' + (r.group || '') : r.mode === 'host' ? 'přibal na ' + r.host : r.mode === 'pallet' ? 'solo ' + (r.pal || '') : 'balík';
  const what = [rules.length ? 'aktuální způsob balení (' + rules.map(r => r.code + ': ' + label(r) + (r.project ? ' · ' + r.project : '')).join(', ') + ')' : '', inCat.length ? 'definici artiklu ' + inCat.join(', ') : ''].filter(Boolean).join(' a ');
  const ok = await ask('Smazat paletu?', 'Kusy (' + full.map(c => c.code + ' ' + c.units + ' ks').join(', ') + ') se vrátí vpravo mezi nezařazené.', 'Smazat paletu',
    what ? 'Smazat i ' + what + ' (pro všechny zakázky)' : '');
  if (!ok) return;
  P.splice(P.indexOf(b), 1);
  if (what && $('#askChk').checked) {
    const del = new Set(inCat.map(c => c.toLowerCase()));
    if (del.size) { state.catalog = state.catalog.filter(a => !del.has(String(a.code).toLowerCase())); persist('catalog'); drawCatalog(); }
    if (rules.length) { state.combos = state.combos.filter(r => !rules.includes(r)); persist('combos'); drawCombos(); }
    $('#dlgPalEdit').close(); state.manual.delete(id); recalc();
    flash('Paleta smazána, smazáno: ' + what + '.');
    return;
  }
  $('#dlgPalEdit').close(); state.manual.delete(id); keepScroll(() => recalcOne());
  flash('Paleta smazána, kusy jsou vpravo.');
});

function addBoardPallet(id, b) {
  const P = state.plan.get(id);
  if (P) { P.push(Object.assign({ id: newId(), contents: [] }, b)); state.manual.delete(id); keepScroll(() => recalcOne()); return; }
  const list = state.board.get(id) || [];
  list.push(Object.assign({ id: 'b' + Date.now().toString(36) + list.length, contents: [] }, b));
  state.board.set(id, list); state.manual.delete(id);
  keepScroll(() => recalcOne());
}
function askPallet(id) {
  const dlg = $('#dlgPallet');
  dlg.querySelector('form').reset();
  dlg.querySelector('form').onsubmit = ev => {
    if (!ev.submitter || ev.submitter.value !== 'yes') return;
    const t = { name: $('#dpName').value.trim() || 'Jiná paleta', L: toNum($('#dpL').value), W: toNum($('#dpW').value), H: toNum($('#dpH').value) || 0, tare: toNum($('#dpTare').value) || 0, maxKg: toNum($('#dpMax').value) || 0, rot: true };
    if ($('#dpSave').checked) {
      t.code = nextCode(state.pallets);
      state.pallets.push(t); persist('pallets'); drawPallets(); drawCatalog();
      addBoardPallet(id, { pal: t.code });
      flash('Uložena nová paleta ' + t.code + ' a přidána na plochu.');
    } else {
      t.code = 'JINÁ';
      addBoardPallet(id, { pal: 'JINÁ', custom: t });
      flash('Přidána jednorázová paleta (jen tato zakázka).');
    }
  };
  dlg.returnValue = ''; dlg.showModal(); $('#dpName').focus();
}
// one or more unknown articles onto a hand-made / plan pallet
function askMaterial(listU, bid) {
  const id = state.sel, P = state.plan.get(id), list = P || state.board.get(id) || [], b = list.find(x => x.id === bid); if (!b) return;
  const t = typeOf(state.pallets, b.pal) || b.custom || { code: b.pal, name: '' };
  const dlg = $('#dlgMaterial');
  $('#dmText').innerHTML = 'Na paletu <b>' + esc(t.code) + '</b> <span class="dlg-name">' + esc(t.name || '') + '</span>. Zaplnění se počítá podle „vejde se na paletu“.';
  $('#dmRows').innerHTML = '<div class="lr-h m"><span>Artikl</span><span>Na tuto paletu</span><span>Vejde se na paletu</span><span>Váha kusu, kg</span><span title="Skutečný rozměr artiklu; větší než paleta = paleta se prodlouží">Délka × šířka art., mm</span></div>' + listU.map((u, i) =>
    '<div class="lr m"><span><b>' + esc(u.code) + '</b><small>' + esc(u.name || '') + ' · ' + u.qty + ' ks</small></span>' +
    '<input type="number" min="1" max="' + u.qty + '" step="1" value="' + u.qty + '" data-mu="' + i + '" required><input type="number" min="1" step="1" value="' + u.qty + '" data-mp="' + i + '" required><input type="number" min="0" step="any" value="0" data-mk="' + i + '" required><span class="sz2"><input type="number" min="1" placeholder="D" data-ml="' + i + '" required><input type="number" min="1" placeholder="Š" data-mw="' + i + '" required></span></div>').join('');
  $('#dmSave').checked = true;
  $('#dmSaveText').textContent = 'Uložit do číselníku: ' + (listU.length > 1 ? 'artikly jedou' : listU[0].code + ' jede') + ' na ' + t.code + ' (kusů na paletu = „vejde se na paletu“)';
  dlg.querySelector('form').onsubmit = ev => {
    if (!ev.submitter || ev.submitter.value !== 'yes') return;
    const save = $('#dmSave').checked;
    if (save && b.custom) {
      // a one-off pallet becomes a saved type first, so the articles can point to it
      const nt = Object.assign({}, b.custom, { code: nextCode(state.pallets) });
      state.pallets.push(nt); persist('pallets'); b.pal = nt.code; delete b.custom; t.code = nt.code;
    }
    listU.forEach((u, i) => {
      const units = Math.min(u.qty, Math.max(1, Math.round(toNum($('#dmRows [data-mu="' + i + '"]').value))));
      const per = Math.max(1, Math.round(toNum($('#dmRows [data-mp="' + i + '"]').value))), kg = toNum($('#dmRows [data-mk="' + i + '"]').value) || 0;
      if (save) { const ex = state.catalog.find(c => String(c.code).toLowerCase() === u.code.toLowerCase()), na = { code: u.code, name: u.name || '', pack: 'paleta', pal: t.code, per, kg, rot: true }; const al = toNum($('#dmRows [data-ml="' + i + '"]').value), aw = toNum($('#dmRows [data-mw="' + i + '"]').value); if (al > 0) na.aL = al; if (aw > 0) na.aW = aw; if (ex) Object.assign(ex, na, { name: ex.name || na.name, kg: kg || ex.kg || 0 }); else state.catalog.push(na); }
      // without a plan the catalog makes the pallets itself; with a plan (or without saving) the pieces go on this pallet
      if (P || !save) b.contents.push({ code: u.code, name: u.name || '', units, per, kg, so: u.so });
    });
    if (save) { persist('catalog'); drawCatalog(); drawPallets(); if (!P && !b.contents.length) state.board.set(id, list.filter(x => x !== b)); }
    flash((save ? 'Uloženo do číselníku a položeno: ' : 'Položeno jen pro tuto zakázku: ') + listU.map(u => u.code).join(', ') + ' → ' + t.code + '.');
    clearSel(); state.manual.delete(id); if (save) recalc(); else recalcOne();
  };
  dlg.returnValue = ''; dlg.showModal();
  $('#dmRows input').focus();
}
// several new articles: one form after another
function askArticles(list) {
  if (!list.length) return;
  askArticle(list[0], () => askArticles(list.slice(1)), list.length);
}
function askArticle(u, next, left) {
  const dlg = $('#dlgArticle');
  $('#daTitle').textContent = 'Nový artikl ' + u.code + (left > 1 ? ' (ještě ' + (left - 1) + ')' : '');
  $('#daForm').reset();
  // names come from the order (ERP / designers) and are not edited here
  $('#daName').value = u.name || ''; $('#daName').readOnly = !!u.name;
  $('#daPalList').innerHTML = state.pallets.map(t => '<option value="' + esc(palOption(t)) + '"></option>').join('');
  $('#daPal').value = '';
  $('#daPack').value = state.pallets.length ? 'list' : 'new'; daSections();
  // default: the whole quantity of the order fits on one pallet / parcel
  $('#daPer').value = Math.max(1, u.qty || 1);
  // act on the button press itself; the dialog's close event is not reliable in every browser
  dlg.querySelector('form').onsubmit = ev => {
    if (!ev.submitter || ev.submitter.value !== 'yes') return;
    const mode = $('#daPack').value, per = Math.max(1, Math.round(toNum($('#daPer').value))), kg = toNum($('#daKg').value) || 0, rot = $('#daRot').checked;
    const a = { code: u.code, name: $('#daName').value.trim(), pack: mode === 'balik' ? 'balik' : mode === 'sluzba' || mode === 'kit' ? mode : 'paleta', per, kg, rot };
    if (mode === 'sluzba' || mode === 'kit') Object.assign(a, { per: 0, kg: 0 });
    else if (mode === 'balik') Object.assign(a, { pl: toNum($('#daL').value), pw: toNum($('#daW').value) });
    if (mode === 'list' || mode === 'new') { const al = toNum($('#daAL').value), aw = toNum($('#daAW').value); if (al > 0) a.aL = al; if (aw > 0) a.aW = aw; }
    if (mode === 'sluzba' || mode === 'kit' || mode === 'balik') {}
    else if (mode === 'list') {
      const v = $('#daPal').value.trim(), t = typeOf(state.pallets, v.split(' · ')[0].trim()) || state.pallets.find(p => palOption(p).toLowerCase() === v.toLowerCase());
      if (!t) { ev.preventDefault(); flash('Vyberte typ palety z nabídky (začněte psát kód, název nebo rozměr).'); $('#daPal').focus(); return; }
      a.pal = t.code;
    }
    else {
      const code = $('#daPCode').value.trim().toUpperCase();
      if (typeOf(state.pallets, code)) { ev.preventDefault(); flash('Kód palety ' + code + ' už existuje – vyberte ho ze seznamu nebo zadejte jiný.'); return; }
      const L = toNum($('#daPL').value), W = toNum($('#daPW').value);
      state.pallets.push({ code, name: $('#daPName').value.trim() || 'Paleta ' + Math.round(L / 10) + ' × ' + Math.round(W / 10), L, W, H: 0, tare: toNum($('#daPTare').value) || 0, maxKg: 0, rot });
      persist('pallets'); drawPallets(); a.pal = code;
    }
    // an article known only from a balení (balení neurčeno) gets its packing now instead of a second entry
    const ex = state.catalog.find(c => String(c.code).toLowerCase() === u.code.toLowerCase());
    if (ex) { delete ex.pl; delete ex.pw; delete ex.pal; Object.assign(ex, a, { name: ex.name || a.name, kg: a.kg || ex.kg || 0 }); }
    else state.catalog.push(a);
    // pallets edited by hand: the catalog does not change them, so the new article gets its own pallets in the plan
    const P = state.plan.get(state.sel);
    if (P && a.pack !== 'balik') {
      let left = u.qty;
      while (left > 0) { const n = Math.min(left, a.per); P.push({ id: newId(), pal: a.pal, contents: [{ code: a.code, name: a.name, units: n, per: a.per, kg: a.kg, so: u.so }] }); left -= n; }
    }
    persist('catalog'); drawCatalog(); relearn();
    flash('Artikl ' + u.code + ' uložen do číselníku.');
    clearSel();
    if (next) setTimeout(next, 50);
  };
  dlg.returnValue = ''; dlg.showModal();
  (u.name ? $('#daL') : $('#daName')).focus();
}
$('#dcRemember').addEventListener('change', e => { $('#dcRule').hidden = !e.target.checked; });
// show only the fields of the chosen packing; hidden fields are disabled so they are not validated
function daSections() {
  const m = $('#daPack').value;
  document.querySelectorAll('#dlgArticle [data-sec]').forEach(el => { const on = el.dataset.sec === m; el.hidden = !on; el.querySelectorAll('input,select').forEach(i => { i.disabled = !on; }); });
  $('#daPerLabel').textContent = m === 'balik' ? 'Kusů v balíku' : 'Kusů na paletě';
  // a service is not transported: no packing, pieces or weight
  const none = m === 'sluzba' || m === 'kit';
  $('#daQtyRow').hidden = none; $('#daQtyRow').querySelectorAll('input').forEach(i => { i.disabled = none; });
  $('#daRot').closest('label').hidden = none;
  const sz = m === 'list' || m === 'new';
  $('#daSizeRow').hidden = !sz; $('#daSizeRow').querySelectorAll('input').forEach(i => { i.disabled = !sz; });
}
$('#daPack').addEventListener('change', daSections);
onBoth('pointercancel', e => endDrag(e, true));
// right click, Alt+Tab, switching tabs or a lost pointer during a drag: cancel it, nothing stays in the air
['blur', 'contextmenu'].forEach(ev => window.addEventListener(ev, () => endDrag(null, true)));
document.addEventListener('visibilitychange', () => { if (document.hidden) endDrag(null, true); });
document.addEventListener('lostpointercapture', () => { if (drag && drag.moved) endDrag(null, true); }, true);
document.addEventListener('pointerdown', e => { if (drag && e.button !== 0) endDrag(null, true); }, true);

// ---------- packing list ----------
onBoth('click', e => {
  if (e.target.id !== 'packBtn') return;
  const r = view(state.sel); if (!r) return;
  const names = new Map(state.catalog.map(a => [String(a.code).toLowerCase(), a.name || '']));
  state.orders.get(r.id).lines.forEach(l => { if (l.name && !names.get(l.code.toLowerCase())) names.set(l.code.toLowerCase(), l.name); });
  const w = window.open('', '_blank');
  if (!w) { flash('Prohlížeč zablokoval nové okno. Povolte vyskakovací okna pro tento web.'); return; }
  w.document.write(packListHtml(r, names)); w.document.close();
  w.focus(); setTimeout(() => w.print(), 300);
});

onBoth('click', e => {
  if (e.target.id !== 'loadPrintBtn') return;
  const r = view(state.sel); if (!r) return;
  const w = window.open('', '_blank');
  if (!w) { flash('Prohlížeč zablokoval nové okno. Povolte vyskakovací okna pro tento web.'); return; }
  w.document.write(loadPlanHtml(r, state.vehicles)); w.document.close();
  w.focus(); setTimeout(() => w.print(), 300);
});

// ---------- Ringil ----------
onBoth('click', e => {
  if (e.target.id !== 'ringilBtn') return;
  const r = view(state.sel); if (!r) return;
  $('#drTitle').textContent = 'Údaje pro Ringil – zakázka ' + r.id;
  $('#drBody').innerHTML = ringilHtml(r);
  $('#drOrdered').textContent = state.ordered.has(r.id) ? 'Zrušit „doprava objednána“' : 'Označit: doprava objednána';
  $('#dlgRingil').showModal();
});
$('#drOrdered').addEventListener('click', () => {
  const id = state.sel;
  if (state.ordered.has(id)) state.ordered.delete(id); else state.ordered.add(id);
  save('itab.ordered.v1', [...state.ordered]);
  $('#dlgRingil').close(); renderOverview();
  flash(state.ordered.has(id) ? 'Zakázka ' + id + ': doprava objednána.' : 'Stav „objednáno“ zrušen.');
});
$('#drBody').addEventListener('click', e => {
  const b = e.target.closest('.rg-copy'); if (!b) return;
  const v = b.getAttribute('data-copy');
  const ok = () => { b.textContent = '✓ Zkopírováno'; b.classList.add('done'); b.closest('.rg-row').classList.add('copied'); };
  try { navigator.clipboard.writeText(v).then(ok, () => flash('Kopírování se nepodařilo, označte hodnotu ručně.')); } catch (x) { flash('Kopírování se nepodařilo.'); }
});
onBoth('click', e => {
  if (e.target.id !== 'copyBtn') return;
  const r = view(state.sel); if (!r) return;
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
function bindTable(body, list, name, rerender) {
  body.addEventListener('input', e => {
    const t = e.target, i = t.getAttribute('data-i'), f = t.getAttribute('data-f');
    if (i == null || t.type === 'checkbox' || t.tagName === 'SELECT') return;
    list()[i][f] = cellValue(t); persist(name); later();
  });
  body.addEventListener('change', e => {
    const t = e.target, i = t.getAttribute('data-i'), f = t.getAttribute('data-f');
    if (i == null || !(t.type === 'checkbox' || t.tagName === 'SELECT')) return;
    list()[i][f] = cellValue(t); persist(name); later();
  });
  body.addEventListener('click', e => {
    const i = e.target.getAttribute('data-del'); if (i == null) return;
    list().splice(Number(i), 1); persist(name); rerender(); recalc();
  });
}

// ---------- catalog ----------
const drawCatalog = () => renderCatalog(state.catalog, state.catView, state.pallets, state.combos);
bindTable($('#catBody'), () => state.catalog, 'catalog', drawCatalog);
$('#catBody').addEventListener('change', e => {
  if (e.target.getAttribute('data-f') !== 'pack') return;
  const a = state.catalog[e.target.getAttribute('data-i')];
  if (a.pack === 'balik' && !(a.pl > 0)) { a.pl = 400; a.pw = 300; }
  if (a.pack !== 'balik' && !a.pal && state.pallets[0]) a.pal = state.pallets[0].code;
  persist('catalog'); drawCatalog();
});
$('#catSearch').addEventListener('input', e => { state.catView.q = e.target.value; state.catView.page = 0; drawCatalog(); });
$('#catPager').addEventListener('click', e => { const p = e.target.getAttribute('data-page'); if (p == null) return; state.catView.page = Number(p); drawCatalog(); });
$('#catAdd').addEventListener('click', () => {
  state.catalog.unshift({ code: 'NOVY-' + (state.catalog.length + 1), name: '', pack: 'paleta', pl: 1200, pw: 800, per: 1, kg: 0, rot: true });
  state.catView = { q: '', page: 0 }; $('#catSearch').value = '';
  persist('catalog'); drawCatalog(); recalc();
});
$('#catReset').addEventListener('click', async () => {
  if (!await ask('Vrátit ukázku?', 'Číselník se vrátí na ukázková data. Nahrané artikly se smažou.', 'Vrátit')) return;
  state.catalog = clone(DEFAULT_CATALOG); persist('catalog'); drawCatalog(); recalc(); $('#catReport').innerHTML = '';
});
$('#catExport').addEventListener('click', () => download('ciselnik-artiklu.csv',
  [['artikl', 'nazev', 'druh', 'vaha_kusu_kg', 'delka_artiklu_mm', 'sirka_artiklu_mm', 'lze_otacet']]
    .concat(state.catalog.map(a => [a.code, a.name, a.pack === 'sluzba' || a.pack === 'kit' ? a.pack : 'zbozi', String(a.kg || 0).replace('.', ','), a.aL || '', a.aW || '', a.rot ? 'ano' : 'ne']))));
// full check of the catalog: every problem that would make an order wrong
function catalogProblems() {
  const out = [], seen = new Map();
  state.catalog.forEach(a => {
    const k = String(a.code).trim().toLowerCase(), p = [];
    if (seen.has(k)) p.push('je v číselníku víckrát'); seen.set(k, 1);
    if (a.pack === 'sluzba' || a.pack === 'kit') { if (p.length) out.push('<li><b>' + esc(a.code) + '</b>: ' + p.join(', ') + '</li>'); return; }
    // packing lives in Způsob balení: a problem only when no rule there mentions the article (as article or main item)
    if (!state.combos.some(r => r.on !== false && (String(r.code).toLowerCase() === k || (r.mode === 'host' && String(r.host).toLowerCase() === k)))) p.push('není v žádném způsobu balení');
    if (!(a.kg > 0)) p.push('váha kusu je 0');
    if (!a.name) p.push('bez názvu');
    if (p.length) out.push('<li><b>' + esc(a.code) + '</b>: ' + p.join(', ') + '</li>');
  });
  return out;
}
$('#catCheck').addEventListener('click', () => {
  const pr = catalogProblems();
  $('#catReport').innerHTML = pr.length
    ? '<div class="problems"><b>Kontrola: ' + pr.length + ' ' + (pr.length === 1 ? 'artikl má' : pr.length <= 4 ? 'artikly mají' : 'artiklů má') + ' problém</b> (z ' + state.catalog.length + ')<ul>' + pr.slice(0, 200).join('') + '</ul>' + (pr.length > 200 ? '<p>… a dalších ' + (pr.length - 200) + '</p>' : '') + '</div>'
    : '<p class="ok">Kontrola: všech ' + state.catalog.length + ' artiklů je v pořádku ✓</p>';
});
$('#catFile').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const { rows } = await readFileRows(f), res = rowsToCatalog(rows), replace = $('#catReplace').checked;
    let merged = null;
    if (res.items.length) {
      // new article: defaults (zboží, weight 0, can turn); existing one: only the columns the file has, the ERP name stays
      const full = x => Object.assign({ name: '', pack: 'neurceno', per: 0, kg: 0, rot: true }, x);
      if (replace) merged = { list: res.items.map(full) };
      else {
        const list = state.catalog.slice(), idx = new Map(list.map((a, i) => [String(a.code).trim().toLowerCase(), i]));
        let added = 0, updated = 0;
        res.items.forEach(x => { const k = String(x.code).trim().toLowerCase();
          if (idx.has(k)) { const o = list[idx.get(k)]; list[idx.get(k)] = Object.assign({}, o, x, o.name ? { name: o.name } : {}); updated++; }
          else { idx.set(k, list.length); list.push(full(x)); added++; } });
        merged = { list, added, updated };
      }
      const m = migrateCatalog(merged.list, state.pallets);
      state.catalog = m.catalog; if (m.types.length !== state.pallets.length) { state.pallets = m.types; persist('pallets'); drawPallets(); }
      persist('catalog'); drawCatalog(); recalc();
    }
    // pallet codes that do not exist are reported right away
    const unknownPal = res.items.filter(a => a.pack !== 'balik' && a.pal && !typeOf(state.pallets, a.pal));
    if (unknownPal.length) res.errors.push(...unknownPal.map(a => a.code + ': typ palety ' + a.pal + ' neexistuje – doplňte ho na záložce Palety.'));
    importReport($('#catReport'), res, merged, replace);
  } catch (err) { $('#catReport').innerHTML = '<p class="problems">' + err.message + '</p>'; }
});

// ---------- pallet types ----------
const drawPallets = () => renderPallets(state.pallets, state.catalog, $('#palSearch').value);
$('#palSearch').addEventListener('input', drawPallets);
// renaming a pallet code: unique, and every article, rule and open plan follows the new code
$('#palBody').addEventListener('change', e => {
  const i = e.target.getAttribute('data-pcode'); if (i == null) return;
  const p = state.pallets[Number(i)], old = p.code, nu = e.target.value.trim().toUpperCase();
  if (!nu || nu === old) { e.target.value = old; return; }
  if (state.pallets.some(x => x !== p && x.code.toLowerCase() === nu.toLowerCase())) { flash('Kód ' + nu + ' už má jiná paleta.'); e.target.value = old; return; }
  p.code = nu;
  let n = 0;
  state.catalog.forEach(a => { if (a.pal === old) { a.pal = nu; n++; } });
  state.combos.forEach(r => { if (r.pal === old) r.pal = nu; });
  state.plan.forEach(P => P.forEach(b => { if (b.pal === old) b.pal = nu; }));
  state.board.forEach(L => L.forEach(b => { if (b.pal === old) b.pal = nu; }));
  persist('pallets'); if (n) persist('catalog'); persist('combos');
  drawPallets(); drawCatalog(); drawCombos(); recalc();
  flash('Kód změněn: ' + old + ' → ' + nu + (n ? ' (' + n + ' ' + (n === 1 ? 'artikl' : 'artiklů') + ' upraveno)' : '') + '.');
});
bindTable($('#palBody'), () => state.pallets, 'pallets', drawPallets);
$('#palBody').addEventListener('input', () => drawCatalogLater());
let catTimer = null;
function drawCatalogLater() { clearTimeout(catTimer); catTimer = setTimeout(drawCatalog, 400); }
$('#palAdd').addEventListener('click', () => {
  state.pallets.push({ code: nextCode(state.pallets), name: 'Nová paleta', L: 1200, W: 800, H: 144, tare: 25, maxKg: 0, rot: true });
  persist('pallets'); drawPallets(); drawCatalog();
});
$('#palExport').addEventListener('click', () => download('palety.csv',
  [['kod', 'nazev', 'delka_mm', 'sirka_mm', 'vyska_mm', 'vlastni_vaha_kg', 'max_zatizeni_kg', 'lze_otacet']]
    .concat(state.pallets.map(p => [p.code, p.name, p.L, p.W, p.H || '', String(p.tare || 0).replace('.', ','), p.maxKg || '', p.rot !== false ? 'ano' : 'ne']))));
$('#palFile').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const { rows } = await readFileRows(f), res = rowsToPallets(rows);
    let merged = null;
    if (res.items.length) {
      res.items.forEach(p => { if (!p.code) p.code = nextCode(state.pallets.concat(res.items.filter(x => x.code))); });
      merged = mergeBy(state.pallets, res.items, p => p.code.toLowerCase());
      state.pallets = merged.list; persist('pallets'); drawPallets(); drawCatalog(); recalc();
    }
    importReport($('#palReport'), res, merged, false);
  } catch (err) { $('#palReport').innerHTML = '<p class="problems">' + err.message + '</p>'; }
});

// ---------- vehicles ----------
// search in a settings table: rows whose text or field values do not contain the query are hidden
function filterTable(body, q) {
  q = (q || '').trim().toLowerCase();
  [...body.rows].forEach(tr => {
    const txt = (tr.textContent + ' ' + [...tr.querySelectorAll('input,select')].map(x => x.tagName === 'SELECT' ? (x.selectedOptions[0] || {}).text || '' : x.value).join(' ')).toLowerCase();
    tr.hidden = !!q && txt.indexOf(q) < 0;
  });
}
const drawVehicles = () => { renderVehicles(state.vehicles); filterTable($('#vehBody'), $('#vehSearch').value); };
$('#vehSearch').addEventListener('input', e => filterTable($('#vehBody'), e.target.value));
bindTable($('#vehBody'), () => state.vehicles, 'vehicles', drawVehicles);
$('#vehAdd').addEventListener('click', () => {
  state.vehicles.push({ name: 'Nové vozidlo', type: 'jine', L: 4, W: 2, kg: 1000, eup: 0, lift: false, cost: 0.5 });
  persist('vehicles'); drawVehicles(); recalc();
});
$('#vehReset').addEventListener('click', async () => {
  if (!await ask('Vrátit výchozí vozidla?', 'Seznam vozidel se vrátí na výchozí hodnoty.', 'Vrátit')) return;
  state.vehicles = clone(DEFAULT_VEHICLES); persist('vehicles'); drawVehicles(); recalc(); $('#vehReport').innerHTML = '';
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
      state.vehicles = merged.list; persist('vehicles'); drawVehicles(); recalc();
    }
    importReport($('#vehReport'), res, merged, replace);
  } catch (err) { $('#vehReport').innerHTML = '<p class="problems">' + err.message + '</p>'; }
});

// ---------- combos ----------
const drawCombos = () => {
  state.combos.forEach(r => { if (!comboSnap.has(r)) comboSnap.set(r, comboKey(r)); });
  renderCombos(state.combos, state.catalog, state.pallets, projNames()); filterTable($('#comboBody'), $('#comboSearch').value); whoFilter();
};
// filter by who / which day; "Smazat změny výběru" removes those rows
function whoFilter() {
  const sel = $('#comboBy'), by = sel.value, day = $('#comboDay').value;
  const users = [...new Set(state.combos.map(r => r.by).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">všichni</option>' + users.map(u => '<option' + (u === by ? ' selected' : '') + '>' + esc(u) + '</option>').join('');
  let n = 0;
  $('#comboBody').querySelectorAll('tr[data-by]').forEach(tr => { const ok = (!by || tr.dataset.by === by) && (!day || tr.dataset.day === day); if (!ok) tr.hidden = true; else if (!tr.hidden) n++; });
  $('#comboWhoN').textContent = by || day ? n + ' řádků' : '';
  $('#comboUndo').disabled = !(by && day && n);
}
$('#comboBy').addEventListener('change', whoFilter);
$('#comboDay').addEventListener('change', drawCombos);
$('#comboBy').addEventListener('change', drawCombos);
$('#comboUndo').addEventListener('click', () => {
  const by = $('#comboBy').value, day = $('#comboDay').value;
  const del = state.combos.filter(r => r.by === by && String(r.at || '').slice(0, 10) === day);
  if (!del.length || !confirm('Smazat ' + del.length + ' řádků, které ' + by + ' uložil(a) ' + day.split('-').reverse().join('.') + '? Upravené řádky se smažou celé (předchozí verze se nevrací).')) return;
  state.combos = state.combos.filter(r => !del.includes(r));
  persist('combos'); drawCombos(); recalc(); flash('Smazáno ' + del.length + ' řádků.');
});
$('#comboSearch').addEventListener('input', e => filterTable($('#comboBody'), e.target.value));
// lazy pallet list in the Způsob balení table: filled the first time the select is used
$('#comboBody').addEventListener('focusin', e => {
  const sel = e.target.closest('select[data-lazy]'); if (!sel || sel.dataset.filled) return;
  const cur = sel.value, first = sel.dataset.lazy === 'm' ? 'Paleta hlavní položky' : sel.dataset.lazy === 'g' ? '– typ palety –' : 'rozměr vpravo';
  sel.innerHTML = (sel.dataset.mix && !cur ? '<option value="-" selected disabled>– vyberte paletu –</option>' : '') + '<option value="">' + first + '</option>' + state.pallets.map(p => '<option value="' + esc(p.code) + '"' + (p.code === cur ? ' selected' : '') + '>' + esc(p.code) + ' · ' + esc(p.name) + '</option>').join('');
  sel.dataset.filled = '1';
});
bindTable($('#comboBody'), () => state.combos, 'combos', drawCombos);
$('#comboBody').addEventListener('change', e => {
  const f = e.target.getAttribute('data-f'), r = state.combos[e.target.getAttribute('data-i')];
  // type of packaging → mode (+ strict for a main item); a main item row keeps withCode = host
  // pallet choice: "pallet of the main item" = type 1, a pallet from the list = mix (type 2)
  if (f === 'palkind' && r) { const v = r.palkind; delete r.palkind; if (v) r.pal = v; r.kind = v ? 'mix' : 'main'; }
  if ((f === 'kind' || f === 'palkind') && r) {
    const k = r.kind; delete r.kind;
    r.mode = k === 'main' ? 'host' : k === 'mix' ? 'group' : k === 'solo' ? 'pallet' : 'parcel'; r.strict = k === 'main';
    if (k === 'main') { r.withCode = r.host || r.withCode || ''; if (!r.koli) r.koli = nextKoloCode(state.combos); }
    if (k === 'mix' && !r.group) r.group = nextKoloCode(state.combos);
    persist('combos'); recalc();
  }
  if (f === 'kind' || f === 'palkind' || f === 'pal' || f === 'mode' || f === 'on') { if (f === 'pal') recalc(); drawCombos(); }
});
$('#comboBody').addEventListener('click', e => {
  const i = e.target.getAttribute('data-clrper'); if (i == null) return;
  e.preventDefault(); state.combos[i].per = 0; persist('combos'); drawCombos(); recalc();
});
$('#comboBody').addEventListener('input', e => {
  const r = state.combos[e.target.getAttribute('data-i')];
  if (r && e.target.getAttribute('data-f') === 'host' && r.mode === 'host') { r.strict = true; r.withCode = r.host; persist('combos'); }
});
$('#comboBody').addEventListener('click', e => {
  const up = e.target.getAttribute('data-up'), down = e.target.getAttribute('data-down');
  if (up == null && down == null) return;
  const i = Number(up != null ? up : down), j = up != null ? i - 1 : i + 1;
  if (j < 0 || j >= state.combos.length) return;
  [state.combos[i], state.combos[j]] = [state.combos[j], state.combos[i]];
  persist('combos'); drawCombos(); recalc();
});
$('#comboAdd').addEventListener('click', () => {
  // new rule on top (the order of rows matters only between rules of the same type and project)
  state.combos.unshift({ on: true, code: '', withCode: '', min: 0, max: 0, mode: 'group', group: nextKoloCode(state.combos), pal: '', host: '', pl: 0, pw: 0, per: 0, note: '' });
  persist('combos'); drawCombos();
  const f = $('#comboBody input[data-f="code"]'); if (f) { f.scrollIntoView({ block: 'center' }); f.focus(); }
});
const MODE_NAMES = { host: 'na palete artiklu', pallet: 'na jine palete', group: 'na spolecne palete', parcel: 'jako balik' };
$('#comboExport').addEventListener('click', () => download('zpusob-baleni.csv',
  [['aktivni', 'artikl', 'kdyz_je_v_zakazce', 'mnozstvi_od', 'mnozstvi_do', 'pojede', 'cil', 'delka_mm', 'sirka_mm', 'max_ks_na_paletu', 'vaha_kusu_kg', 'poznamka', 'typ_palety', 'spolecna_paleta']]
    .concat(state.combos.map(r => [r.on !== false ? 'ano' : 'ne', r.code, r.withCode, r.min || '', r.max || '', MODE_NAMES[r.mode], r.host, r.pl || '', r.pw || '', r.per || '', r.kg ? String(r.kg).replace('.', ',') : '', r.note, r.pal || '', r.group || '']))));
$('#comboFile').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const { rows } = await readFileRows(f), res = rowsToCombos(rows), replace = $('#comboReplace').checked;
    let merged = null;
    if (res.items.length) {
      merged = replace ? { list: res.items } : { list: state.combos.concat(res.items), added: res.items.length, updated: 0 };
      state.combos = merged.list; persist('combos'); drawCombos(); recalc();
    }
    importReport($('#comboReport'), res, merged, replace);
  } catch (err) { $('#comboReport').innerHTML = '<p class="problems">' + err.message + '</p>'; }
});

// ---------- rules ----------
$('#rulesGrid').addEventListener('input', e => {
  const k = e.target.getAttribute('data-r'); if (!k) return;
  if (e.target.type === 'checkbox') { state.rules[k] = e.target.checked; persist('rules'); later(); return; }
  const v = toNum(e.target.value); if (!(v > 0)) return;
  state.rules[k] = v; persist('rules'); later();
});

// ---------- theme ----------
const darkMq = window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme(pref) {
  const t = pref === 'system' ? (darkMq.matches ? 'dark' : 'light') : pref;
  document.documentElement.setAttribute('data-theme', t);
  document.querySelectorAll('[data-theme-set]').forEach(b => b.setAttribute('aria-checked', b.getAttribute('data-theme-set') === pref ? 'true' : 'false'));
}
let themePref = 'light';
try { themePref = localStorage.getItem('itab.theme') || 'light'; } catch (e) { /* blocked storage */ }
applyTheme(themePref);
document.querySelector('.themes').addEventListener('click', e => {
  const b = e.target.closest('[data-theme-set]'); if (!b) return;
  themePref = b.getAttribute('data-theme-set');
  try { localStorage.setItem('itab.theme', themePref); } catch (x) { /* blocked storage */ }
  applyTheme(themePref);
});
darkMq.addEventListener('change', () => { if (themePref === 'system') applyTheme('system'); });

// ---------- account and roles ----------
$('#who').textContent = (me.user.email || '') + (isAdmin ? ' · admin' : '');
$('#logoutBtn').addEventListener('click', signOut);
$('#passBtn').addEventListener('click', async () => {
  const p = prompt('Nové heslo (aspoň 8 znaků):');
  if (!p) return;
  if (p.length < 8) { alert('Heslo musí mít aspoň 8 znaků.'); return; }
  const err = await changePassword(p);
  alert(err ? 'Heslo se nezměnilo: ' + err : 'Heslo změněno.');
});
if (!isAdmin) {
  ['catalog', 'pallets', 'combos', 'projects', 'vehicles', 'rules', 'users'].forEach(v => { $('#tab-' + v).hidden = true; });
}
async function drawUsers() {
  const body = $('#userBody');
  try {
    const list = await listProfiles();
    body.innerHTML = list.map(u => '<tr><td>' + esc(u.email || '') + '</td><td><select data-uid="' + u.id + '"' + (u.id === me.user.id ? ' disabled title="Svou roli změnit nelze"' : '') + '>' +
      '<option value="user"' + (u.role === 'user' ? ' selected' : '') + '>uživatel (jen výpočet)</option>' +
      '<option value="admin"' + (u.role === 'admin' ? ' selected' : '') + '>administrátor (vše)</option></select></td><td>' +
      new Date(u.created_at).toLocaleDateString('cs-CZ') + '</td><td class="nowrap">' +
      '<button class="btn small" data-pass="' + u.id + '">Nové heslo</button> ' +
      (u.id === me.user.id ? '' : '<button class="btn small" data-deluser="' + u.id + '" data-email="' + esc(u.email || '') + '">Smazat</button>') + '</td></tr>').join('');
  } catch (e) { body.innerHTML = '<tr><td colspan="4" class="problems">' + esc(e.message) + '</td></tr>'; }
}
if (isAdmin) {
  $('#tab-users').addEventListener('click', drawUsers);
  const report = (err, ok) => { $('#userReport').innerHTML = err ? '<p class="problems">' + esc(err) + '</p>' : '<p class="ok-line">' + ok + '</p>'; };
  $('#userAdd').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('#uaBtn'); btn.disabled = true;
    const email = $('#uaEmail').value.trim();
    const err = await adminUsers({ action: 'create', email, password: $('#uaPass').value, role: $('#uaRole').value });
    btn.disabled = false;
    report(err, 'Uživatel ' + esc(email) + ' přidán. Může se hned přihlásit.');
    if (!err) { $('#userAdd').reset(); drawUsers(); }
  });
  $('#userBody').addEventListener('click', async e => {
    const pid = e.target.getAttribute('data-pass'), did = e.target.getAttribute('data-deluser');
    if (pid) {
      const p = prompt('Nové heslo pro uživatele (aspoň 8 znaků):');
      if (!p) return;
      report(await adminUsers({ action: 'password', id: pid, password: p }), 'Heslo změněno.');
    }
    if (did) {
      if (!confirm('Smazat uživatele ' + e.target.getAttribute('data-email') + '? Nepůjde to vrátit.')) return;
      const err = await adminUsers({ action: 'delete', id: did });
      report(err, 'Uživatel smazán.');
      if (!err) drawUsers();
    }
  });
  $('#userBody').addEventListener('change', async e => {
    const id = e.target.getAttribute('data-uid'); if (!id) return;
    const err = await setRole(id, e.target.value);
    $('#userReport').innerHTML = err ? '<p class="problems">' + esc(err) + '</p>' : '<p class="ok-line">Role uložena.</p>';
    if (err) drawUsers();
  });
}

// ---------- start ----------
const td = new Date().toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
$('#today').textContent = td.charAt(0).toUpperCase() + td.slice(1);
$('#csv').value = state.csv;
drawCatalog(); drawPallets(); drawVehicles(); drawCombos(); renderRules(state.rules);
drawLog();
importOrders(load(KEYS.list, null) || state.csv, false, true);
