import { EPS, mulberry32 } from './util.js';

// ---------- MaxRects bin (top view, x along the body, y across) ----------
export class Bin {
  constructor(v) {
    this.v = v; this.L = v.Lmm; this.W = v.Wmm;
    this.free = [{ x: 0, y: 0, w: this.L, h: this.W }];
    this.items = []; this.kg = 0; this.usedL = 0; this.usedW = 0;
  }
  find(pl, pw, rot) {
    let best = null;
    const opts = [[pl, pw, false]];
    if (rot && pl !== pw) opts.push([pw, pl, true]);
    for (const f of this.free) {
      for (const [w, h, r] of opts) {
        if (w <= f.w + EPS && h <= f.h + EPS) {
          const a = f.w - w, b = f.h - h, s = Math.min(a, b), l = Math.max(a, b);
          if (!best || s < best.s - EPS || (Math.abs(s - best.s) <= EPS && (l < best.l - EPS || (Math.abs(l - best.l) <= EPS && f.x < best.x))))
            best = { x: f.x, y: f.y, w, h, r, s, l };
        }
      }
    }
    return best;
  }
  place(pos, it) {
    const R = { x: pos.x, y: pos.y, w: pos.w, h: pos.h }, nf = [];
    this.free.forEach(f => {
      if (R.x >= f.x + f.w - EPS || R.x + R.w <= f.x + EPS || R.y >= f.y + f.h - EPS || R.y + R.h <= f.y + EPS) { nf.push(f); return; }
      if (R.x > f.x + EPS) nf.push({ x: f.x, y: f.y, w: R.x - f.x, h: f.h });
      if (R.x + R.w < f.x + f.w - EPS) nf.push({ x: R.x + R.w, y: f.y, w: f.x + f.w - R.x - R.w, h: f.h });
      if (R.y > f.y + EPS) nf.push({ x: f.x, y: f.y, w: f.w, h: R.y - f.y });
      if (R.y + R.h < f.y + f.h - EPS) nf.push({ x: f.x, y: R.y + R.h, w: f.w, h: f.y + f.h - R.y - R.h });
    });
    this.free = nf.filter((a, i) => !nf.some((b, j) => i !== j && contains(b, a, i, j)));
    this.items.push(Object.assign({}, it, { x: R.x, y: R.y, w: R.w, h: R.h, turned: pos.r }));
    this.kg += it.kg;
    this.usedL = Math.max(this.usedL, R.x + R.w);
    this.usedW = Math.max(this.usedW, R.y + R.h);
  }
}
function contains(b, a, i, j) {
  if (!(a.x >= b.x - EPS && a.y >= b.y - EPS && a.x + a.w <= b.x + b.w + EPS && a.y + a.h <= b.y + b.h + EPS)) return false;
  const same = Math.abs(a.x - b.x) <= EPS && Math.abs(a.y - b.y) <= EPS && Math.abs(a.w - b.w) <= EPS && Math.abs(a.h - b.h) <= EPS;
  return same ? j < i : true;
}

// ---------- vehicles ----------
export function prepareVehicles(vehicles) {
  return vehicles
    .map((v, i) => Object.assign({}, v, { vi: i, Lmm: v.L * 1000, Wmm: v.W * 1000 }))
    .filter(v => v.Lmm > 0 && v.Wmm > 0 && v.kg > 0);
}
export function fitsVehicle(it, v) {
  const dims = (it.pl <= v.Lmm + EPS && it.pw <= v.Wmm + EPS) || (it.rot && it.pw <= v.Lmm + EPS && it.pl <= v.Wmm + EPS);
  return dims && it.kg <= v.kg;
}
function roomFor(b) { return !(b.v.eup > 0) || b.items.length < b.v.eup; }

// Cheapest vehicle that takes the bin's layout as is.
function classify(b, pool) {
  let best = null;
  for (const v of pool) {
    if (b.usedL > v.Lmm + EPS || b.usedW > v.Wmm + EPS || b.kg > v.kg) continue;
    if (v.eup > 0 && b.items.length > v.eup) continue;
    if (!best || v.cost < best.cost || (v.cost === best.cost && v.Lmm * v.Wmm < best.Lmm * best.Wmm)) best = v;
  }
  return best || b.v;
}

function fillBins(list, primary, bySize) {
  const bins = [];
  list.forEach(it => {
    for (const b of bins) {
      if (b.kg + it.kg > b.v.kg || !roomFor(b)) continue;
      const pos = b.find(it.pl, it.pw, it.rot);
      if (pos) { b.place(pos, it); return; }
    }
    const v = fitsVehicle(it, primary) ? primary : bySize.find(x => fitsVehicle(it, x));
    const nb = new Bin(v), p2 = nb.find(it.pl, it.pw, it.rot);
    if (p2) { nb.place(p2, it); bins.push(nb); }
  });
  return bins;
}

// pallets -> vehicles. `forced` = index into vehicles to use only that vehicle.
// oneVehicle: an order goes in a single vehicle whenever one can take it all (company rule), even if several smaller ones are cheaper
export function packAll(pallets, vehicles, forced, oneVehicle) {
  let pool = prepareVehicles(vehicles);
  if (forced != null) pool = pool.filter(v => v.vi === forced);
  const oversize = [], items = [];
  pallets.forEach((p, i) => {
    const it = Object.assign({}, p, { id: i });
    if (pool.some(v => fitsVehicle(it, v))) items.push(it); else oversize.push(it);
  });
  if (!items.length) return { vehicles: [], oversize };

  const area = i => i.pl * i.pw;
  const by = f => items.slice().sort((a, b) => f(b) - f(a));
  const lists = [
    by(i => Math.max(i.pl, i.pw) * 1e8 + area(i)),
    by(area),
    by(i => Math.min(i.pl, i.pw) * 1e8 + area(i)),
    by(i => i.kg)
  ];
  const rng = mulberry32(12345), tries = Math.max(10, Math.min(300, Math.floor(8000 / items.length)));
  for (let t = 0; t < tries; t++) {
    const keyed = items.map(i => ({ i, k: area(i) * (0.6 + 0.8 * rng()) }));
    keyed.sort((a, b) => b.k - a.k);
    lists.push(keyed.map(x => x.i));
  }
  const bySize = pool.slice().sort((a, b) => b.Lmm * b.Wmm - a.Lmm * a.Wmm || b.kg - a.kg);
  // try filling each distinct body size first; the largest one is the baseline
  const primaries = bySize.filter((v, i) => bySize.findIndex(x => x.Lmm === v.Lmm && x.Wmm === v.Wmm && x.kg === v.kg && x.eup === v.eup) === i);
  let best = null;
  if (oneVehicle && forced == null) {
    const byCost = pool.slice().sort((a, b) => (a.cost || 0) - (b.cost || 0) || a.Lmm * a.Wmm - b.Lmm * b.Wmm);
    for (const v of byCost) {
      if (!items.every(it => fitsVehicle(it, v))) continue;
      if (items.reduce((s, it) => s + it.kg, 0) > v.kg) continue;
      if (v.eup > 0 && items.length > v.eup) continue;
      const one = lists.map(list => fillBins(list, v, [v])).find(bins => bins.length === 1 && bins[0].items.length === items.length);
      if (one) { best = { c: v.cost || 0, typed: [{ v, b: one[0] }] }; break; }
    }
  }
  if (!best) primaries.forEach(P => {
    lists.forEach(list => {
      const bins = fillBins(list, P, bySize);
      let c = 0;
      const typed = bins.map(b => { const v = classify(b, pool); c += (v.cost || 0) + b.usedL / 1e7; return { v, b }; });
      if (!best || c < best.c - 1e-9) best = { c, typed };
    });
  });
  const counter = new Map();
  const out = best.typed
    .sort((a, b) => b.v.Lmm * b.v.Wmm - a.v.Lmm * a.v.Wmm || b.b.usedL - a.b.usedL)
    .map(({ v, b }) => {
      const n = (counter.get(v.vi) || 0) + 1; counter.set(v.vi, n);
      return { vi: v.vi, type: v.type, name: v.name, n, title: v.name + ' ' + n, L: v.Lmm, W: v.Wmm, maxKg: v.kg, items: b.items, kg: b.kg };
    });
  return { vehicles: out, oversize };
}
