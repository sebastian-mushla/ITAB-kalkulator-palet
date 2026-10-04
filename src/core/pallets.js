import { isEuro } from './util.js';
import { findRule, ruleText } from './combos.js';
import { resolveArticle, typeOf } from './palletTypes.js';

// Splits order lines into full pallets + one partial pallet per article, or into parcels for pack = 'balik'.
// combos (Kombinace tab) can override this per order; see combos.js.
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

  lines.forEach(l => {
    const idx = index.has(l.code.toLowerCase()) ? index.get(l.code.toLowerCase()) : -1;
    if (idx < 0) {
      // not in the catalog yet: it can still ride on a host pallet if a Kombinace rule says so
      const r0 = findRule(l.code, l.qty, present, combos);
      if (r0 && r0.mode === 'host') {
        const a0 = { code: l.code, name: r0.name || l.name || '', kg: r0.kg || 0, per: 0, pl: 0, pw: 0, unknown: true };
        const ci = catalog.length + unknown.length + riders.length;
        const row = { code: l.code, name: a0.name, qty: l.qty, kg: l.qty * a0.kg, ci, rule: ruleText(r0) };
        riders.push({ a: a0, idx: ci, qty: l.qty, rule: r0, row }); rows.push(row); return;
      }
      unknown.push({ code: l.code, qty: l.qty, name: l.name || '' });
      errors.push('Artikl „' + l.code + '“ není v číselníku, nebyl spočítán.'); return;
    }
    let a = resolveArticle(catalog[idx], types);
    const rule = findRule(a.code, l.qty, present, combos);
    const row = { code: a.code, name: a.name, qty: l.qty, kg: l.qty * (a.kg || 0), ci: idx, rule: rule ? ruleText(rule) : null };
    if (rule && rule.mode === 'host') { riders.push({ a, idx, qty: l.qty, rule, row }); rows.push(row); return; }
    if (rule && rule.mode === 'pallet') a = rule.pal && typeOf(types, rule.pal)
      ? resolveArticle(Object.assign({}, a, { pack: 'paleta', pal: rule.pal, per: rule.per || a.per }), types)
      : Object.assign({}, a, { pack: 'paleta', pal: null, palName: '', tare: 0, pl: rule.pl || a.pl, pw: rule.pw || a.pw, per: rule.per || a.per });
    if (rule && rule.mode === 'parcel') a = Object.assign({}, a, { pack: 'balik', pl: rule.pl || a.pl, pw: rule.pw || a.pw, per: rule.per || a.per });
    if (!(a.per > 0) || !(a.pl > 0) || !(a.pw > 0)) { errors.push('U artiklu „' + a.code + '“ chybí rozměry nebo počet kusů.'); return; }
    rows.push(build(a, idx, l.qty, row));
  });

  // riders go onto the host article's pallets; what does not fit follows the normal logic
  riders.forEach(({ a, idx, qty, rule, row }) => {
    let left = qty;
    const cap = rule.per > 0 ? rule.per : Infinity;
    pallets.filter(p => p.code.toLowerCase() === low(rule.host)).forEach(p => {
      if (left <= 0) return;
      const used = (p.extra || []).filter(e => e.code === a.code).reduce((s, e) => s + e.units, 0);
      const n = Math.min(left, cap - used);
      if (n <= 0) return;
      p.extra = (p.extra || []).concat([{ code: a.code, units: n, ci: idx }]);
      p.kg += n * (a.kg || 0);
      left -= n;
    });
    row.onHost = qty - left; row.host = rule.host;
    if (left > 0 && a.unknown) {
      unknown.push({ code: a.code, qty: left, name: a.name || '' });
      errors.push('Artikl „' + a.code + '“: ' + left + ' ks se nevešlo na palety ' + rule.host + ' a není v číselníku.');
      Object.assign(row, { pack: 'paleta', full: 0, rem: 0, per: 0, fillRem: 0, count: 0 });
    } else if (left > 0) {
      if (!(a.per > 0) || !(a.pl > 0) || !(a.pw > 0)) { errors.push('U artiklu „' + a.code + '“ chybí rozměry nebo počet kusů.'); return; }
      build(a, idx, left, row);
    } else Object.assign(row, { pack: 'paleta', full: 0, rem: 0, per: a.per, fillRem: 0, count: 0 });
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
