import { isEuro } from './util.js';
import { findRule, ruleText } from './combos.js';

// Splits order lines into full pallets + one partial pallet per article, or into parcels for pack = 'balik'.
// combos (Kombinace tab) can override this per order; see combos.js.
export function makePallets(lines, catalog, combos = []) {
  const pallets = [], parcels = [], errors = [], rows = [];
  const index = new Map(catalog.map((a, i) => [String(a.code).trim().toLowerCase(), i]));
  const present = new Set(lines.map(l => l.code.toLowerCase()));
  const riders = [];

  function build(a, idx, qty, row) {
    const full = Math.floor(qty / a.per), rem = qty % a.per;
    const parcel = a.pack === 'balik';
    const mk = units => ({ code: a.code, units, fill: units / a.per, kg: units * (a.kg || 0), pl: a.pl, pw: a.pw, rot: !!a.rot, euro: !parcel && isEuro(a), ci: idx });
    const target = parcel ? parcels : pallets;
    for (let i = 0; i < full; i++) target.push(mk(a.per));
    if (rem > 0) target.push(mk(rem));
    return Object.assign(row, { pack: parcel ? 'balik' : 'paleta', full, rem, per: a.per, fillRem: rem / a.per, count: full + (rem > 0 ? 1 : 0) });
  }

  lines.forEach(l => {
    const idx = index.has(l.code.toLowerCase()) ? index.get(l.code.toLowerCase()) : -1;
    if (idx < 0) { errors.push('Artikl „' + l.code + '“ není v číselníku, nebyl spočítán.'); return; }
    let a = catalog[idx];
    const rule = findRule(a.code, l.qty, present, combos);
    const row = { code: a.code, name: a.name, qty: l.qty, kg: l.qty * (a.kg || 0), ci: idx, rule: rule ? ruleText(rule) : null };
    if (rule && rule.mode === 'host') { riders.push({ a, idx, qty: l.qty, rule, row }); rows.push(row); return; }
    if (rule && rule.mode === 'pallet') a = Object.assign({}, a, { pack: 'paleta', pl: rule.pl || a.pl, pw: rule.pw || a.pw, per: rule.per || a.per });
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
    if (left > 0) {
      if (!(a.per > 0) || !(a.pl > 0) || !(a.pw > 0)) { errors.push('U artiklu „' + a.code + '“ chybí rozměry nebo počet kusů.'); return; }
      build(a, idx, left, row);
    } else Object.assign(row, { pack: 'paleta', full: 0, rem: 0, per: a.per, fillRem: 0, count: 0 });
  });
  return { pallets, parcels, errors, rows };
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
