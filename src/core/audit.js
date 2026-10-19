// "Zkontrolovat a uložit": compares how the order really goes (its pallet plan) with the saved rules.
// Rules that applied to this order but are not true any more are dropped, rides without a rule get one,
// and article definitions are aligned with the pallets actually used.
import { findRules } from './combos.js';

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

export function auditOrder(order, plan, combos, catalog, project) {
  // rules of this order's project (and rules without project), in priority order
  const findRule = (code, qty, present, list) => findRules(code, qty, present, list).find(r => !low(r.project) || low(r.project) === low(project)) || null;
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

  // shared pallet (mode 'group'): more pieces than verified went on it and the operator kept it → raise the verified quantity
  const placed = new Map();
  plan.forEach(b => (b.contents || []).forEach(c => { if (c.units > 0) placed.set(low(c.code), (placed.get(low(c.code)) || 0) + c.units); }));
  const seen = [];
  lines.forEach(l => {
    const rule = findRule(l.code, l.qty, bySo.get(l.so || order.id), combos);
    if (!rule || rule.mode !== 'group') return;
    const n = placed.get(low(l.code)) || 0, i = combos.indexOf(rule);
    if (n > (rule.per || 0) && !seen.some(x => x.i === i)) seen.push({ i, code: l.code, from: rule.per || 0, to: n });
  });

  // balení pallets the operator added articles to: those articles join the balení
  const koliAdd = [];
  plan.forEach(b => {
    if (!b.group) return;
    const have = new Set(combos.filter(r => r.mode === 'group' && low(r.group) === low(b.group) && low(r.pal) === low(b.pal)).map(r => low(r.code)));
    (b.contents || []).forEach(c => {
      if (c.units > 0 && !have.has(low(c.code)) && !koliAdd.some(x => low(x.code) === low(c.code) && x.group === b.group)) koliAdd.push({ group: b.group, pal: b.pal, code: c.code, name: c.name || '', units: c.units });
    });
  });

  // mix (balení): an article of the balení that is no longer on that balení's pallet was taken out → remove it from the balení
  lines.forEach(l => {
    const rule = findRule(l.code, l.qty, bySo.get(l.so || order.id), combos);
    if (!rule || rule.mode !== 'group') return;
    const on = plan.some(b => low(b.group) === low(rule.group) && (b.contents || []).some(c => c.units > 0 && low(c.code) === low(l.code)));
    if (!on) verdict.set(combos.indexOf(rule), 'drop');
  });

  // solo: an article alone on its own pallets (not a balení pallet) without a rule → new solo rule in the order's project;
  // with a solo rule on another pallet type → change the pallet type
  const soloSeen = new Set();
  lines.forEach(l => {
    const k = low(l.code); if (soloSeen.has(k)) return; soloSeen.add(k);
    const a = catalog.find(x => low(x.code) === k); if (a && (a.pack === 'sluzba' || a.pack === 'kit')) return;
    const own = plan.filter(b => !b.group && (b.contents || []).some(c => c.units > 0 && !c.ride && low(c.code) === k) && (b.contents || []).filter(c => c.units > 0 && !c.ride).length === 1);
    if (!own.length) return;
    const types = [...new Set(own.map(b => b.pal).filter(Boolean))]; if (types.length !== 1) return;
    const rule = findRule(l.code, l.qty, bySo.get(l.so || order.id), combos);
    const per = Math.max(...own.map(b => b.contents.find(c => low(c.code) === k).units));
    if (!rule) add.set(k + '|solo', { on: true, code: l.code, withCode: '', min: 0, max: 0, mode: 'pallet', host: '', pal: types[0], pl: 0, pw: 0, per: own.length > 1 ? per : 0, kg: 0, name: l.name || (a && a.name) || '', project: project || '', note: 'Uloženo ze zakázky ' + order.id });
    else if (rule.mode === 'pallet') {
      const i = combos.indexOf(rule), ch = {};
      if (low(rule.pal) !== low(types[0])) ch.pal = types[0];
      // "Ks na paletě" as the pallets stand: several pallets → the fullest one (also lower);
      // all pieces on one pallet → only a raise (one pallet says nothing about a smaller limit)
      if (own.length > 1 ? per !== rule.per : rule.per > 0 && per > rule.per) ch.per = per;
      if (Object.keys(ch).length) update.set(i, Object.assign(update.get(i) || {}, ch));
    }
  });

  return {
    koliAdd,
    seen,
    drop: [...verdict].filter(([, v]) => v === 'drop').map(([i]) => i),
    update: [...update].map(([i, ch]) => ({ i, ch })),
    add: [...add.values()],
    defs
  };
}
