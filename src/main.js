import { clone, toNum } from './core/util.js';
import { DEFAULT_CATALOG, DEFAULT_VEHICLES, DEFAULT_RULES, DEFAULT_COMBOS, DEFAULT_PALLETS, SAMPLE } from './core/defaults.js';
import { migrateCatalog, nextCode, typeOf } from './core/palletTypes.js';
import { freezePlan, moveUnits, setPalletType, removePallet, newId, mergePallets, sameSo } from './core/plan.js';
import { parseOrders, rowsToOrderText, ordersToText } from './core/parse.js';
import { solve } from './core/solve.js';
import { fromResult, viewOf, movePallet, rotatePallet, addVehicle, removeVehicle, replaceVehicle, DEPOT } from './core/manual.js';
import { readFileRows, isSpreadsheet, rowsToCatalog, rowsToVehicles, rowsToCombos, rowsToPallets, mergeBy, toCsv } from './io/importTable.js';
import { renderKpis, renderPriorities, renderList, renderDetail, renderDock, requestText, loadPlanHtml, palOption, setNameLookup } from './ui/orders.js';
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
  catalog: Array.isArray(shared.catalog) && shared.catalog.length ? shared.catalog : clone(DEFAULT_CATALOG),
  vehicles: Array.isArray(shared.vehicles) && shared.vehicles.length ? shared.vehicles : clone(DEFAULT_VEHICLES),
  combos: Array.isArray(shared.combos) ? shared.combos : clone(DEFAULT_COMBOS),
  pallets: Array.isArray(shared.pallets) && shared.pallets.length ? shared.pallets : clone(DEFAULT_PALLETS),
  rules: Object.assign(clone(DEFAULT_RULES), shared.rules || {}),
  csv: load(KEYS.csv, SAMPLE),
  orders: new Map(), results: new Map(), forced: new Map(), manual: new Map(), board: new Map(), plan: new Map(),
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
  if (m.changed) { state.catalog = m.catalog; state.pallets = m.types; if (isAdmin && !me.demo) setTimeout(() => { persist('pallets'); persist('catalog'); }, 0); }
}

// admin edits go to the shared database; plain users cannot write (RLS)
function persist(name) {
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
  return { catalog: state.catalog, vehicles: state.vehicles, pallets: state.pallets, rules: state.rules, combos: (state.oneOff.get(id) || []).concat(state.combos), forced: state.forced.has(id) ? state.forced.get(id) : null, added: state.board.get(id) || [], plan: state.plan.get(id) || null };
}
function recalc() {
  state.results = new Map();
  state.forced.forEach((vi, id) => { if (!(vi < state.vehicles.length)) state.forced.delete(id); });
  state.orders.forEach(o => state.results.set(o.id, solve(o, ctx(o.id))));
  state.manual.forEach((m, id) => { if (!m.touched) state.manual.delete(id); });
  if (!state.orders.has(state.sel)) state.sel = state.orders.size ? state.orders.keys().next().value : null;
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
  state.orders = new Map([...res.orders, ...state.orders]);
  state.prioHidden = false;
  $('#problems').textContent = res.problems.length ? 'Nerozpoznáno: ' + res.problems.join('; ') + '.' : '';
  if (fresh.length) state.sel = fresh[0];
  saveOrderList();
  recalc();
  if (open && fresh.length) goDetail();
}
function removeOrder(id) {
  state.orders.delete(id); state.results.delete(id); state.forced.delete(id); state.manual.delete(id); state.board.delete(id); state.plan.delete(id); state.oneOff.delete(id);
  if (state.done.delete(id)) save('itab.done.v1', [...state.done]);
  if (state.ordered.delete(id)) save('itab.ordered.v1', [...state.ordered]);
  if (state.sel === id) state.sel = state.orders.size ? state.orders.keys().next().value : null;
  saveOrderList();
  renderOverview();
}
let timer = null;
function later() { clearTimeout(timer); timer = setTimeout(recalc, 250); }

// ---------- navigation ----------
const VIEWS = ['orders', 'dock', 'catalog', 'pallets', 'combos', 'vehicles', 'rules', 'users', 'help'];
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
    return { id, r, total, sos: state.orders.get(id).sos, known: total - (r.unknown || []).length, pallets: r.pallets.length, parcels: r.parcels.length, kg: r.kg, transport: transportOf(r), status: statusOf(r, id, { done: state.done, ordered: state.ordered, edited }) };
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
    const over = view(id).overweight || (view(id).vehicles || []).filter(v => v.kg > v.maxKg + 1e-9);
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
  if (rmb) { keepScroll(() => { const P = state.plan.get(id); if (P) removePallet(P, rmb); else state.board.set(id, (state.board.get(id) || []).filter(b => b.id !== rmb)); state.manual.delete(id); recalc(); }); return; }
  if (e.target.id === 'resetPlan') { keepScroll(() => { state.plan.delete(id); state.manual.delete(id); recalc(); }); return; }
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
function markSel() {
  document.querySelectorAll('.unk').forEach(el => el.classList.toggle('selected', sel.unk.has(unkKey(el))));
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
    if (u0 && isAdmin) { sel.board.clear(); sel.veh.clear(); toggle(sel.unk, unkKey(u0)); }
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
  const u = e.target.closest('.unk');
  if (u && isAdmin && e.button === 0) {
    const rc = u.getBoundingClientRect();
    const pick = el => ({ code: el.dataset.code, qty: Number(el.dataset.qty), name: el.dataset.name || '', so: el.dataset.so || undefined });
    const group = sel.unk.has(unkKey(u)) && sel.unk.size > 1 ? [...document.querySelectorAll('.unk')].filter(el => sel.unk.has(unkKey(el))).map(pick) : [pick(u)];
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
  if (d.ghost) d.ghost.remove();
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
    let moved = 0, left = 0, blocked = 0;
    srcs.forEach(src => { const r1 = mergePallets(P, src.id, dst.id, state.pallets); moved += r1.moved; left += r1.left; if (r1.blocked) blocked++; });
    if (blocked && !moved) { clearSel(); flash('Nelze: palety jsou z různých zakázek – zakázky se na jedné paletě nemíchají.'); return; }
    clearSel(); state.manual.delete(id); keepScroll(recalc);
    flash(!moved ? 'Cílová paleta je plná – nic se nepřesunulo.' : 'Přeloženo ' + moved + ' ks' + (left ? ', ' + left + ' ks zůstalo na původních paletách (cílová je plná).' : (srcs.length > 1 ? ' z ' + srcs.length + ' palet, ty zmizely.' : ', původní paleta zmizela.')));
    return;
  }
  if (d.ptype) {
    if (!(over && over.closest('.board'))) { flash('Paletu pusťte na plochu „Palety zakázky“.'); return; }
    const id = state.sel, list = state.board.get(id) || [];
    list.push({ id: 'b' + Date.now().toString(36), pal: d.ptype, contents: [] });
    state.board.set(id, list); state.manual.delete(id);
    keepScroll(recalc);
    flash('Přidána prázdná paleta ' + d.ptype + '. Přetáhněte na ni materiál.');
    return;
  }
  if (d.unk) {
    const manualPal = over && over.closest('.board-pal[data-bid]');
    if (manualPal) { askMaterial(d.unk, manualPal.dataset.bid); return; }
    const boardPal = over && over.closest('.board-pal');
    if (boardPal) { askCombo(d.unk, boardPal.dataset.code); return; }
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
function relearn() { state.manual.delete(state.sel); recalc(); }
// one or more unknown articles ride on the pallets of article `host`
function askCombo(list, host) {
  const dlg = $('#dlgCombo');
  const hostArt = state.catalog.find(a => String(a.code).toLowerCase() === host.toLowerCase());
  $('#dcTitle').textContent = list.length > 1 ? 'Přesunout ' + list.length + ' artikly na paletu' : 'Přesunout artikl na paletu';
  $('#dcText').innerHTML = 'Pojedou na paletě <b>' + esc(host) + '</b>' + (hostArt && hostArt.name ? ' <span class="dlg-name">' + esc(hostArt.name) + '</span>' : '') + '.';
  $('#dcRows').innerHTML = '<div class="lr-h"><span>Artikl</span><span>Kusů</span><span>Váha kusu, kg</span></div>' + list.map((u, i) =>
    '<div class="lr"><span><b>' + esc(u.code) + '</b><small>' + esc(u.name || '') + '</small></span><span>' + u.qty + ' ks</span><input type="number" min="0" step="any" data-ck="' + i + '" placeholder="neznámá"></div>').join('');
  $('#dcRule').textContent = 'Pravidlo: když je v zakázce ' + host + ' a artikl je nejvýše tolik kusů jako teď, jede na paletách ' + host + '.';
  $('#dcRemember').checked = true; $('#dcRule').hidden = false;
  // act on the button press itself; the dialog's close event is not reliable in every browser
  dlg.querySelector('form').onsubmit = ev => {
    if (!ev.submitter || ev.submitter.value !== 'yes') return;
    const rules = list.map((u, i) => ({ on: true, code: u.code, withCode: host, min: 0, max: u.qty, mode: 'host', host, pl: 0, pw: 0, per: 0, kg: toNum($('#dcRows [data-ck="' + i + '"]').value) || 0, name: u.name || '', note: 'Uloženo z nakládky' }));
    if ($('#dcRemember').checked) { state.combos.push(...rules); persist('combos'); drawCombos(); flash('Přesunuto ' + rules.length + '× a kombinace uloženy.'); }
    else { const id = state.sel; state.oneOff.set(id, (state.oneOff.get(id) || []).concat(rules)); flash('Přesunuto jen pro tuto zakázku.'); }
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
  peCur = { id, pid: b.id, row: null };
  if (!wasPlan) keepScroll(recalc);
  drawPalEditor();
  $('#dlgPalEdit').showModal();
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
  $('#peBody').innerHTML =
    '<div class="pe-head"><input type="search" id="peType" list="palList2" value="' + esc(t.code ? t.code + ' · ' + t.name : '') + '" aria-label="Typ palety" style="flex:1 1 260px"><datalist id="palList2">' + state.pallets.map(p => '<option value="' + esc(palOption(p)) + '"></option>').join('') + '</datalist><button type="button" class="btn small" id="peTypeBtn">Změnit typ</button></div>' +
    '<p class="muted">' + cm(t.L) + ' × ' + cm(t.W) + ' cm · ' + Math.round(kg) + ' kg (tara ' + (t.tare || 0) + ' kg)' + (t.maxKg ? ' · nosnost ' + t.maxKg + ' kg' : '') + ' · zaplnění ' + Math.round(fill * 100) + ' %</p>' +
    '<div class="pe-fill' + (fill > 1.001 || (t.maxKg && kg - (t.tare || 0) > t.maxKg) ? ' over' : '') + '"><i style="width:' + Math.min(100, Math.round(fill * 100)) + '%"></i></div>' +
    (b.contents.length ? b.contents.map((c, i) => '<div class="pe-row"><span><b>' + esc(c.code) + '</b><span class="muted">' + esc(c.name || '') + (c.ride ? ' · navrch' : '') + '</span></span><span>' + c.units + ' ks</span>' +
      (peCur.row === i ? '' : '<button type="button" class="btn small" data-po="' + i + '">Přesunout…</button>') + '</div>' + (peCur.row === i ? movePanel(c, i) : '')).join('')
      : '<p class="muted">Paleta je prázdná. Přetáhněte na ni materiál na ploše nebo ji smažte.</p>');
  $('#peDelete').hidden = b.contents.some(c => c.units > 0);
}
$('#peBody').addEventListener('click', e => {
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
    const nid = moveUnits(P, pid, c.code, q, to);
    if (!nid) { flash(to !== 'new' && !sameSo(P.find(x => x.id === to) || { contents: [] }, c.so) ? 'Nelze: na cílové paletě je jiná zakázka.' : 'Přesun se nepovedl.'); return; }
    if (after) after(nid);
    peCur.row = null;
    state.manual.delete(id); keepScroll(recalc);
    flash('Přesunuto ' + q + ' ks ' + c.code + '.');
    drawPalEditor();
    return;
  }
  if (e.target.id === 'peTypeBtn') {
    const v = $('#peType').value.trim(), code = v.split(' · ')[0].trim(), t = typeOf(state.pallets, code);
    if (!t) { flash('Vyberte typ palety z nabídky.'); return; }
    setPalletType(state.plan.get(peCur.id), peCur.pid, t.code); state.manual.delete(peCur.id); keepScroll(recalc); drawPalEditor();
  }
});
// show the extra fields only for the chosen option
$('#peBody').addEventListener('change', e => {
  if (e.target.name !== 'pmKind') return;
  const f = { other: '#pmOther', new: '#pmL', exist: '#pmExist' }[e.target.value];
  if (f && $(f)) $(f).focus();
});
$('#peDelete').addEventListener('click', () => {
  if (removePallet(state.plan.get(peCur.id), peCur.pid)) { state.manual.delete(peCur.id); keepScroll(recalc); }
  $('#dlgPalEdit').close();
});

function addBoardPallet(id, b) {
  const P = state.plan.get(id);
  if (P) { P.push(Object.assign({ id: newId(), contents: [] }, b)); state.manual.delete(id); keepScroll(recalc); return; }
  const list = state.board.get(id) || [];
  list.push(Object.assign({ id: 'b' + Date.now().toString(36) + list.length, contents: [] }, b));
  state.board.set(id, list); state.manual.delete(id);
  keepScroll(recalc);
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
  $('#dmRows').innerHTML = '<div class="lr-h m"><span>Artikl</span><span>Na tuto paletu</span><span>Vejde se na paletu</span><span>Váha kusu, kg</span></div>' + listU.map((u, i) =>
    '<div class="lr m"><span><b>' + esc(u.code) + '</b><small>' + esc(u.name || '') + ' · ' + u.qty + ' ks</small></span>' +
    '<input type="number" min="1" max="' + u.qty + '" step="1" value="' + u.qty + '" data-mu="' + i + '" required><input type="number" min="1" step="1" value="' + u.qty + '" data-mp="' + i + '" required><input type="number" min="0" step="any" value="0" data-mk="' + i + '" required></div>').join('');
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
      if (save) state.catalog.push({ code: u.code, name: u.name || '', pack: 'paleta', pal: t.code, per, kg, rot: true });
      // without a plan the catalog makes the pallets itself; with a plan (or without saving) the pieces go on this pallet
      if (P || !save) b.contents.push({ code: u.code, name: u.name || '', units, per, kg, so: u.so });
    });
    if (save) { persist('catalog'); drawCatalog(); drawPallets(); if (!P && !b.contents.length) state.board.set(id, list.filter(x => x !== b)); }
    flash((save ? 'Uloženo do číselníku a položeno: ' : 'Položeno jen pro tuto zakázku: ') + listU.map(u => u.code).join(', ') + ' → ' + t.code + '.');
    clearSel(); state.manual.delete(id); recalc();
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
  // act on the button press itself; the dialog's close event is not reliable in every browser
  dlg.querySelector('form').onsubmit = ev => {
    if (!ev.submitter || ev.submitter.value !== 'yes') return;
    const a = { code: u.code, name: $('#daName').value.trim(), pack: $('#daPack').value, pl: toNum($('#daL').value), pw: toNum($('#daW').value), per: Math.max(1, Math.round(toNum($('#daPer').value))), kg: toNum($('#daKg').value) || 0, rot: $('#daRot').checked };
    state.catalog.push(a);
    persist('catalog'); drawCatalog(); relearn();
    flash('Artikl ' + u.code + ' uložen do číselníku.');
    clearSel();
    if (next) setTimeout(next, 50);
  };
  dlg.returnValue = ''; dlg.showModal();
  (u.name ? $('#daL') : $('#daName')).focus();
}
$('#dcRemember').addEventListener('change', e => { $('#dcRule').hidden = !e.target.checked; });
$('#daPack').addEventListener('change', e => { $('#daPerLabel').textContent = e.target.value === 'balik' ? 'Kusů v balíku' : 'Kusů na paletě'; });
onBoth('pointercancel', e => endDrag(e, true));

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
const drawCatalog = () => renderCatalog(state.catalog, state.catView, state.pallets);
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
$('#catReset').addEventListener('click', () => {
  if (!confirm('Vrátit číselník na ukázková data? Nahrané artikly se smažou.')) return;
  state.catalog = clone(DEFAULT_CATALOG); persist('catalog'); drawCatalog(); recalc(); $('#catReport').innerHTML = '';
});
$('#catExport').addEventListener('click', () => download('ciselnik-artiklu.csv',
  [['artikl', 'nazev', 'baleni', 'paleta', 'delka_mm', 'sirka_mm', 'ks_na_palete', 'vaha_kusu_kg', 'lze_otacet']]
    .concat(state.catalog.map(a => [a.code, a.name, a.pack || 'paleta', a.pack === 'balik' ? '' : (a.pal || ''), a.pack === 'balik' ? a.pl : '', a.pack === 'balik' ? a.pw : '', a.per, String(a.kg).replace('.', ','), a.rot ? 'ano' : 'ne']))));
$('#catFile').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const { rows } = await readFileRows(f), res = rowsToCatalog(rows), replace = $('#catReplace').checked;
    let merged = null;
    if (res.items.length) {
      merged = replace ? { list: res.items } : mergeBy(state.catalog, res.items, a => String(a.code).trim().toLowerCase());
      const m = migrateCatalog(merged.list, state.pallets);
      state.catalog = m.catalog; if (m.types.length !== state.pallets.length) { state.pallets = m.types; persist('pallets'); drawPallets(); }
      persist('catalog'); drawCatalog(); recalc();
    }
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
const drawVehicles = () => renderVehicles(state.vehicles);
bindTable($('#vehBody'), () => state.vehicles, 'vehicles', drawVehicles);
$('#vehAdd').addEventListener('click', () => {
  state.vehicles.push({ name: 'Nové vozidlo', type: 'jine', L: 4, W: 2, kg: 1000, eup: 0, lift: false, cost: 0.5 });
  persist('vehicles'); drawVehicles(); recalc();
});
$('#vehReset').addEventListener('click', () => {
  if (!confirm('Vrátit vozidla na výchozí hodnoty?')) return;
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
const drawCombos = () => renderCombos(state.combos, state.catalog, state.pallets);
bindTable($('#comboBody'), () => state.combos, 'combos', drawCombos);
$('#comboBody').addEventListener('change', e => { if (e.target.getAttribute('data-f') === 'mode' || e.target.getAttribute('data-f') === 'on') drawCombos(); });
$('#comboBody').addEventListener('click', e => {
  const up = e.target.getAttribute('data-up'), down = e.target.getAttribute('data-down');
  if (up == null && down == null) return;
  const i = Number(up != null ? up : down), j = up != null ? i - 1 : i + 1;
  if (j < 0 || j >= state.combos.length) return;
  [state.combos[i], state.combos[j]] = [state.combos[j], state.combos[i]];
  persist('combos'); drawCombos(); recalc();
});
$('#comboAdd').addEventListener('click', () => {
  state.combos.push({ on: true, code: '', withCode: '', min: 0, max: 0, mode: 'host', host: '', pl: 0, pw: 0, per: 0, note: '' });
  persist('combos'); drawCombos();
});
const MODE_NAMES = { host: 'na palete artiklu', pallet: 'na jine palete', parcel: 'jako balik' };
$('#comboExport').addEventListener('click', () => download('kombinace.csv',
  [['aktivni', 'artikl', 'kdyz_je_v_zakazce', 'mnozstvi_od', 'mnozstvi_do', 'pojede', 'cil', 'delka_mm', 'sirka_mm', 'max_ks_na_paletu', 'vaha_kusu_kg', 'poznamka']]
    .concat(state.combos.map(r => [r.on !== false ? 'ano' : 'ne', r.code, r.withCode, r.min || '', r.max || '', MODE_NAMES[r.mode], r.host, r.pl || '', r.pw || '', r.per || '', r.kg ? String(r.kg).replace('.', ',') : '', r.note]))));
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
  ['catalog', 'pallets', 'combos', 'vehicles', 'rules', 'users'].forEach(v => { $('#tab-' + v).hidden = true; });
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
importOrders(load(KEYS.list, null) || state.csv, false, true);
