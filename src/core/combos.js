// Operator-defined exceptions to the normal pallet logic ("Kombinace" tab).
// rule: { on, code, withCode, min, max, mode: 'host'|'pallet'|'parcel', host, pl, pw, per, note }
//  host   - ride on the pallets of article `host`, at most `per` pcs per host pallet (0 = no limit); size unchanged, weight added
//  pallet - use pallet pl × pw with `per` pcs instead of the catalog values
//  parcel - send as parcels, `per` pcs per parcel (pl/pw = parcel size, empty = catalog)
export const COMBO_MODES = [['host', 'na paletě artiklu'], ['pallet', 'na jiné paletě'], ['parcel', 'jako balík']];

const low = s => String(s == null ? '' : s).trim().toLowerCase();

// First active rule matching the article, the "together with" article and the quantity range.
export function findRule(code, qty, present, combos) {
  return (combos || []).find(r => r.on !== false
    && low(r.code) === low(code)
    && (!low(r.withCode) || present.has(low(r.withCode)))
    && (!(r.min > 0) || qty >= r.min)
    && (!(r.max > 0) || qty <= r.max)) || null;
}

export function ruleText(r) {
  const cond = [];
  if (low(r.withCode)) cond.push('s ' + r.withCode);
  if (r.min > 0) cond.push('od ' + r.min + ' ks');
  if (r.max > 0) cond.push('do ' + r.max + ' ks');
  let act;
  if (r.mode === 'host') act = 'na paletě ' + r.host + (r.per > 0 ? ' (max ' + r.per + ' ks/paleta)' : '');
  else if (r.mode === 'pallet') act = 'na paletě ' + r.pl + '×' + r.pw + ' mm, ' + r.per + ' ks';
  else act = 'jako balík' + (r.per > 0 ? ' po ' + r.per + ' ks' : '');
  return r.code + (cond.length ? ' ' + cond.join(', ') : '') + ' → ' + act;
}
