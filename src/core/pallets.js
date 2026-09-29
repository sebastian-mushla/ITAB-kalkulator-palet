import { isEuro } from './util.js';

// Splits order lines into full pallets + one partial pallet per article, or into parcels for pack = 'balik'.
export function makePallets(lines, catalog) {
  const pallets = [], parcels = [], errors = [], rows = [];
  const index = new Map(catalog.map((a, i) => [String(a.code).trim().toLowerCase(), i]));
  lines.forEach(l => {
    const idx = index.has(l.code.toLowerCase()) ? index.get(l.code.toLowerCase()) : -1;
    if (idx < 0) { errors.push('Artikl „' + l.code + '“ není v číselníku, nebyl spočítán.'); return; }
    const a = catalog[idx];
    if (!(a.per > 0) || !(a.pl > 0) || !(a.pw > 0)) { errors.push('U artiklu „' + a.code + '“ chybí rozměry nebo počet kusů.'); return; }
    const full = Math.floor(l.qty / a.per), rem = l.qty % a.per;
    const parcel = a.pack === 'balik';
    const mk = units => ({ code: a.code, units, fill: units / a.per, kg: units * (a.kg || 0), pl: a.pl, pw: a.pw, rot: !!a.rot, euro: !parcel && isEuro(a), ci: idx });
    const target = parcel ? parcels : pallets;
    for (let i = 0; i < full; i++) target.push(mk(a.per));
    if (rem > 0) target.push(mk(rem));
    rows.push({ code: a.code, name: a.name, pack: parcel ? 'balik' : 'paleta', qty: l.qty, full, rem, per: a.per, fillRem: rem / a.per, kg: l.qty * (a.kg || 0), ci: idx, count: full + (rem > 0 ? 1 : 0) });
  });
  return { pallets, parcels, errors, rows };
}

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
