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

// ---------- weight distribution ----------
// Keeps the layout (same slots), only decides which pallet sits where:
// 1) if the heavier half is at the doors, mirror the plan so it is at the cab (x = 0);
// 2) pallets with the same footprint swap slots: heaviest to the front, and across the width
//    the heavier one goes to the side that is lighter so far (left/right balance).
export function balanceLoad(items, W) {
  if (items.length < 2) return items;
  let out = items.map(i => Object.assign({}, i));
  const usedL = Math.max(...out.map(i => i.x + i.w));
  const kg = out.reduce((s, i) => s + i.kg, 0) || 1;
  const cg = out.reduce((s, i) => s + i.kg * (i.x + i.w / 2), 0) / kg;
  if (cg > usedL / 2 + 1) out.forEach(i => { i.x = usedL - i.x - i.w; });
  const groups = new Map();
  out.forEach(i => { const k = i.w + '×' + i.h; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); });
  let left = 0, right = 0;
  const slotsAll = [];
  groups.forEach(list => {
    const slots = list.map(i => ({ x: i.x, y: i.y, w: i.w, h: i.h, turned: i.turned }));
    const heavy = list.slice().sort((a, b) => b.kg - a.kg);
    slots.sort((a, b) => a.x - b.x || a.y - b.y);
    slotsAll.push({ slots, heavy });
  });
  // assign front to back; inside one column (same x) put the heavier pallet on the lighter side
  slotsAll.forEach(({ slots, heavy }) => {
    let k = 0;
    while (k < slots.length) {
      const col = slots.filter(s => Math.abs(s.x - slots[k].x) < EPS);
      const goods = heavy.splice(0, col.length);
      const bySide = col.slice().sort((a, b) => (left <= right ? a.y - b.y : b.y - a.y));
      goods.forEach((g, j) => {
        const s = bySide[j];
        Object.assign(g, { x: s.x, y: s.y, w: s.w, h: s.h, turned: s.turned });
        if (s.y + s.h / 2 < W / 2) left += g.kg; else right += g.kg;
      });
      k += col.length;
    }
  });
  slideAcross(out, W);
  return out;
}

// small tie-break cost: how far left/right is from 50/50 after balancing (never outweighs a vehicle's price)
function imbalance(b, W) {
  const st = loadStats(balanceLoad(b.items, W), W);
  return st ? Math.abs(st.leftPct - 50) / 1e4 : 0;
}

// 3) a pallet with free room across the body slides to the lighter side (mirror position, far edge or the wall)
function slideAcross(items, W) {
  const leftShare = (i, y) => Math.max(0, Math.min(1, (W / 2 - y) / i.h));
  const diff = () => items.reduce((s, i) => s + i.kg * (2 * leftShare(i, i.y) - 1), 0); // >0 = left heavier
  const free = (it, y) => y >= -EPS && y + it.h <= W + EPS && !items.some(o => o !== it && it.x < o.x + o.w - EPS && o.x < it.x + it.w - EPS && y < o.y + o.h - EPS && o.y < y + it.h - EPS);
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    items.slice().sort((a, b) => b.kg - a.kg).forEach(it => {
      const d0 = Math.abs(diff());
      let best = null;
      [W - it.h - it.y, W - it.h, 0].forEach(y => {
        if (Math.abs(y - it.y) < EPS || !free(it, y)) return;
        const old = it.y; it.y = y; const d = Math.abs(diff()); it.y = old;
        if (d < d0 - 1 && (!best || d < best.d)) best = { y, d };
      });
      if (best) { it.y = best.y; moved = true; }
    });
    if (!moved) break;
  }
}

// center of gravity from the cab (mm) and share of weight on the left side
export function loadStats(items, W) {
  const kg = items.reduce((s, i) => s + i.kg, 0);
  if (!kg) return null;
  const cg = items.reduce((s, i) => s + i.kg * (i.x + i.w / 2), 0) / kg;
  const left = items.reduce((s, i) => s + i.kg * Math.max(0, Math.min(1, (W / 2 - i.y) / i.h)), 0);
  return { cg, leftPct: Math.round(left / kg * 100) };
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
// seq = zakázky of the ID in loading order: when one vehicle is not enough they are loaded one after another,
// and the first pallet that does not fit opens the next vehicle
export function packAll(pallets, vehicles, forced, oneVehicle, seq) {
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
      // among layouts that fit in one vehicle take the best balanced one
      let pick = null;
      lists.forEach(list => {
        const bins = fillBins(list, v, [v]);
        if (bins.length !== 1 || bins[0].items.length !== items.length) return;
        const pen = imbalance(bins[0], v.Wmm);
        if (!pick || pen < pick.pen) pick = { pen, b: bins[0] };
      });
      if (pick) { best = { c: v.cost || 0, typed: [{ v, b: pick.b }] }; break; }
    }
  }
  if (!best && seq && seq.length > 1) {
    const rank = so => { const i = seq.indexOf(so); return i < 0 ? seq.length : i; };
    const order = items.slice().sort((a, b) => rank(a.so) - rank(b.so) || area(b) - area(a) || b.kg - a.kg);
    const bins = [];
    let cur = null;
    order.forEach(it => {
      if (cur && cur.kg + it.kg <= cur.v.kg && roomFor(cur)) { const pos = cur.find(it.pl, it.pw, it.rot); if (pos) { cur.place(pos, it); return; } }
      const v = bySize.find(x => fitsVehicle(it, x));
      cur = new Bin(v); bins.push(cur);
      const pos = cur.find(it.pl, it.pw, it.rot); if (pos) cur.place(pos, it);
    });
    best = { c: 0, seq: true, typed: bins.map(b => ({ v: classify(b, pool), b })) };
  }
  if (!best) primaries.forEach(P => {
    lists.forEach(list => {
      const bins = fillBins(list, P, bySize);
      let c = 0;
      const typed = bins.map(b => { const v = classify(b, pool); c += (v.cost || 0) + b.usedL / 1e7 + imbalance(b, v.Wmm); return { v, b }; });
      if (!best || c < best.c - 1e-9) best = { c, typed };
    });
  });
  const counter = new Map();
  // sequential loading keeps the vehicle order (vehicle 1 = first zakázky)
  const out = (best.seq ? best.typed : best.typed.sort((a, b) => b.v.Lmm * b.v.Wmm - a.v.Lmm * a.v.Wmm || b.b.usedL - a.b.usedL))
    .map(({ v, b }) => {
      const n = (counter.get(v.vi) || 0) + 1; counter.set(v.vi, n);
      return { vi: v.vi, type: v.type, name: v.name, n, title: v.name + ' ' + n, L: v.Lmm, W: v.Wmm, maxKg: v.kg, items: balanceLoad(b.items, v.Wmm), kg: b.kg };
    });
  return { vehicles: out, oversize };
}
