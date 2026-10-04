import { EPS, fmtKg, fmtM, palWord, balWord, vehWord } from './util.js';
import { makePallets, groupageCheck, parcelCheck } from './pallets.js';
import { typeOf } from './palletTypes.js';
import { planPallets, unplaced } from './plan.js';
import { isEuro } from './util.js';
import { packAll, prepareVehicles } from './packing.js';

export function recoText(vehicles) {
  const m = new Map();
  vehicles.forEach(v => { const g = m.get(v.vi) || { name: v.name, L: v.L, n: 0 }; g.n++; m.set(v.vi, g); });
  return [...m.values()].map(g => g.n + '× ' + g.name + ' ' + fmtM(g.L) + ' m').join(' + ');
}

export function groupItems(items) {
  const m = new Map();
  items.forEach(it => {
    let g = m.get(it.code);
    if (!g) { g = { code: it.code, ci: it.ci, count: 0, units: 0, kg: 0 }; m.set(it.code, g); }
    g.count++; g.units += it.units; g.kg += it.kg;
  });
  return [...m.values()];
}

// The operator's pallet plan replaces the calculated pallets; what is not on any pallet shows up as "to place".
function applyPlan(mp, plan, lines, catalog, types) {
  const idx = new Map(catalog.map((a, i) => [String(a.code).toLowerCase(), i]));
  const extraCi = new Map();
  const ci = code => { const k = code.toLowerCase(); if (idx.has(k)) return idx.get(k); if (!extraCi.has(k)) extraCi.set(k, catalog.length + 50 + extraCi.size); return extraCi.get(k); };
  mp.pallets = planPallets(plan, types, ci);
  const parcelCodes = new Set(mp.parcels.map(p => p.code.toLowerCase()));
  const left = unplaced(lines, plan).filter(u => !parcelCodes.has(u.code.toLowerCase()));
  mp.unknown = left.map(u => Object.assign(u, { known: idx.has(u.code.toLowerCase()) }));
  mp.errors = mp.errors.filter(e => !/není v číselníku|se nevešlo/.test(e));
  left.forEach(u => mp.errors.push('Artikl „' + u.code + '“: ' + u.qty + ' ks není na žádné paletě' + (u.known ? '' : ' (není v číselníku)') + '.'));
  // same wording as the calculation: "3 plné po 156 ks, 1 neúplná: 32 ks, 21 %" – just with the current numbers
  const parts = new Map();
  plan.forEach(b => b.contents.forEach(c => {
    if (!(c.units > 0)) return;
    const k = c.code.toLowerCase(), g = parts.get(k) || { per: c.per || c.units, full: 0, part: [], ride: 0 };
    if (c.ride) g.ride += c.units; else if (c.units >= (c.per || c.units)) g.full++; else g.part.push(c.units);
    parts.set(k, g);
  }));
  const plural = (n, f) => (n === 1 ? f[0] : n >= 2 && n <= 4 ? f[1] : f[2]);
  const distText = g => {
    const out = [];
    if (g.full) out.push(g.per === 1 ? g.full + ' ' + plural(g.full, ['paleta', 'palety', 'palet']) : g.full + ' ' + plural(g.full, ['plná', 'plné', 'plných']) + ' po ' + g.per + ' ks');
    if (g.part.length) out.push(g.part.length + ' ' + plural(g.part.length, ['neúplná', 'neúplné', 'neúplných']) + ': ' + g.part.map(u => u + ' ks, ' + Math.round(u / g.per * 100) + ' %').join('; '));
    if (g.ride) out.push(g.ride + ' ks navrch');
    return out.join(', ');
  };
  const dist = new Map([...parts].map(([k, g]) => [k, [distText(g)]]));
  mp.rows.forEach(x => { const d = dist.get(x.code.toLowerCase()); x.planDist = d ? d.join(', ') : 'na žádné paletě'; });
  plan.forEach(b => b.contents.forEach(c => {
    if (idx.has(c.code.toLowerCase())) return;
    if (!mp.rows.some(x => x.code.toLowerCase() === c.code.toLowerCase())) mp.rows.push({ code: c.code, name: c.name || '', qty: 0, kg: 0, ci: ci(c.code), pack: 'paleta', full: 0, rem: 0, per: c.per || 1, fillRem: 0, count: 0, board: b.pal || 'JINÁ' });
    const row = mp.rows.find(x => x.code.toLowerCase() === c.code.toLowerCase());
    if (row.board) { row.qty += c.units; row.kg += c.units * (c.kg || 0); }
  }));
  mp.rows.forEach(x => { if (!x.planDist) { const d = dist.get(x.code.toLowerCase()); x.planDist = d ? d.join(', ') : ''; } });
}

// Board pallets: material that is not in the catalog, placed by hand on a pallet type for this order only.
function addBoardPallets(mp, added, types, ci0) {
  (added || []).forEach((b, k) => {
    // a saved pallet type, or a one-off pallet defined only for this order
    const t = typeOf(types, b.pal) || b.custom, list = (b.contents || []).filter(c => c.units > 0);
    if (!t || !list.length) return;
    const ci = ci0 + 50 + k;
    const [m, ...rest] = list;
    mp.pallets.push({
      code: m.code, units: m.units, fill: list.reduce((s, c) => s + c.units / (c.per || c.units), 0),
      kg: (t.tare || 0) + list.reduce((s, c) => s + c.units * (c.kg || 0), 0), tare: t.tare || 0,
      pl: t.L, pw: t.W, rot: t.rot !== false, euro: isEuro({ pl: t.L, pw: t.W }), ci, pal: t.code, palName: t.name, palH: t.H || 0, maxKg: t.maxKg || 0,
      extra: rest.length ? rest.map(c => ({ code: c.code, units: c.units, ci, mixed: true, so: c.so })) : undefined, board: b.id, so: m.so
    });
    list.forEach(c => {
      const u = mp.unknown.find(x => x.code.toLowerCase() === c.code.toLowerCase() && (!c.so || !x.so || x.so === c.so));
      if (u) u.qty -= c.units;
      mp.rows.push({ code: c.code, name: c.name || '', qty: c.units, kg: c.units * (c.kg || 0), ci, pack: 'paleta', full: 0, rem: 0, per: c.per || c.units, fillRem: 0, count: 0, board: t.code });
    });
  });
  // what is fully placed is no longer unknown
  const left = mp.unknown.filter(u => u.qty > 0);
  const gone = mp.unknown.filter(u => u.qty <= 0).map(u => u.code);
  mp.unknown.length = 0; left.forEach(u => mp.unknown.push(u));
  if (gone.length) for (let i = mp.errors.length - 1; i >= 0; i--) if (gone.some(c => mp.errors[i].indexOf('„' + c + '“') >= 0)) mp.errors.splice(i, 1);
}

// Pure: order + catalog + vehicles + rules -> result. `forced` = vehicle index chosen by the user.
// `added` = pallets the operator put on the calculator board for this order: [{ id, pal, contents: [{ code, name, units, per, kg }] }]
export function solve(o, { catalog, vehicles, rules, combos = [], pallets = [], forced = null, added = [], plan = null }) {
  const lines = [...o.lines.values()];
  // each zakázka is calculated on its own pallets (pallets do not mix zakázky); everything is tagged with its zakázka
  const sos = o.sos && o.sos.length ? o.sos : [o.id];
  const mp = { pallets: [], parcels: [], errors: [], rows: [], unknown: [] };
  sos.forEach(so => {
    const part = makePallets(lines.filter(l => (l.so || o.id) === so), catalog, combos, pallets, { mix: rules.mix !== false });
    const tag = x => Object.assign(x, { so });
    mp.pallets.push(...part.pallets.map(tag)); mp.parcels.push(...part.parcels.map(tag));
    mp.rows.push(...part.rows.map(tag)); mp.unknown.push(...part.unknown.map(tag));
    mp.errors.push(...part.errors.map(e => (sos.length > 1 ? 'Zakázka ' + so + ': ' : '') + e));
  });
  if (plan) applyPlan(mp, plan, lines, catalog, pallets);
  else addBoardPallets(mp, added, pallets, catalog.length);
  const r = {
    id: o.id, sos, planOn: !!plan, plan, pallets: mp.pallets, parcels: mp.parcels, errors: mp.errors, rows: mp.rows, unknown: mp.unknown,
    kg: 0, units: 0, groupage: null, parcelInfo: null, vehicles: [], oversize: [], mode: 'empty', reco: '', forced
  };
  // goods + own weight of the pallets
  r.kg = mp.rows.reduce((s, x) => s + x.kg, 0) + mp.pallets.reduce((s, p) => s + (p.tare || 0), 0);
  r.tare = mp.pallets.reduce((s, p) => s + (p.tare || 0), 0);
  r.units = mp.rows.reduce((s, x) => s + x.qty, 0);
  const pool = prepareVehicles(vehicles);
  const widest = pool.slice().sort((a, b) => b.Lmm * b.Wmm - a.Lmm * a.Wmm)[0];
  const ldmW = widest ? widest.Wmm : 2400;
  r.ldm = mp.pallets.reduce((s, p) => s + p.pl * p.pw, 0) / ldmW / 1000;
  r.euroCount = mp.pallets.filter(p => p.euro).length;
  r.big = [];
  mp.pallets.forEach(p => {
    const lg = Math.max(p.pl, p.pw), sh = Math.min(p.pl, p.pw);
    if (lg >= rules.oL * 1000 - EPS || sh > rules.oW * 1000 + EPS) {
      const t = p.code + ' ' + lg + '×' + sh + ' mm'; if (r.big.indexOf(t) < 0) r.big.push(t);
    }
  });
  if (mp.parcels.length) r.parcelInfo = parcelCheck(mp.parcels, rules);

  const info = [];
  if (mp.pallets.length) info.push(mp.pallets.length + ' ' + palWord(mp.pallets.length));
  if (mp.parcels.length) info.push(mp.parcels.length + ' ' + balWord(mp.parcels.length));
  if (!info.length) { r.listInfo = 'žádná data'; r.stat = 'Zkontrolovat'; return r; }
  r.listInfo = info.join(' + ') + ', ' + fmtKg(r.kg);

  if (!mp.pallets.length) {
    r.mode = r.parcelInfo.ok ? 'parcels' : 'warn';
    r.stat = r.parcelInfo.ok ? 'Balíky' : 'Zkontrolovat';
    return r;
  }
  r.groupage = groupageCheck(mp.pallets, rules);
  if (r.groupage.ok && forced == null) { r.mode = 'groupage'; r.stat = 'Sběrná služba'; }
  else {
    if (sos.length > 1) mp.pallets.forEach(p => { p.showSo = true; });
    const pk = packAll(mp.pallets, vehicles, forced, rules.oneVeh !== false, sos, rules);
    r.vehicles = pk.vehicles; r.oversize = pk.oversize;
    r.reco = recoText(pk.vehicles);
    if (pk.oversize.length) { r.mode = 'warn'; r.stat = 'Zkontrolovat'; }
    else { r.mode = 'trucks'; r.stat = pk.vehicles.length + ' ' + vehWord(pk.vehicles.length); }
  }
  if (r.parcelInfo && !r.parcelInfo.ok && r.mode !== 'warn') { r.mode = 'warn'; r.stat = 'Zkontrolovat'; }
  return r;
}
