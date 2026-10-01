import { EPS, fmtKg, fmtM, palWord, balWord, vehWord } from './util.js';
import { makePallets, groupageCheck, parcelCheck } from './pallets.js';
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

// Pure: order + catalog + vehicles + rules -> result. `forced` = vehicle index chosen by the user.
export function solve(o, { catalog, vehicles, rules, combos = [], forced = null }) {
  const mp = makePallets([...o.lines.values()], catalog, combos);
  const r = {
    id: o.id, pallets: mp.pallets, parcels: mp.parcels, errors: mp.errors, rows: mp.rows, unknown: mp.unknown,
    kg: 0, units: 0, groupage: null, parcelInfo: null, vehicles: [], oversize: [], mode: 'empty', reco: '', forced
  };
  r.kg = mp.rows.reduce((s, x) => s + x.kg, 0);
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
    const pk = packAll(mp.pallets, vehicles, forced);
    r.vehicles = pk.vehicles; r.oversize = pk.oversize;
    r.reco = recoText(pk.vehicles);
    if (pk.oversize.length) { r.mode = 'warn'; r.stat = 'Zkontrolovat'; }
    else { r.mode = 'trucks'; r.stat = pk.vehicles.length + ' ' + vehWord(pk.vehicles.length); }
  }
  if (r.parcelInfo && !r.parcelInfo.ok && r.mode !== 'warn') { r.mode = 'warn'; r.stat = 'Zkontrolovat'; }
  return r;
}
