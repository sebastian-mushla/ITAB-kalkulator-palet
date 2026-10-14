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

// ---------- loading norms (as in practice) ----------
// Priority: 1) fits, weight OK  2) left/right inside tolerance and, for a heavy load, centre of gravity inside the
// zone along the body (out of norm = big penalty)  3) as few gaps as possible (compact block from the headboard).
// Inside the norms a small left/right difference does not matter – gaps do.
export const NORM_DEFAULTS = { lrTol: 60, cgMin: 35, cgMax: 60, heavyShare: 50, vehExtra: 0.3, minVeh: true };
let norms = Object.assign({}, NORM_DEFAULTS);
export function setNorms(r) { norms = Object.assign({}, NORM_DEFAULTS, r || {}); }

// how a loaded body scores against the norms (lower = better)
export function evalLoad(items, L, W, maxKg) {
  const kg = items.reduce((s, i) => s + i.kg, 0);
  if (!items.length) return { score: 0, gapPct: 0, leftPct: 50, cgPct: 0, latBad: 0, cgBad: 0, heavy: false };
  const usedL = Math.max(...items.map(i => i.x + i.w));
  const area = items.reduce((s, i) => s + i.w * i.h, 0);
  const gapPct = Math.max(0, 1 - area / (usedL * W)) * 100;
  // weights not filled in (0 kg): balance cannot be judged, but gaps and closeness to the cab still can
  const st = (kg && loadStats(items, W)) || { cg: 0, leftPct: 50 }, cgPct = st.cg / L * 100;
  const heavy = kg > 0 && maxKg > 0 && kg / maxKg * 100 >= norms.heavyShare;
  const latBad = Math.max(0, Math.abs(st.leftPct - 50) - (norms.lrTol - 50));
  const cgBad = heavy ? Math.max(0, norms.cgMin - cgPct, cgPct - norms.cgMax) : 0;
  // tie-break: the load sits as close to the cab as possible (free space stays together at the doors)
  const front = items.reduce((s, i) => s + i.w * i.h * (i.x + i.w / 2), 0) / (area * L);
  return { score: 1000 * (latBad + cgBad) + gapPct + usedL / L + front, gapPct, leftPct: st.leftPct, cgPct, latBad, cgBad, heavy };
}

// ---------- weight distribution ----------
// Keeps the layout (same slots), only decides which pallet sits where:
// 1) if the heavier half is at the doors, mirror the plan so it is at the cab (x = 0);
// 2) pallets with the same footprint swap slots: heaviest to the front, and across the width
//    the heavier one goes to the side that is lighter so far (left/right balance).
// free spot for a pallet in a loaded body (closest to the cab), or null
function spotFor(v, it) {
  const hit = (x, y, w, h, b) => x < b.x + b.w - EPS && b.x < x + w - EPS && y < b.y + b.h - EPS && b.y < y + h - EPS;
  let best = null;
  const sizes = [[it.w, it.h]].concat(it.rot !== false ? [[it.h, it.w]] : []);
  sizes.forEach(([w, h]) => {
    const xs = [0].concat(v.items.map(o => o.x + o.w)), ys = [0, v.W - h].concat(v.items.map(o => o.y + o.h), v.items.map(o => o.y - h));
    xs.forEach(x => ys.forEach(y => {
      if (x < -EPS || y < -EPS || x + w > v.L + EPS || y + h > v.W + EPS) return;
      if (v.items.some(o => hit(x, y, w, h, o))) return;
      if (!best || x < best.x - EPS || (Math.abs(x - best.x) <= EPS && y < best.y)) best = { x, y, w, h };
    }));
  });
  return best;
}
// fill the free space of the bigger vehicles from the smallest one, then give that one the cheapest body that still fits
function shrink(vs, pool) {
  if (vs.length < 2) return;
  const d = vs.slice().sort((a, b) => a.L * a.W - b.L * b.W)[0];
  const others = vs.filter(t => t !== d);
  d.items.slice().sort((a, b) => b.w * b.h - a.w * a.h).forEach(it => {
    for (const t of others) {
      if (t.maxKg > 0 && t.kg + it.kg > t.maxKg + 1e-9) continue;
      if (t.eup > 0 && t.items.length + 1 > t.eup) continue;
      const sp = spotFor(t, it);
      if (sp) { t.items.push(Object.assign({}, it, sp, { turned: sp.w !== it.w ? !it.turned : it.turned })); t.kg += it.kg; d.items = d.items.filter(x => x !== it); d.kg -= it.kg; return; }
    }
  });
  if (!d.items.length) { vs.splice(vs.indexOf(d), 1); return; }
  const cur = pool.find(v => v.vi === d.vi), list = d.items.map(i => Object.assign({}, i, { x: 0, y: 0 }));
  const cheaper = pool.filter(v => (v.cost || 0) < ((cur && cur.cost) || 0) && d.kg <= v.kg && !(v.eup > 0 && list.length > v.eup)).sort((a, b) => (a.cost || 0) - (b.cost || 0));
  for (const v of cheaper) {
    if (!list.every(it => fitsVehicle(it, v))) continue;
    const bins = fillBins(list.slice().sort((a, b) => b.pl * b.pw - a.pl * a.pw), v, [v]);
    if (bins.length === 1 && bins[0].items.length === list.length) {
      Object.assign(d, { vi: v.vi, type: v.type, name: v.name, L: v.Lmm, W: v.Wmm, maxKg: v.kg, eup: v.eup, items: balanceLoad(bins[0].items, v.Wmm, v.Lmm, v.kg) });
      return;
    }
  }
}
// move all pallets of a smaller vehicle into the others when they fit (space, payload, pallet count); repeat
function absorb(vs) {
  for (let changed = true; changed;) {
    changed = false;
    const donors = vs.slice().sort((a, b) => a.L * a.W - b.L * b.W);
    for (const d of donors) {
      if (vs.length < 2) return;
      const targets = vs.filter(t => t !== d).map(t => ({ t, items: t.items.map(i => Object.assign({}, i)), kg: t.kg }));
      const ok = d.items.slice().sort((a, b) => b.w * b.h - a.w * a.h).every(it => {
        for (const g of targets) {
          if (g.t.maxKg > 0 && g.kg + it.kg > g.t.maxKg + 1e-9) continue;
          if (g.t.eup > 0 && g.items.length + 1 > g.t.eup) continue;
          const sp = spotFor({ items: g.items, L: g.t.L, W: g.t.W }, it);
          if (sp) { g.items.push(Object.assign({}, it, sp, { turned: sp.w !== it.w ? !it.turned : it.turned })); g.kg += it.kg; return true; }
        }
        return false;
      });
      if (!ok) continue;
      targets.forEach(g => { g.t.items = g.items; g.t.kg = g.kg; });
      vs.splice(vs.indexOf(d), 1); changed = true; break;
    }
  }
}
// fill holes near the cab: every pallet (from the doors) tries the free spot closest to the cab in ANY row
function pullForward(items, W) {
  const hit = (a, x, y, b) => a !== b && x < b.x + b.w - EPS && b.x < x + a.w - EPS && y < b.y + b.h - EPS && b.y < y + a.h - EPS;
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    items.slice().sort((a, b) => b.x - a.x).forEach(it => {
      const xs = [0].concat(items.map(o => o.x + o.w)).filter(x => x < it.x - EPS);
      const ys = [0, W - it.h].concat(items.map(o => o.y + o.h), items.map(o => o.y - it.h)).filter(y => y >= -EPS && y + it.h <= W + EPS);
      let best = null;
      xs.forEach(x => ys.forEach(y => {
        if (items.some(o => hit(it, x, y, o))) return;
        if (!best || x < best.x - EPS || (Math.abs(x - best.x) <= EPS && y < best.y)) best = { x, y };
      }));
      if (best) { it.x = best.x; it.y = Math.max(0, best.y); moved = true; }
    });
    if (!moved) break;
  }
}
function compactToCab(items) {
  const hit = (a, x, b) => a !== b && x < b.x + b.w - EPS && b.x < x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    items.slice().sort((a, b) => a.x - b.x).forEach(it => {
      const cands = [0].concat(items.map(o => o.x + o.w)).filter(x => x < it.x - EPS).sort((a, b) => a - b);
      const nx = cands.find(x => !items.some(o => hit(it, x, o)));
      if (nx != null) { it.x = nx; moved = true; }
    });
    if (!moved) break;
  }
}
export function balanceLoad(items, W, L, maxKg) {
  if (!items.length) return items;
  let out = items.map(i => Object.assign({}, i));
  const usedL = Math.max(...out.map(i => i.x + i.w));
  const kg = out.reduce((s, i) => s + i.kg, 0) || 1;
  const cg = out.reduce((s, i) => s + i.kg * (i.x + i.w / 2), 0) / kg;
  // light load: heavy end to the headboard; heavy load: only if that keeps the centre of gravity in the zone
  if (cg > usedL / 2 + 1) {
    const mirrored = out.map(i => Object.assign({}, i, { x: usedL - i.x - i.w }));
    if (!L || evalLoad(mirrored, L, W, maxKg).cgBad <= evalLoad(out, L, W, maxKg).cgBad) out = mirrored;
  }
  // mirroring rows of different lengths leaves a gap at the headboard: push every pallet towards the cab while it is free
  compactToCab(out);
  pullForward(out, W);
  compactToCab(out);
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
  // heavy load with the centre of gravity too far forward (front axle / kingpin overloaded): move the whole block back
  if (L && maxKg) {
    const e = evalLoad(out, L, W, maxKg);
    if (e.heavy && e.cgPct < norms.cgMin) {
      const room = L - Math.max(...out.map(i => i.x + i.w)), need = (norms.cgMin - e.cgPct) / 100 * L;
      const dx = Math.max(0, Math.min(room, need));
      if (dx > 0) out.forEach(i => { i.x += dx; });
    }
  }
  // sideways sliding opens gaps, so only when left/right is out of tolerance
  const st0 = loadStats(out, W); // null when the load weighs nothing (weights not filled in yet)
  if (st0 && Math.abs(st0.leftPct - 50) > norms.lrTol - 50) slideAcross(out, W);
  return out;
}

// small tie-break cost: how far left/right is from 50/50 after balancing (never outweighs a vehicle's price)
// tie-break only: a better balanced layout wins between options of the same price, never over a cheaper set of vehicles
// (score can reach 1e5 when a norm is broken, e.g. light loads with weights not filled in → at most 0.01 here)
function imbalance(b, W, L, maxKg) {
  return Math.min(1e5, evalLoad(balanceLoad(b.items, W, L, maxKg), L || b.L, W, maxKg || 0).score) / 1e7;
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
      [W - it.h - it.y, W - it.h, 0, (W - it.h) / 2].forEach(y => {
        if (Math.abs(y - it.y) < EPS || !free(it, y)) return;
        const old = it.y; it.y = y; const d = Math.abs(diff()); it.y = old;
        if (d < d0 - 1 && (!best || d < best.d)) best = { y, d };
      });
      if (best) { it.y = best.y; moved = true; }
    });
    if (!moved) break;
  }
}

function relayout(bin, v) {
  const items = bin.items.map(i => Object.assign({}, i, { x: 0, y: 0 }));
  if (items.length < 2) return null;
  const area = i => i.pl * i.pw;
  const lists = [
    items.slice().sort((a, b) => b.kg - a.kg),
    items.slice().sort((a, b) => area(b) - area(a)),
    items.slice().sort((a, b) => Math.min(a.pl, a.pw) - Math.min(b.pl, b.pw) || b.kg - a.kg),
    items.slice().sort((a, b) => b.kg / area(b) - a.kg / area(a))
  ];
  const rng = mulberry32(777);
  for (let t = 0; t < 40; t++) lists.push(items.map(i => ({ i, k: (i.kg + 1) * (0.5 + rng()) })).sort((a, b) => b.k - a.k).map(x => x.i));
  let best = { pen: imbalancePct(bin, v.Wmm, v.Lmm, v.kg), bin };
  lists.forEach(list => {
    const bins = fillBins(list, v, [v]);
    if (bins.length !== 1 || bins[0].items.length !== items.length) return;
    const pen = imbalancePct(bins[0], v.Wmm, v.Lmm, v.kg);
    if (pen < best.pen - 0.01) best = { pen, bin: bins[0] };
  });
  return best.bin === bin ? null : best.bin;
}
function imbalancePct(b, W, L, maxKg) { return evalLoad(balanceLoad(b.items, W, L, maxKg), L, W, maxKg).score; }

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

// a body filled in a wide vehicle may still fit a cheaper, narrower one when laid out again
function downsize(b, pool) {
  let v0 = classify(b, pool);
  const items = b.items.map(i => Object.assign({}, i, { x: 0, y: 0 }));
  const area = i => i.pl * i.pw;
  const cands = pool.filter(v => (v.cost || 0) < (v0.cost || 0) && b.kg <= v.kg && !(v.eup > 0 && items.length > v.eup)).sort((x, y) => (x.cost || 0) - (y.cost || 0));
  for (const v of cands) {
    for (const list of [items.slice().sort((x, y) => area(y) - area(x)), items.slice().sort((x, y) => Math.max(y.pl, y.pw) - Math.max(x.pl, x.pw))]) {
      if (!list.every(it => fitsVehicle(it, v))) break;
      const bins = fillBins(list, v, [v]);
      if (bins.length === 1 && bins[0].items.length === items.length) return { v, b: bins[0] };
    }
  }
  return { v: v0, b };
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
// the same pallets on the same fleet with the same rules always give the same result: remember the last ones
// (check & save, background recalcs and redraws ask for the same order many times)
const packCache = new Map();
export function packAll(pallets, vehicles, forced, oneVehicle, seq, rules) {
  const key = JSON.stringify([pallets, vehicles, forced, oneVehicle, seq, rules && [rules.lrTol, rules.cgMin, rules.cgMax, rules.heavyShare, rules.minVeh, rules.vehExtra]]);
  const hit = packCache.get(key);
  if (hit) return JSON.parse(hit);
  const res = packAllRaw(pallets, vehicles, forced, oneVehicle, seq, rules);
  packCache.set(key, JSON.stringify(res));
  if (packCache.size > 300) packCache.delete(packCache.keys().next().value);
  return res;
}
function packAllRaw(pallets, vehicles, forced, oneVehicle, seq, rules) {
  setNorms(rules);
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
  const rng = mulberry32(12345), tries = Math.max(10, Math.min(80, Math.floor(2000 / items.length)));
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
        const pen = imbalance(bins[0], v.Wmm, v.Lmm, v.kg);
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
    best = { c: 0, seq: true, typed: bins.map(b => downsize(b, pool)) };
  }
  if (!best) primaries.forEach(P => {
    lists.forEach(list => {
      const bins = fillBins(list, P, bySize);
      let c = 0;
      const typed = bins.map(b0 => { const { v, b } = downsize(b0, pool); c += (v.cost || 0) + b.usedL / 1e7 + imbalance(b, v.Wmm, v.Lmm, v.kg); return { v, b }; });
      // every extra vehicle costs something on top (loading, paperwork, dock time): fewer vehicles win when prices are close
      // rule „co nejméně vozidel“: the number of vehicles decides first, price only between sets of the same size
      c += Math.max(0, typed.length - 1) * (norms.minVeh !== false ? 1000 : (norms.vehExtra || 0));
      if (!best || c < best.c - 1e-9) best = { c, typed };
    });
  });
  const counter = new Map();
  // every vehicle: try other layouts of the same pallets and keep the best balanced one that still fits
  best.typed.forEach(t => { const nb = relayout(t.b, t.v); if (nb) t.b = nb; });
  // sequential loading keeps the vehicle order (vehicle 1 = first zakázky)
  const out = (best.seq ? best.typed : best.typed.sort((a, b) => b.v.Lmm * b.v.Wmm - a.v.Lmm * a.v.Wmm || b.b.usedL - a.b.usedL))
    .map(({ v, b }) => {
      const n = (counter.get(v.vi) || 0) + 1; counter.set(v.vi, n);
      return { vi: v.vi, type: v.type, name: v.name, n, title: v.name + ' ' + n, L: v.Lmm, W: v.Wmm, maxKg: v.kg, eup: v.eup, items: balanceLoad(b.items, v.Wmm, v.Lmm, v.kg), kg: b.kg };
    });
  // after the final (tighter) layout there may be room left: empty a smaller vehicle into the free space of the others
  if (forced == null) { absorb(out); shrink(out, pool); }
  // pallets moved out of a vehicle leave holes: pull what is left towards the cab again
  out.forEach(v => { compactToCab(v.items); pullForward(v.items, v.W); compactToCab(v.items); });
  const cnt = new Map();
  out.forEach(v => { const n = (cnt.get(v.vi) || 0) + 1; cnt.set(v.vi, n); v.n = n; v.title = v.name + ' ' + n; delete v.eup; });
  return { vehicles: out, oversize };
}
