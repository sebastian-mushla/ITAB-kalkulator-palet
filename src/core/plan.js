// Manual pallet plan of one order: once the operator edits pallets, the order's pallets come from here, not from the calculation.
// plan = [{ id, pal, custom?, contents: [{ code, name, units, per, kg, ride? }] }]
// per = pcs that fill the whole pallet (for the fill %), kg = weight of one piece, ride = sits on top, does not count to fill.
import { typeOf } from './palletTypes.js';
import { isEuro } from './util.js';

const low = s => String(s == null ? '' : s).trim().toLowerCase();
let seq = 0;
export const newId = () => 'p' + Date.now().toString(36) + (seq++);

function unitInfo(code, catalog, rows) {
  const a = catalog.find(x => low(x.code) === low(code));
  if (a) return { per: a.per || 1, kg: a.kg || 0, name: a.name || '' };
  const row = rows.find(x => low(x.code) === low(code));
  return { per: row && row.per ? row.per : 1, kg: row && row.qty ? row.kg / row.qty : 0, name: row ? row.name || '' : '' };
}

// Current calculated pallets → editable plan.
export function freezePlan(r, catalog) {
  return r.pallets.map(p => {
    const main = Object.assign({ code: p.code, units: p.units }, unitInfo(p.code, catalog, r.rows));
    if (p.board) { main.per = p.units / (p.fill || 1); }
    const extra = (p.extra || []).map(e => Object.assign({ code: e.code, units: e.units, ride: !e.mixed }, unitInfo(e.code, catalog, r.rows)));
    const pl = { id: newId(), pal: p.pal || null, contents: [main].concat(extra) };
    if (!p.pal) pl.custom = { code: 'JINÁ', name: 'Paleta ' + Math.round(p.pl / 10) + ' × ' + Math.round(p.pw / 10), L: p.pl, W: p.pw, H: p.palH || 0, tare: p.tare || 0, maxKg: p.maxKg || 0, rot: p.rot !== false };
    return pl;
  });
}

// Plan → pallets the rest of the app understands (code/units = biggest article, others in extra).
export function planPallets(plan, types, ci) {
  const out = [];
  plan.forEach(b => {
    const t = typeOf(types, b.pal) || b.custom;
    const list = (b.contents || []).filter(c => c.units > 0);
    if (!t || !list.length) return;
    const sorted = list.slice().sort((a, c) => (a.ride ? 1 : 0) - (c.ride ? 1 : 0) || c.units / (c.per || 1) - a.units / (a.per || 1));
    const [m, ...rest] = sorted;
    out.push({
      code: m.code, units: m.units, fill: list.filter(c => !c.ride).reduce((s, c) => s + c.units / (c.per || c.units), 0),
      kg: (t.tare || 0) + list.reduce((s, c) => s + c.units * (c.kg || 0), 0), tare: t.tare || 0,
      pl: t.L, pw: t.W, rot: t.rot !== false, euro: isEuro({ pl: t.L, pw: t.W }), ci: ci(m.code), pal: b.pal || t.code, palName: t.name, palH: t.H || 0, maxKg: t.maxKg || 0,
      extra: rest.length ? rest.map(c => ({ code: c.code, units: c.units, ci: ci(c.code), mixed: !c.ride })) : undefined, board: b.id
    });
  });
  return out;
}

// Move `qty` pcs of `code` from pallet `fromId` to pallet `toId` ('new' = new pallet of the same type).
export function moveUnits(plan, fromId, code, qty, toId) {
  const from = plan.find(b => b.id === fromId); if (!from) return false;
  const c = from.contents.find(x => low(x.code) === low(code)); if (!c) return false;
  qty = Math.min(Math.max(1, Math.round(qty)), c.units);
  let to = toId === 'new' ? null : plan.find(b => b.id === toId);
  if (!to) { to = { id: newId(), pal: from.pal, custom: from.custom, contents: [] }; plan.push(to); }
  if (to === from) return false;
  c.units -= qty;
  const d = to.contents.find(x => low(x.code) === low(code));
  if (d) d.units += qty; else to.contents.push(Object.assign({}, c, { units: qty }));
  from.contents = from.contents.filter(x => x.units > 0);
  return to.id;
}

export function setPalletType(plan, id, pal, custom) {
  const b = plan.find(x => x.id === id); if (!b) return;
  b.pal = pal; if (custom) b.custom = custom; else delete b.custom;
}

export function removePallet(plan, id) {
  const i = plan.findIndex(b => b.id === id);
  if (i < 0 || plan[i].contents.some(c => c.units > 0)) return false;
  plan.splice(i, 1); return true;
}

// Order quantity that is not on any pallet of the plan (per article).
export function unplaced(lines, plan) {
  const placed = new Map();
  plan.forEach(b => b.contents.forEach(c => placed.set(low(c.code), (placed.get(low(c.code)) || 0) + c.units)));
  return lines.map(l => ({ code: l.code, name: l.name || '', qty: l.qty - (placed.get(low(l.code)) || 0) })).filter(x => x.qty > 0);
}
