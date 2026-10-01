import { clone, toNum } from './core/util.js';
import { DEFAULT_CATALOG, DEFAULT_VEHICLES, DEFAULT_RULES, DEFAULT_COMBOS, SAMPLE } from './core/defaults.js';
import { parseOrders, rowsToOrderText } from './core/parse.js';
import { solve } from './core/solve.js';
import { fromResult, viewOf, movePallet, rotatePallet, addVehicle, removeVehicle, replaceVehicle, DEPOT } from './core/manual.js';
import { readFileRows, isSpreadsheet, rowsToCatalog, rowsToVehicles, rowsToCombos, mergeBy, toCsv } from './io/importTable.js';
import { renderKpis, renderPriorities, renderList, renderDetail, requestText, loadPlanHtml } from './ui/orders.js';
import { ringilHtml } from './ui/ringil.js';
import { packListHtml } from './ui/packlist.js';
import { requireLogin, loadSettings, saveSetting, signOut, changePassword, listProfiles, setRole, adminUsers } from './auth.js';
import { esc } from './core/util.js';
import { renderCatalog, renderVehicles, renderCombos, renderRules, importReport } from './ui/settings.js';

const $ = s => document.querySelector(s);
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
  rules: Object.assign(clone(DEFAULT_RULES), shared.rules || {}),
  csv: load(KEYS.csv, SAMPLE),
  orders: new Map(), results: new Map(), forced: new Map(), manual: new Map(), oneOff: new Map(), done: new Set(load('itab.done.v1', [])), isAdmin, sel: null, prioHidden: false,
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
  return { catalog: state.catalog, vehicles: state.vehicles, rules: state.rules, combos: (state.oneOff.get(id) || []).concat(state.combos), forced: state.forced.has(id) ? state.forced.get(id) : null };
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
  renderList(state.orders, vs, state.sel, $('#q').value, state.done);
  renderDetail(vs.get(state.sel), state);
}
function saveOrderList() {
  const lines = [];
  state.orders.forEach(o => o.lines.forEach(l => lines.push([o.id, l.code, String(l.name || '').replace(/;/g, ','), l.qty].join(';'))));
  save(KEYS.list, lines.join('\n'));
}
// new orders go to the top of the list and the first one opens; older ones stay
function importOrders(text, open, initial) {
  const res = parseOrders(text);
  const fresh = [...res.orders.keys()];
  // a new import clears the orders marked as done
  if (fresh.length && !initial) { state.done.forEach(id => { state.orders.delete(id); state.forced.delete(id); state.manual.delete(id); }); state.done.clear(); save('itab.done.v1', []); }
  fresh.forEach(id => { state.forced.delete(id); state.manual.delete(id); state.oneOff.delete(id); state.orders.delete(id); });
  state.orders = new Map([...res.orders, ...state.orders]);
  state.prioHidden = false;
  $('#problems').textContent = res.problems.length ? 'Nerozpoznáno: ' + res.problems.join('; ') + '.' : '';
  if (fresh.length) state.sel = fresh[0];
  saveOrderList();
  recalc();
  if (open && fresh.length) goDetail();
}
function removeOrder(id) {
  state.orders.delete(id); state.results.delete(id); state.forced.delete(id); state.manual.delete(id); state.oneOff.delete(id);
  if (state.done.delete(id)) save('itab.done.v1', [...state.done]);
  if (state.sel === id) state.sel = state.orders.size ? state.orders.keys().next().value : null;
  saveOrderList();
  renderOverview();
}
let timer = null;
function later() { clearTimeout(timer); timer = setTimeout(recalc, 250); }

// ---------- navigation ----------
const VIEWS = ['orders', 'catalog', 'combos', 'vehicles', 'rules', 'users'];
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
function select(id) { state.sel = id; renderOverview(); goDetail(); }

$('#q').addEventListener('input', () => { showView('orders'); renderList(state.orders, views(), state.sel, $('#q').value, state.done); });
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
  const b = e.target.closest('.feed'); if (b) select(b.getAttribute('data-id'));
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
$('#detail').addEventListener('change', e => {
  if (e.target.id !== 'forceVeh') return;
  const id = state.sel, v = e.target.value;
  if (v === '') state.forced.delete(id); else state.forced.set(id, Number(v));
  state.manual.delete(id);
  const o = state.orders.get(id);
  state.results.set(id, solve(o, ctx(id)));
  renderOverview();
});
// ---------- manual loading ----------
function manualOf(id) {
  if (!state.manual.has(id)) state.manual.set(id, fromResult(state.results.get(id)));
  return state.manual.get(id);
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
$('#detail').addEventListener('click', e => {
  const id = state.sel; if (!id) return;
  if (e.target.id === 'addVehBtn') {
    const r = state.results.get(id), sv = $('#addVehSel').value, vi = sv === DEPOT ? DEPOT : Number(sv);
    if (vi === DEPOT) {
      if (view(id).depot) { flash('Sběrná služba už v zakázce je.'); return; }
      keepScroll(() => addVehicle(manualOf(id), state.vehicles, DEPOT));
      return;
    }
    // an overloaded vehicle is replaced: its pallets move to the new one and the old one goes away
    const over = view(id).overweight || (view(id).vehicles || []).filter(v => v.kg > v.maxKg + 1e-9);
    if (over.length) {
      const target = over[0];
      if (state.vehicles[vi] && target.kg > state.vehicles[vi].kg + 1e-9) { flash('Nové vozidlo unese jen ' + state.vehicles[vi].kg + ' kg, náklad má ' + Math.round(target.kg) + ' kg.'); return; }
      let ok = false;
      keepScroll(() => { ok = replaceVehicle(manualOf(id), state.vehicles, target.idx, vi); });
      flash(ok ? target.title + ' nahrazeno: palety přesunuty do nového vozidla.' : 'Palety z ' + target.title + ' se do nového vozidla nevejdou.');
      return;
    }
    keepScroll(() => {
      const fresh = !state.manual.has(id);
      const m = manualOf(id);
      addVehicle(m, state.vehicles, vi, fresh && !m.vehicles.length ? r.pallets : null);
    });
    return;
  }
  if (e.target.id === 'resetManual') { keepScroll(() => state.manual.delete(id)); return; }
  const rm = e.target.getAttribute('data-rmveh');
  if (rm != null) { keepScroll(() => removeVehicle(manualOf(id), Number(rm))); return; }
});
$('#detail').addEventListener('dblclick', e => {
  const g = e.target.closest('.pal'); if (!g) return;
  const id = state.sel;
  keepScroll(() => { if (!rotatePallet(manualOf(id), state.vehicles, Number(g.dataset.v), Number(g.dataset.p))) flash('Otočená se paleta nevejde nebo ji nelze otáčet.'); });
});
// drag a pallet: a floating copy follows the pointer, the drop point in the target body is converted to mm
let drag = null;
$('#detail').addEventListener('pointerdown', e => {
  const u = e.target.closest('.unk');
  if (u && isAdmin && e.button === 0) {
    const rc = u.getBoundingClientRect();
    drag = { g: u, unk: { code: u.dataset.code, qty: Number(u.dataset.qty), name: u.dataset.name || '' }, sx: e.clientX, sy: e.clientY, w: Math.min(rc.width, 120), h: 40, color: 'var(--gray)', moved: false };
    u.setPointerCapture(e.pointerId);
    return;
  }
  const g = e.target.closest('.pal'); if (!g || e.button !== 0) return;
  const svg = g.ownerSVGElement, rect = g.querySelector('rect').getBoundingClientRect();
  drag = { g, from: Number(g.dataset.v), pid: Number(g.dataset.p), sx: e.clientX, sy: e.clientY, w: rect.width, h: rect.height, color: g.querySelector('rect').style.fill, moved: false, svg };
  g.setPointerCapture(e.pointerId);
});
$('#detail').addEventListener('pointermove', e => {
  if (!drag) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 5) return;
  if (!drag.moved) {
    drag.moved = true; drag.g.classList.add('dragging');
    drag.ghost = document.createElement('div'); drag.ghost.className = 'drag-ghost';
    Object.assign(drag.ghost.style, { width: drag.w + 'px', height: drag.h + 'px', background: drag.color });
    document.body.appendChild(drag.ghost);
  }
  drag.ghost.style.left = (e.clientX - drag.w / 2) + 'px';
  drag.ghost.style.top = (e.clientY - drag.h / 2) + 'px';
  document.querySelectorAll('.veh-svg.drop-target,.pal.drop-host').forEach(x => x.classList.remove('drop-target', 'drop-host'));
  const over = document.elementFromPoint(e.clientX, e.clientY);
  const host = drag.unk && over && over.closest('.pal');
  if (host) host.classList.add('drop-host');
  else { const t = over && over.closest('.veh-svg'); if (t) t.classList.add('drop-target'); }
});
function endDrag(e, cancel) {
  if (!drag) return;
  const d = drag; drag = null;
  if (d.ghost) d.ghost.remove();
  d.g.classList.remove('dragging');
  document.querySelectorAll('.veh-svg.drop-target,.pal.drop-host').forEach(x => x.classList.remove('drop-target', 'drop-host'));
  if (cancel || !d.moved) return;
  const over = document.elementFromPoint(e.clientX, e.clientY), svg = over && over.closest('.veh-svg');
  if (d.unk) {
    const hostG = over && over.closest('.pal');
    if (hostG) {
      const v = view(state.sel), veh = v.vehicles[Number(hostG.dataset.v)];
      const hp = veh && veh.items.find(i => i.id === Number(hostG.dataset.p));
      if (hp) askCombo(d.unk, hp.code);
    } else if (svg) askArticle(d.unk);
    else flash('Pusťte artikl na paletu nebo na volné místo ve vozidle.');
    return;
  }
  if (!svg) { flash('Paletu pusťte do některého vozidla.'); return; }
  const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse());
  const S = Number(svg.dataset.s), to = Number(svg.dataset.v);
  const m = manualOf(state.sel), it = m.vehicles[d.from].items.find(i => i.id === d.pid);
  const x = (p.x - Number(svg.dataset.x0)) * S - it.w / 2, y = (p.y - Number(svg.dataset.y0)) * S - it.h / 2;
  keepScroll(() => { if (!movePallet(m, state.vehicles, d.from, d.pid, to, x, y)) flash('Sem se paleta nevejde.'); });
}
$('#detail').addEventListener('pointerup', e => endDrag(e, false));

// ---------- learning: save a combination or a new article from the drop ----------
function relearn() { state.manual.delete(state.sel); recalc(); }
function askCombo(u, host) {
  const dlg = $('#dlgCombo');
  const hostArt = state.catalog.find(a => String(a.code).toLowerCase() === host.toLowerCase());
  const nm = (code, name) => '<b>' + esc(code) + '</b>' + (name ? ' <span class="dlg-name">' + esc(name) + '</span>' : '');
  $('#dcText').innerHTML = 'Artikl ' + nm(u.code, u.name) + ' (' + u.qty + ' ks)<br>pojede na paletě ' + nm(host, hostArt && hostArt.name) + '.';
  $('#dcRule').textContent = 'Pravidlo: když je v zakázce ' + host + ' a ' + u.code + ' je nejvýše ' + u.qty + ' ks, jede na paletách ' + host + '.';
  $('#dcKg').value = ''; $('#dcRemember').checked = true; $('#dcRule').hidden = false;
  // act on the button press itself; the dialog's close event is not reliable in every browser
  dlg.querySelector('form').onsubmit = ev => {
    if (!ev.submitter || ev.submitter.value !== 'yes') return;
    const rule = { on: true, code: u.code, withCode: host, min: 0, max: u.qty, mode: 'host', host, pl: 0, pw: 0, per: 0, kg: toNum($('#dcKg').value) || 0, name: u.name || '', note: 'Uloženo z nakládky' };
    if ($('#dcRemember').checked) { state.combos.push(rule); persist('combos'); drawCombos(); flash('Přesunuto a kombinace uložena.'); }
    else { const id = state.sel; state.oneOff.set(id, (state.oneOff.get(id) || []).concat([rule])); flash('Přesunuto jen pro tuto zakázku.'); }
    relearn();
  };
  dlg.returnValue = ''; dlg.showModal();
}
function askArticle(u) {
  const dlg = $('#dlgArticle');
  $('#daTitle').textContent = 'Nový artikl ' + u.code;
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
  };
  dlg.returnValue = ''; dlg.showModal();
  (u.name ? $('#daL') : $('#daName')).focus();
}
$('#dcRemember').addEventListener('change', e => { $('#dcRule').hidden = !e.target.checked; });
$('#daPack').addEventListener('change', e => { $('#daPerLabel').textContent = e.target.value === 'balik' ? 'Kusů v balíku' : 'Kusů na paletě'; });
$('#detail').addEventListener('pointercancel', e => endDrag(e, true));

// ---------- packing list ----------
$('#detail').addEventListener('click', e => {
  if (e.target.id !== 'packBtn') return;
  const r = view(state.sel); if (!r) return;
  const names = new Map(state.catalog.map(a => [String(a.code).toLowerCase(), a.name || '']));
  state.orders.get(r.id).lines.forEach(l => { if (l.name && !names.get(l.code.toLowerCase())) names.set(l.code.toLowerCase(), l.name); });
  const w = window.open('', '_blank');
  if (!w) { flash('Prohlížeč zablokoval nové okno. Povolte vyskakovací okna pro tento web.'); return; }
  w.document.write(packListHtml(r, names)); w.document.close();
  w.focus(); setTimeout(() => w.print(), 300);
});

$('#detail').addEventListener('click', e => {
  if (e.target.id !== 'loadPrintBtn') return;
  const r = view(state.sel); if (!r) return;
  const w = window.open('', '_blank');
  if (!w) { flash('Prohlížeč zablokoval nové okno. Povolte vyskakovací okna pro tento web.'); return; }
  w.document.write(loadPlanHtml(r, state.vehicles)); w.document.close();
  w.focus(); setTimeout(() => w.print(), 300);
});

// ---------- Ringil ----------
$('#detail').addEventListener('click', e => {
  if (e.target.id !== 'ringilBtn') return;
  const r = view(state.sel); if (!r) return;
  $('#drTitle').textContent = 'Údaje pro Ringil – zakázka ' + r.id;
  $('#drBody').innerHTML = ringilHtml(r);
  $('#dlgRingil').showModal();
});
$('#drBody').addEventListener('click', e => {
  const b = e.target.closest('.rg-copy'); if (!b) return;
  const v = b.getAttribute('data-copy');
  const ok = () => { b.textContent = '✓ Zkopírováno'; b.classList.add('done'); b.closest('.rg-row').classList.add('copied'); };
  try { navigator.clipboard.writeText(v).then(ok, () => flash('Kopírování se nepodařilo, označte hodnotu ručně.')); } catch (x) { flash('Kopírování se nepodařilo.'); }
});
$('#detail').addEventListener('click', e => {
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
const drawCatalog = () => renderCatalog(state.catalog, state.catView);
bindTable($('#catBody'), () => state.catalog, 'catalog', drawCatalog);
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
  [['artikl', 'nazev', 'baleni', 'delka_mm', 'sirka_mm', 'ks_na_palete', 'vaha_kusu_kg', 'lze_otacet']]
    .concat(state.catalog.map(a => [a.code, a.name, a.pack || 'paleta', a.pl, a.pw, a.per, String(a.kg).replace('.', ','), a.rot ? 'ano' : 'ne']))));
$('#catFile').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const { rows } = await readFileRows(f), res = rowsToCatalog(rows), replace = $('#catReplace').checked;
    let merged = null;
    if (res.items.length) {
      merged = replace ? { list: res.items } : mergeBy(state.catalog, res.items, a => String(a.code).trim().toLowerCase());
      state.catalog = merged.list; persist('catalog'); drawCatalog(); recalc();
    }
    importReport($('#catReport'), res, merged, replace);
  } catch (err) { $('#catReport').innerHTML = '<p class="problems">' + err.message + '</p>'; }
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
const drawCombos = () => renderCombos(state.combos, state.catalog);
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
  ['catalog', 'combos', 'vehicles', 'rules', 'users'].forEach(v => { $('#tab-' + v).hidden = true; });
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
drawCatalog(); drawVehicles(); drawCombos(); renderRules(state.rules);
importOrders(load(KEYS.list, null) || state.csv, false, true);
