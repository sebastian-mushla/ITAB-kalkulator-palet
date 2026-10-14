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
    const full = Math.floor(qty / a.per), rem = qty % a.per;
    const parcel = a.pack === 'balik';
    const tare = parcel ? 0 : (a.tare || 0);
    const mk = units => ({ code: a.code, units, fill: units / a.per, kg: tare + units * (a.kg || 0), tare, pl: a.pl, pw: a.pw, rot: !!a.rot, euro: !parcel && isEuro(a), ci: idx, pal: parcel ? null : (a.pal || null), palName: a.palName || '', palH: a.palH || 0, maxKg: a.maxKg || 0 });
    const target = parcel ? parcels : pallets;
    for (let i = 0; i < full; i++) target.push(mk(a.per));
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
  lines.forEach(l => {
    const idx = index.has(l.code.toLowerCase()) ? index.get(l.code.toLowerCase()) : -1;
    let solo = null;
    if (idx < 0) {
      // not in the catalog yet: it can still ride on a host pallet if a Způsob balení rule says so
      const r0 = findRule(l.code, l.qty, present, combos);
      if (r0 && r0.mode === 'group' && overCap(r0, l.qty)) { unknown.push({ code: l.code, qty: l.qty, name: l.name || '', hint: capHint(r0) }); errors.push('Artikl „' + l.code + '“: ' + l.qty + ' ks je víc než max ' + r0.cap + ' ks v ' + r0.group + ' – zařaďte ho ručně.'); return; }
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
      if (overCap(rule, l.qty)) { unknown.push({ code: l.code, qty: l.qty, name: a.name || l.name || '', known: true, hint: capHint(rule) }); errors.push('Artikl „' + l.code + '“: ' + l.qty + ' ks je víc než max ' + rule.cap + ' ks v ' + rule.group + ' – zařaďte ho ručně.'); return; }
      addGroup(rule, a, ci, l); return;
    }
    // packing not decided yet (article known from a balení): rides only by a rule, otherwise waits on the right side
    // a service (freight, handling fee): counted in the order, nothing to load
    if (a.pack === 'sluzba') { rows.push(Object.assign(row, { pack: 'sluzba', kg: 0, full: 0, rem: 0, per: 0, fillRem: 0, count: 0 })); return; }
    if (a.pack === 'neurceno' && !(rule && rule.mode !== 'group')) {
      unknown.push({ code: l.code, qty: l.qty, name: a.name || l.name || '', known: true, undecided: true });
      errors.push('Artikl „' + l.code + '“: balení není určeno – zařaďte ho na ploše níže.'); return;
    }
    if (rule && rule.mode === 'host') { riders.push({ a: a.pack === 'neurceno' ? Object.assign({}, a, { unknown: true }) : a, idx: ci, qty: l.qty, rule, row }); rows.push(row); return; }
    if (rule && rule.mode === 'pallet') a = rule.pal && typeOf(types, rule.pal)
      ? resolveArticle(Object.assign({}, a, { pack: 'paleta', pal: rule.pal, per: rule.per || a.per }), types)
      : Object.assign({}, a, { pack: 'paleta', pal: null, palName: '', tare: 0, pl: rule.pl || a.pl, pw: rule.pw || a.pw, per: rule.per || a.per });
    if (rule && rule.mode === 'parcel') a = Object.assign({}, a, { pack: 'balik', pl: rule.pl || a.pl, pw: rule.pw || a.pw, per: rule.per || a.per });
    if (!(a.per > 0) || !(a.pl > 0) || !(a.pw > 0)) { errors.push('U artiklu „' + a.code + '“ chybí rozměry nebo počet kusů.'); return; }
    rows.push(build(a, ci, l.qty, row));
  });

  // shared pallets: every group = one pallet of its type with all its articles; per is only "verified"
  groups.forEach(list => {
    const r0 = list[0].rule, t = typeOf(types, r0.pal);
    if (!t) { list.forEach(g => errors.push('Artikl „' + g.code + '“: typ palety ' + r0.pal + ' pro společnou paletu ' + r0.group + ' neexistuje.')); return; }
    list.sort((x, y) => y.qty - x.qty);
    const [m, ...rest] = list, tare = t.tare || 0;
    pallets.push({ code: m.code, units: m.qty, fill: 1, kg: tare + list.reduce((s, g) => s + g.qty * g.kg, 0), tare, pl: t.L, pw: t.W, rot: t.rot !== false, euro: isEuro({ pl: t.L, pw: t.W }), ci: m.ci,
      pal: t.code, palName: t.name, palH: t.H || 0, maxKg: t.maxKg || 0, group: r0.group, over: list.some(g => g.rule.per > 0 && g.qty > g.rule.per), extra: rest.length ? rest.map(g => ({ code: g.code, units: g.qty, ci: g.ci, mixed: true })) : undefined });
    list.forEach((g, n) => {
      const over = g.rule.per > 0 && g.qty > g.rule.per;
      if (over) errors.push('Společná paleta ' + r0.group + ': ' + g.code + ' má ' + g.qty + ' ks, ověřeno jen ' + g.rule.per + ' ks – zkontrolujte, zda se vše vejde.');
      rows.push({ code: g.code, name: g.name, qty: g.qty, kg: g.qty * g.kg, ci: g.ci, rule: ruleText(g.rule) + (over ? ' – víc než ověřeno' : ''), over,
        pack: 'paleta', full: n === 0 ? 1 : 0, rem: 0, per: 1, fillRem: 0, count: n === 0 ? 1 : 0, group: r0.group, pal: t.code, palName: t.name, pl: t.L, pw: t.W });
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
    const has = p => (p.extra || []).filter(e => e.code === a.code).reduce((s, e) => s + e.units, 0);
    const load = p => (p.extra || []).reduce((s, e) => s + e.units, 0);
    // one piece at a time onto the main-item pallet with the least přibal so far (spread, not all on the first one)
    while (left > 0) {
      const free = slots.filter(x => has(x.p) < x.cap);
      if (!free.length) break;
      const x = rule.strict ? free.sort((m, n) => has(m.p) - has(n.p) || load(m.p) - load(n.p))[0] : free[0];
      const e = (x.p.extra || []).find(e => e.code === a.code && !e.mixed);
      if (e) e.units++; else x.p.extra = (x.p.extra || []).concat([{ code: a.code, units: 1, ci: idx }]);
      x.p.kg += a.kg || 0; left--;
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
