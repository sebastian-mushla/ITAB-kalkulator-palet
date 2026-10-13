// "Zkontrolovat a uložit": compares how the order really goes (its pallet plan) with the saved rules.
// Rules that applied to this order but are not true any more are dropped, rides without a rule get one,
// and article definitions are aligned with the pallets actually used.
import { findRule } from './combos.js';

const low = s => String(s == null ? '' : s).trim().toLowerCase();

// main article of a pallet = biggest non-riding content
function mainOf(b) {
  const list = (b.contents || []).filter(c => c.units > 0 && !c.ride);
  return list.sort((a, c) => c.units / (c.per || 1) - a.units / (a.per || 1))[0] || null;
}

// plan → { so|code: { hosts: Map(hostLow → { host, units, maxPer }) } } for pieces riding on another article's pallet
function ridesOf(plan) {
  const out = new Map();
  plan.forEach(b => {
    const m = mainOf(b); if (!m) return;
    b.contents.forEach(c => {
      if (!c.ride || !(c.units > 0)) return;
      const k = low(c.so) + '|' + low(c.code);
      const g = out.get(k) || { code: c.code, name: c.name || '', kg: c.kg || 0, hosts: new Map() };
      const h = g.hosts.get(low(m.code)) || { host: m.code, units: 0, maxPer: 0 };
      h.units += c.units; h.maxPer = Math.max(h.maxPer, c.units);
      g.hosts.set(low(m.code), h); out.set(k, g);
    });
  });
  return out;
}

export function auditOrder(order, plan, combos, catalog) {
  const lines = [...order.lines.values()];
  const rides = ridesOf(plan);
  const verdict = new Map(); // combo index → 'keep' | 'drop'
  const add = new Map(), update = new Map();
  const bySo = new Map();
  lines.forEach(l => { const so = l.so || order.id; if (!bySo.has(so)) bySo.set(so, new Set()); bySo.get(so).add(low(l.code)); });

  lines.forEach(l => {
    const so = l.so || order.id, present = bySo.get(so);
    const rule = findRule(l.code, l.qty, present, combos), i = rule ? combos.indexOf(rule) : -1;
    const g = rides.get(low(so) + '|' + low(l.code));
    // where the pieces really ride (the host carrying most of them)
    const best = g ? [...g.hosts.values()].sort((a, b) => b.units - a.units)[0] : null;
    if (rule && rule.mode === 'host') {
      if (best && low(best.host) === low(rule.host)) {
        verdict.set(i, 'keep');
        if (rule.per > 0 && best.maxPer > rule.per) update.set(i, { per: best.maxPer });
        if (rule.max > 0 && l.qty > rule.max) update.set(i, Object.assign(update.get(i) || {}, { max: l.qty }));
        return;
      }
      if (verdict.get(i) !== 'keep') verdict.set(i, 'drop');
    } else if (rule) return; // other kinds of rules are not checked here
    if (best) {
      const k = low(l.code) + '|' + low(best.host);
      const prev = add.get(k);
      add.set(k, { on: true, code: l.code, withCode: best.host, min: 0, max: Math.max(l.qty, prev ? prev.max : 0), mode: 'host', host: best.host, pl: 0, pw: 0,
        per: Math.max(best.maxPer, prev ? prev.per : 0), kg: g.kg, name: g.name || l.name || '', note: 'Uloženo ze zakázky ' + order.id });
    }
  });

  // article definitions: an article alone on its pallets of another type than in the catalog
  const defs = [];
  catalog.forEach(a => {
    if (a.pack === 'balik') return;
    const own = plan.filter(b => { const list = (b.contents || []).filter(c => c.units > 0 && !c.ride); return list.length === 1 && low(list[0].code) === low(a.code); });
    if (!own.length) return;
    const types = [...new Set(own.map(b => b.pal).filter(Boolean))];
    if (types.length === 1 && low(types[0]) !== low(a.pal)) defs.push({ code: a.code, pal: types[0], was: a.pal || '' });
  });

  // koli: more pieces than verified went on the pallet and the operator kept it → raise the verified quantity
  const placed = new Map();
  plan.forEach(b => (b.contents || []).forEach(c => { if (c.units > 0) placed.set(low(c.code), (placed.get(low(c.code)) || 0) + c.units); }));
  const seen = [];
  combos.forEach((k, i) => {
    if (k.mode !== 'kolo' || k.on === false) return;
    (k.items || []).forEach(it => {
      const n = placed.get(low(it.code)) || 0;
      if (n > (it.seen || 0)) seen.push({ i, code: it.code, from: it.seen || 0, to: n });
    });
  });

  return {
    seen,
    drop: [...verdict].filter(([, v]) => v === 'drop').map(([i]) => i),
    update: [...update].map(([i, ch]) => ({ i, ch })),
    add: [...add.values()],
    defs
  };
}
