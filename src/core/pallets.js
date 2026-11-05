import { isEuro } from './util.js';
import { findRule, findRules, ruleText, koliOf } from './combos.js';
import { resolveArticle, typeOf } from './palletTypes.js';

// Splits order lines into full pallets + one partial pallet per article, or into parcels for pack = 'balik'.
// combos (Způsob balení tab) can override this per order; see combos.js.
// types = pallet types (level 2); opts.mix = put leftovers of different articles on one pallet of the same type
export function makePallets(lines, catalog, combos = [], types = [], opts = {}) {
  const pallets = [], parcels = [], errors = [], rows = [], unknown = [];
  const index = new Map(catalog.map((a, i) => [String(a.code).trim().toLowerCase(), i]));
  const present = new Set(lines.map(l => l.code.toLowerCase()));
  const riders = [];

  function build(a, idx, qty, row) {
    // safety: no / bad "Ks na paletě" = everything on one pallet; never thousands of pallets (page would freeze)
    if (!(a.per > 0) || !isFinite(a.per)) a = Object.assign({}, a, { per: Math.max(1, qty) });
    if (qty / a.per > 2000) { errors.push(a.code + ': ' + qty + ' ks po ' + a.per + ' ks = víc než 2000 palet – zkontrolujte „Standardní množství“. Počítáno vše na jedné paletě.'); a = Object.assign({}, a, { per: Math.max(1, qty) }); }
    let full = Math.floor(qty / a.per), rem = qty % a.per;
    // Max ks na paletě (a.top > standard): a small remainder is first added to the full pallets up to the max,
    // only what does not fit goes on its own pallet (or into a mix); a big remainder (≥ topLimit % of a pallet) stays
    const lim = (a.topLim > 0 ? a.topLim : 50) / 100; // per Solo P. rule, default 50 %
    const tops = [];
    if (a.top > a.per && full > 0 && rem > 0 && rem / a.per < lim) {
      for (let i = 0; i < full && rem > 0; i++) { const add = Math.min(rem, a.top - a.per); tops.push(a.per + add); rem -= add; }
    }
    const parcel = a.pack === 'balik';
    const tare = parcel ? 0 : (a.tare || 0);
    const mk = units => ({ code: a.code, units, fill: units / a.per, kg: tare + units * (a.kg || 0), tare, pl: a.pl, pw: a.pw, rot: !!a.rot, euro: !parcel && isEuro(a), ci: idx, pal: parcel ? null : (a.pal || null), palName: a.palName || '', palH: a.palH || 0, maxKg: a.maxKg || 0, noKg: !(a.kg > 0) });
    const target = parcel ? parcels : pallets;
    for (let i = 0; i < full; i++) target.push(i < tops.length ? Object.assign(mk(tops[i]), { fill: 1, topped: tops[i] - a.per }) : mk(a.per));
    if (rem > 0) target.push(mk(rem));
    return Object.assign(row, { pack: parcel ? 'balik' : 'paleta', full, rem, per: a.per, fillRem: rem / a.per, count: full + (rem > 0 ? 1 : 0), pal: parcel ? null : (a.pal || null), palName: a.palName || '', pl: a.pl, pw: a.pw });
  }

  const groups = new Map(); // shared pallets (mode 'group'): group|pal → articles
  // shared pallet (balení): the first matching row of the table decides, nothing hidden; „Max ks“ (cap) is a hard limit
  const overCap = (rule, qty) => rule.cap > 0 && qty > rule.cap;
  const capHint = rule => 'nevešlo se do ' + rule.group + (rule.project ? ' · ' + rule.project : '') + ' · ' + rule.pal + ' (max ' + rule.cap + ' ks)';
  function addGroup(rule, a, idx, l) {
    const k = low(rule.group) + '|' + low(rule.pal);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push({ rule, code: a.code || l.code, name: a.name || l.name || '', kg: rule.kg > 0 ? rule.kg : (a.kg || 0), qty: l.qty, ci: idx >= 0 ? idx : catalog.length + 200 + groups.size });
  }
  const spill = [];
  lines.forEach(l => {
    const idx = index.has(l.code.toLowerCase()) ? index.get(l.code.toLowerCase()) : -1;
    let solo = null;
    if (idx < 0) {
      // not in the catalog yet: it can still ride on a host pallet if a Způsob balení rule says so
      const r0 = findRule(l.code, l.qty, present, combos);
      if (r0 && r0.mode === 'group' && overCap(r0, l.qty)) { spill.push({ l, rule: r0 }); l = Object.assign({}, l, { qty: r0.cap }); }
      if (r0 && r0.mode === 'group') { addGroup(r0, { code: l.code, name: r0.name || l.name || '', kg: r0.kg || 0 }, -1, l); return; }
      if (r0 && r0.mode === 'host') {
        const a0 = { code: l.code, name: r0.name || l.name || '', kg: r0.kg || 0, per: 0, pl: 0, pw: 0, unknown: true };
        const ci = catalog.length + unknown.length + riders.length;
        const row = { code: l.code, name: a0.name, qty: l.qty, kg: l.qty * a0.kg, ci, rule: ruleText(r0) };
        riders.push({ a: a0, idx: ci, qty: l.qty, rule: r0, row }); rows.push(row); return;
      }
      // solo / balík rule from Způsob balení: the article does not need to be in the catalog
      if (r0 && (r0.mode === 'pallet' || r0.mode === 'parcel')) { solo = { code: l.code, name: r0.name || l.name || '', kg: r0.kg || 0, rot: true }; }
      else {
      unknown.push({ code: l.code, qty: l.qty, name: l.name || '' });
      errors.push('Artikl „' + l.code + '“ není v číselníku, nebyl spočítán.'); return;
      }
    }
    const ci = idx >= 0 ? idx : catalog.length + 300 + rows.length;
    let a = idx >= 0 ? resolveArticle(catalog[idx], types) : solo;
    const rule = findRule(a.code, l.qty, present, combos);
    const row = { code: a.code, name: a.name, qty: l.qty, kg: l.qty * (a.kg || 0), ci: ci, rule: rule ? ruleText(rule) : null };
    if (rule && rule.mode === 'group') {
      // more pieces than the balení may carry: all of them wait on the right, labelled with the balení
      // more pieces than the balení may carry: max goes on the balení pallet, the rest is calculated again (next rules, otherwise right side)
      if (overCap(rule, l.qty)) { spill.push({ l, rule }); l = Object.assign({}, l, { qty: rule.cap }); row.qty = rule.cap; }
      addGroup(rule, a, ci, l); return;
    }
    // packing not decided yet (article known from a balení): rides only by a rule, otherwise waits on the right side
    // a service (freight, handling fee): counted in the order, nothing to load
    // kit item: part of a set, ignored like a service
    if (a.pack === 'sluzba' || a.pack === 'kit') { rows.push(Object.assign(row, { pack: a.pack, kg: 0, full: 0, rem: 0, per: 0, fillRem: 0, count: 0 })); return; }
    if (a.pack === 'neurceno' && !(rule && rule.mode !== 'group')) {
      unknown.push({ code: l.code, qty: l.qty, name: a.name || l.name || '', known: true, undecided: true });
      errors.push('Artikl „' + l.code + '“: balení není určeno – zařaďte ho na ploše níže.'); return;
    }
    if (rule && rule.mode === 'host') { riders.push({ a: a.pack === 'neurceno' ? Object.assign({}, a, { unknown: true }) : a, idx: ci, qty: l.qty, rule, row }); rows.push(row); return; }
    if (rule && rule.mode === 'pallet') a = rule.pal && typeOf(types, rule.pal)
      ? resolveArticle(Object.assign({}, a, { pack: 'paleta', pal: rule.pal, per: rule.per || l.qty, top: rule.top || 0, topLim: rule.topLim || 0 }), types)
      : Object.assign({}, a, { pack: 'paleta', pal: null, palName: '', tare: 0, pl: rule.pl || a.pl, pw: rule.pw || a.pw, per: rule.per || l.qty, top: rule.top || 0, topLim: rule.topLim || 0 });
    if (rule && rule.mode === 'parcel') a = Object.assign({}, a, { pack: 'balik', pl: rule.pl || a.pl, pw: rule.pw || a.pw, per: rule.per || l.qty });
    if (!(a.per > 0) || !(a.pl > 0) || !(a.pw > 0)) { errors.push('U artiklu „' + a.code + '“ chybí rozměry nebo počet kusů.'); return; }
    rows.push(build(a, ci, l.qty, row));
  });

  // shared pallets: every group = one pallet of its type with all its articles; per is only "verified"
  // přibal whose main item has no own pallet in this order (not ordered, or it rides in a balení): the Hl.+přibal rule
  // cannot apply – the next rule decides (mix balení, solo), otherwise the right side
  for (let k = riders.length - 1; k >= 0; k--) {
    const { a, idx, qty, rule, row } = riders[k];
    if (!rule.strict) continue;
    const strict = findRules(a.code, qty, present, combos).filter(r => r.mode === 'host' && r.strict);
    if (strict.some(r => pallets.some(p => low(p.code) === low(r.host)))) continue;
    riders.splice(k, 1); rows.splice(rows.indexOf(row), 1);
    const l0 = lines.find(l => low(l.code) === low(a.code)) || { code: a.code, qty, name: a.name };
    const next = findRules(a.code, qty, present, combos).find(r => !(r.mode === 'host' && r.strict));
    if (next && next.mode === 'group' && !overCap(next, qty)) { addGroup(next, a, idx, l0); continue; }
    spill.push({ l: Object.assign({}, l0, { qty }), rules: strict, rest: qty, hint: 'hlavní položka ' + strict.map(r => r.host).join(', ') + ' nemá v zakázce vlastní paletu' });
  }
  // Mix balení: whole pallets and the mix on one level. Capacity of an article = "Ks na paletě" of its Solo P.
  // rule on the same pallet type. First full pallets, then the remainders (each a fraction of a pallet) are
  // packed together on as few pallets of the balení type as possible (fill ≤ 100 %, ≤ max weight).
  // Without the capacity of some article the balení cannot be judged: everything on one pallet, marked orange.
  const capOf = (code, pal) => {
    const rs = combos.filter(r => r.on !== false && r.mode === 'pallet' && low(r.code) === low(code) && low(r.pal) === low(pal) && r.per > 0);
    const r = rs.find(r => r.project) || rs[0] || {};
    return { per: r.per || 0, top: r.top > r.per ? r.top : 0, lim: r.topLim > 0 ? r.topLim : 50 };
  };
  groups.forEach(list => {
    const r0 = list[0].rule, t = typeOf(types, r0.pal);
    if (!t) { list.forEach(g => errors.push('Artikl „' + g.code + '“: typ palety ' + r0.pal + ' pro společnou paletu ' + r0.group + ' neexistuje.')); return; }
    const tare = t.tare || 0;
    const base = { tare, pl: t.L, pw: t.W, rot: t.rot !== false, euro: isEuro({ pl: t.L, pw: t.W }), pal: t.code, palName: t.name, palH: t.H || 0, maxKg: t.maxKg || 0, group: r0.group };
    const mk = (items, fill, noCap) => {
      items.sort((x, y) => y.units - x.units);
      const [m, ...rest] = items;
      pallets.push(Object.assign({ code: m.g.code, units: m.units, fill, kg: tare + items.reduce((s, i) => s + i.units * i.g.kg, 0), ci: m.g.ci, noKg: items.some(i => !(i.g.kg > 0)), over: !!noCap,
        extra: rest.length ? rest.map(i => ({ code: i.g.code, units: i.units, ci: i.g.ci, mixed: true })) : undefined }, base));
    };
    list.forEach(g => { const c = capOf(g.code, r0.pal); g.cap = c.per; g.top = c.top; g.lim = c.lim; });
    const noCap = list.filter(g => !(g.cap > 0));
    if (noCap.length) {
      mk(list.map(g => ({ g, units: g.qty })), 1, true);
      errors.push('Balení ' + r0.group + ': chybí standardní množství (Solo P. na ' + t.code + ') u ' + noCap.map(g => g.code).join(', ') + ' – vše na jedné paletě, zkontrolujte.');
    } else {
      const rest = [];
      list.forEach(g => {
        const lim = (g.lim || 50) / 100;
        const full = Math.floor(g.qty / g.cap); let r = g.qty % g.cap;
        // remainder first up to Max ks on the full pallets (same rule as Solo P.), the rest goes to the mix
        const tops = [];
        if (g.top > g.cap && full > 0 && r > 0 && r / g.cap < lim) for (let i = 0; i < full && r > 0; i++) { const add = Math.min(r, g.top - g.cap); tops.push(add); r -= add; }
        for (let i = 0; i < full; i++) mk([{ g, units: g.cap + (tops[i] || 0) }], 1);
        if (r > 0) rest.push({ g, units: r, f: r / g.cap });
      });
      // first-fit decreasing: the biggest remainders first, each to the first pallet where it still fits
      const bins = [];
      rest.sort((x, y) => y.f - x.f).forEach(it => {
        const kg = it.units * it.g.kg;
        const b = bins.find(b => b.f + it.f <= 1.0001 && (!(t.maxKg > 0) || b.kg + kg <= t.maxKg));
        if (b) { b.items.push(it); b.f += it.f; b.kg += kg; } else bins.push({ items: [it], f: it.f, kg });
      });
      bins.forEach(b => mk(b.items, b.f));
    }
    list.forEach(g => {
      const full = g.cap > 0 ? Math.floor(g.qty / g.cap) : 0, rem = g.cap > 0 ? g.qty % g.cap : g.qty;
      rows.push({ code: g.code, name: g.name, qty: g.qty, kg: g.qty * g.kg, ci: g.ci, rule: ruleText(g.rule) + (g.cap > 0 ? '' : ' – chybí kapacita'), over: !(g.cap > 0),
        pack: 'paleta', full, rem, per: g.cap || g.qty, fillRem: g.cap > 0 ? rem / g.cap : 1, count: full + (rem > 0 ? 1 : 0), group: r0.group, pal: t.code, palName: t.name, pl: t.L, pw: t.W });
    });
  });

  // riders go onto the host article's pallets; what does not fit follows the normal logic
  riders.forEach(({ a, idx, qty, rule: rule0, row }) => {
    let rule = rule0;
    let left = qty;
    // přibal of several main items (money box with V5, V11, V12 …): every matching main item gets its share
    const strictAll = findRules(a.code, qty, present, combos).filter(r => r.mode === 'host' && r.strict);
    if (strictAll.length && !rule.strict) rule = Object.assign({}, rule, { strict: true, per: rule.per || strictAll[0].per });
    const rules = rule.strict ? [rule].concat(strictAll.filter(r => r.host.toLowerCase() !== rule.host.toLowerCase())) : [rule];
    const slots = [];
    rules.forEach(r => pallets.filter(p => p.code.toLowerCase() === low(r.host)).forEach(p => { if (!slots.some(x => x.p === p)) slots.push({ p, cap: r.per > 0 ? r.per : Infinity }); }));
    // a výkres rule ("one light per cash register, any light"): the limit counts all articles of that výkres together
    const same = new Set((rule.vkCodes || [a.code]).map(low));
    const has = p => (p.extra || []).filter(e => same.has(low(e.code))).reduce((s, e) => s + e.units, 0);
    const load = p => (p.extra || []).reduce((s, e) => s + e.units, 0);
    // one piece at a time onto the main-item pallet with the least přibal so far (spread, not all on the first one)
    while (left > 0) {
      const free = slots.filter(x => has(x.p) < x.cap);
      if (!free.length) break;
      const x = rule.strict ? free.sort((m, n) => has(m.p) - has(n.p) || load(m.p) - load(n.p))[0] : free[0];
      const e = (x.p.extra || []).find(e => e.code === a.code && !e.mixed);
      if (e) e.units++; else x.p.extra = (x.p.extra || []).concat([{ code: a.code, units: 1, ci: idx }]);
      x.p.kg += a.kg || 0; if (!(a.kg > 0)) x.p.noKg = true; left--;
    }
    row.onHost = qty - left; row.host = rules.map(r => r.host).join(', ');
    // přibal of a main item (rule.strict): the max per pallet is fixed – what does not fit waits on the right side
    if (left > 0 && (a.unknown || rule.strict)) {
      const ks = [...new Set(rules.map(koliOf).filter(Boolean))].map(k => k.replace(/^(KOLI|BAL)-/, '')).join(', ');
      unknown.push({ code: a.code, qty: left, name: a.name || '', known: !a.unknown, hint: rule.strict ? 'nevešlo se na balení ' + (ks || '?') + ' (max ' + rule.per + ' ks na ' + (rules.length > 1 ? 'hlavní položku' : rule.host) + ')' : undefined });
      errors.push('Artikl „' + a.code + '“: ' + left + ' ks se nevešlo na palety ' + rule.host + (rule.strict ? ' (max ' + rule.per + ' ks na paletu) – přetáhněte ho na paletu, pravidlo se zvýší.' : ' a není v číselníku.'));
      Object.assign(row, { pack: 'paleta', full: 0, rem: 0, per: 0, fillRem: 0, count: 0 });
    } else if (left > 0) {
      if (!(a.per > 0) || !(a.pl > 0) || !(a.pw > 0)) { errors.push('U artiklu „' + a.code + '“ chybí rozměry nebo počet kusů.'); return; }
      build(a, idx, left, row);
    } else Object.assign(row, { pack: 'paleta', full: 0, rem: 0, per: a.per, fillRem: 0, count: 0 });
  });
  // main-item pallets carry the numbers of their balení (as the shared balení pallets do), so it is clear which balení they are
  pallets.forEach(p => {
    if (p.group) { p.tag = p.group; return; }
    const ks = [...new Set((combos || []).filter(r => r.mode === 'host' && r.strict && low(r.host) === low(p.code)).map(koliOf).filter(Boolean))];
    if (ks.length) p.tag = ks.length > 1 ? 'BAL ' + ks.map(k => k.replace(/^(KOLI|BAL)-/, '')).join('·') : ks[0];
  });
  // pieces over „Max ks“ of a balení: calculated again without that row (another balení, solo, or the right side)
  if (spill.length) {
    const skip = new Set(spill.flatMap(x => x.rules || [x.rule]));
    const sub = makePallets(spill.map(x => Object.assign({}, x.l, { qty: x.rest != null ? x.rest : x.l.qty - x.rule.cap })), catalog, combos.filter(r => !skip.has(r)), types, Object.assign({}, opts, { mix: false }));
    pallets.push(...sub.pallets); parcels.push(...sub.parcels); rows.push(...sub.rows); errors.push(...sub.errors);
    sub.unknown.forEach(u => { const x = spill.find(y => low(y.l.code) === low(u.code)); unknown.push(Object.assign(u, x ? { hint: x.hint || 'nad max ' + x.rule.cap + ' ks v ' + x.rule.group } : {})); });
  }
  return { pallets: opts.mix === false ? pallets : mixLeftovers(pallets), parcels, errors, rows, unknown };
}

// Leftover (partial) pallets of the same pallet type are combined while fill ≤ 100 % and weight ≤ the type's max load.
function mixLeftovers(pallets) {
  const full = pallets.filter(p => !(p.fill < 0.999) || !p.pal), part = pallets.filter(p => p.fill < 0.999 && p.pal);
  part.sort((a, b) => b.fill - a.fill);
  const out = [];
  part.forEach(p => {
    const host = out.find(h => h.pal === p.pal && h.fill + p.fill <= 1 + 1e-9 && (!(h.maxKg > 0) || h.kg + p.kg - p.tare <= h.maxKg + 1e-9));
    if (!host) { out.push(p); return; }
    host.extra = (host.extra || []).concat([{ code: p.code, units: p.units, ci: p.ci, mixed: true }], p.extra || []);
    host.fill += p.fill; host.kg += p.kg - p.tare;
  });
  return full.concat(out);
}
const low = s => String(s == null ? '' : s).trim().toLowerCase();

export function groupageCheck(pallets, rules) {
  const reasons = [], nonEuro = [];
  pallets.forEach(p => { if (!p.euro && nonEuro.indexOf(p.code) < 0) nonEuro.push(p.code); });
  if (pallets.length > rules.gMax) reasons.push(pallets.length + ' palet při limitu ' + rules.gMax);
  if (nonEuro.length) reasons.push('nejde o europalety: ' + nonEuro.join(', '));
  return { ok: reasons.length === 0, reasons };
}

export function parcelCheck(parcels, rules) {
  const heavy = new Set(), long = new Set();
  parcels.forEach(p => {
    if (p.kg > rules.pKg + 1e-9) heavy.add(p.code);
    if (Math.max(p.pl, p.pw) > rules.pL * 1000 + 0.5) long.add(p.code);
  });
  const reasons = [];
  if (heavy.size) reasons.push('těžší než ' + String(rules.pKg).replace('.', ',') + ' kg: ' + [...heavy].join(', '));
  if (long.size) reasons.push('delší než ' + String(rules.pL).replace('.', ',') + ' m: ' + [...long].join(', '));
  return { ok: reasons.length === 0, reasons, kg: parcels.reduce((s, p) => s + p.kg, 0) };
}
