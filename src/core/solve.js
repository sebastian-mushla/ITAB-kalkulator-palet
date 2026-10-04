import { EPS, fmtKg, fmtM, palWord, balWord, vehWord } from './util.js';
import { makePallets, groupageCheck, parcelCheck } from './pallets.js';
import { typeOf } from './palletTypes.js';
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

// Board pallets: material that is not in the catalog, placed by hand on a pallet type for this order only.
function addBoardPallets(mp, added, types, ci0) {
  (added || []).forEach((b, k) => {
    const t = typeOf(types, b.pal), list = (b.contents || []).filter(c => c.units > 0);
    if (!t || !list.length) return;
    const ci = ci0 + 50 + k;
    const [m, ...rest] = list;
    mp.pallets.push({
      code: m.code, units: m.units, fill: list.reduce((s, c) => s + c.units / (c.per || c.units), 0),
      kg: (t.tare || 0) + list.reduce((s, c) => s + c.units * (c.kg || 0), 0), tare: t.tare || 0,
      pl: t.L, pw: t.W, rot: t.rot !== false, euro: isEuro({ pl: t.L, pw: t.W }), ci, pal: t.code, palName: t.name, palH: t.H || 0, maxKg: t.maxKg || 0,
      extra: rest.length ? rest.map(c => ({ code: c.code, units: c.units, ci, mixed: true })) : undefined, board: b.id
    });
    list.forEach(c => {
      const u = mp.unknown.find(x => x.code.toLowerCase() === c.code.toLowerCase());
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
export function solve(o, { catalog, vehicles, rules, combos = [], pallets = [], forced = null, added = [] }) {
  const mp = makePallets([...o.lines.values()], catalog, combos, pallets, { mix: rules.mix !== false });
  addBoardPallets(mp, added, pallets, catalog.length);
  const r = {
    id: o.id, pallets: mp.pallets, parcels: mp.parcels, errors: mp.errors, rows: mp.rows, unknown: mp.unknown,
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
    const pk = packAll(mp.pallets, vehicles, forced, rules.oneVeh !== false);
    r.vehicles = pk.vehicles; r.oversize = pk.oversize;
    r.reco = recoText(pk.vehicles);
    if (pk.oversize.length) { r.mode = 'warn'; r.stat = 'Zkontrolovat'; }
    else { r.mode = 'trucks'; r.stat = pk.vehicles.length + ' ' + vehWord(pk.vehicles.length); }
  }
  if (r.parcelInfo && !r.parcelInfo.ok && r.mode !== 'warn') { r.mode = 'warn'; r.stat = 'Zkontrolovat'; }
  return r;
}
