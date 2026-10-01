// Manual loading plan: the operator drags pallets between vehicles and adds vehicles.
// manual = { vehicles: [{ vi, items: [pallet with x, y, w, h in mm] }] }
import { EPS } from './util.js';
import { recoText } from './solve.js';

const dims = (vehicles, vi) => { const d = vehicles[vi] || {}; return { L: (d.L || 0) * 1000, W: (d.W || 0) * 1000 }; };
const overlaps = (a, b) => a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;

export function fromResult(r) {
  return { vehicles: r.vehicles.map(v => ({ vi: v.vi, items: v.items.map(i => Object.assign({}, i)) })) };
}

// Nearest free spot to (wantX, wantY) for a w × h pallet (optionally also turned).
export function placeNear(L, W, items, it, wantX, wantY, orients) {
  let best = null;
  orients.forEach(([w, h]) => {
    if (w > L + EPS || h > W + EPS) return;
    const clamp = (v, max) => Math.max(0, Math.min(max, v));
    const snap = v => Math.round(v / 50) * 50;
    const xs = new Set([clamp(snap(wantX), L - w), 0, L - w]), ys = new Set([clamp(snap(wantY), W - h), 0, W - h]);
    items.forEach(o => { xs.add(o.x + o.w); xs.add(o.x - w); ys.add(o.y + o.h); ys.add(o.y - h); xs.add(o.x); ys.add(o.y); });
    xs.forEach(x => ys.forEach(y => {
      if (x < -EPS || y < -EPS || x + w > L + EPS || y + h > W + EPS) return;
      const cand = { x, y, w, h };
      if (items.some(o => overlaps(cand, o))) return;
      const d = (x - wantX) ** 2 + (y - wantY) ** 2;
      if (!best || d < best.d) best = { x, y, w, h, d };
    }));
  });
  return best;
}

function orientsOf(it, keepTurned) {
  const cur = [it.w, it.h], other = [it.h, it.w];
  if (!it.rot || it.w === it.h) return [cur];
  return keepTurned ? [cur, other] : [other];
}

// Move pallet `pid` from vehicle index `from` to `to`, as close to (x, y) as possible. Returns false if it does not fit.
export function movePallet(manual, vehicles, from, pid, to, x, y) {
  const src = manual.vehicles[from], dst = manual.vehicles[to];
  if (!src || !dst) return false;
  const k = src.items.findIndex(i => i.id === pid); if (k < 0) return false;
  const it = src.items[k];
  const others = dst.items.filter(i => i !== it);
  const { L, W } = dims(vehicles, dst.vi);
  const pos = placeNear(L, W, others, it, x, y, orientsOf(it, true));
  if (!pos) return false;
  src.items.splice(k, 1);
  dst.items.push(Object.assign({}, it, { x: pos.x, y: pos.y, w: pos.w, h: pos.h, turned: pos.w !== it.pl }));
  return true;
}

export function rotatePallet(manual, vehicles, v, pid) {
  const veh = manual.vehicles[v]; if (!veh) return false;
  const it = veh.items.find(i => i.id === pid); if (!it || !it.rot) return false;
  const { L, W } = dims(vehicles, veh.vi);
  const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
  const pos = placeNear(L, W, veh.items.filter(i => i !== it), it, cx - it.h / 2, cy - it.w / 2, orientsOf(it, false));
  if (!pos) return false;
  Object.assign(it, { x: pos.x, y: pos.y, w: pos.w, h: pos.h, turned: pos.w !== it.pl });
  return true;
}

// Add an empty vehicle; when the order had none yet (groupage), its pallets are loaded into it.
export function addVehicle(manual, vehicles, vi, pallets) {
  if (!manual.vehicles.length && pallets && pallets.length) {
    const { L, W } = dims(vehicles, vi);
    let cur = { vi, items: [] }; manual.vehicles.push(cur);
    pallets.forEach((p, i) => {
      const it = Object.assign({ id: i }, p, { w: p.pl, h: p.pw });
      let pos = placeNear(L, W, cur.items, it, 0, 0, it.rot ? [[p.pl, p.pw], [p.pw, p.pl]] : [[p.pl, p.pw]]);
      if (!pos && cur.items.length) { cur = { vi, items: [] }; manual.vehicles.push(cur); pos = placeNear(L, W, [], it, 0, 0, it.rot ? [[p.pl, p.pw], [p.pw, p.pl]] : [[p.pl, p.pw]]); }
      if (pos) cur.items.push(Object.assign(it, { x: pos.x, y: pos.y, w: pos.w, h: pos.h }));
    });
    return;
  }
  manual.vehicles.push({ vi, items: [] });
}

export function removeVehicle(manual, v) {
  if (!manual.vehicles[v] || manual.vehicles[v].items.length) return false;
  manual.vehicles.splice(v, 1);
  return true;
}

// Result as the screen shows it: solver result with the manual vehicles swapped in.
export function viewOf(r, manual, vehicles) {
  if (!manual) return r;
  const counter = new Map();
  const vs = manual.vehicles.map((m, idx) => {
    const d = vehicles[m.vi] || { name: 'Vozidlo', L: 0, W: 0, kg: 0, type: 'jine' };
    const n = (counter.get(m.vi) || 0) + 1; counter.set(m.vi, n);
    return { idx, vi: m.vi, type: d.type, name: d.name, n, title: d.name + ' ' + n, L: d.L * 1000, W: d.W * 1000, maxKg: d.kg, lift: d.lift, items: m.items, kg: m.items.reduce((s, i) => s + i.kg, 0) };
  });
  const used = vs.filter(v => v.items.length);
  const overweight = vs.filter(v => v.kg > v.maxKg + 1e-9);
  const mode = r.mode === 'empty' ? 'empty' : (r.oversize && r.oversize.length ? 'warn' : 'trucks');
  return Object.assign({}, r, {
    vehicles: vs, reco: recoText(used), manualOn: true, overweight, mode,
    stat: used.length + ' ' + (used.length === 1 ? 'vozidlo' : used.length >= 2 && used.length <= 4 ? 'vozidla' : 'vozidel') + ' (ručně)'
  });
}
