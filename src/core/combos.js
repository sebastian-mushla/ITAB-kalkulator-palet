// Operator-defined exceptions to the normal pallet logic ("Kombinace" tab).
// rule: { on, code, withCode, min, max, mode: 'host'|'pallet'|'parcel', host, pl, pw, per, note }
//  host   - ride on the pallets of article `host`, at most `per` pcs per host pallet (0 = no limit); size unchanged, weight added
//  pallet - use pallet pl × pw with `per` pcs instead of the catalog values
//  parcel - send as parcels, `per` pcs per parcel (pl/pw = parcel size, empty = catalog)
//  group  - all articles with the same `group` go together on ONE pallet of type `pal`; per = verified pcs (more = warning, not a limit)
export const COMBO_MODES = [['host', 'na paletě artiklu'], ['pallet', 'na jiné paletě'], ['group', 'na společné paletě'], ['parcel', 'jako balík']];

const low = s => String(s == null ? '' : s).trim().toLowerCase();

// First active rule matching the article, the "together with" article and the quantity range.
export function findRule(code, qty, present, combos) {
  return (combos || []).find(r => r.on !== false && r.mode !== 'kolo'
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
  if (r.mode === 'group') act = 'na společné paletě ' + (r.group || '?') + ' (' + (r.pal || '?') + (r.per > 0 ? ', ověřeno ' + r.per + ' ks' : '') + ')';
  else if (r.mode === 'host') act = 'na paletě ' + r.host + (r.per > 0 ? ' (max ' + r.per + ' ks/paleta)' : '');
  else if (r.mode === 'pallet') act = 'na paletě ' + r.pl + '×' + r.pw + ' mm, ' + r.per + ' ks';
  else act = 'jako balík' + (r.per > 0 ? ' po ' + r.per + ' ks' : '');
  return r.code + (cond.length ? ' ' + cond.join(', ') : '') + ' → ' + act;
}

// Pasted koli from the ERP: "artikl<TAB>název<TAB>1,00" (optional position number first).
// PAL-xxxx lines are the pallet, not goods. Same article twice is summed.
export function parseKolo(text) {
  const items = new Map(), pals = [], problems = [];
  String(text || '').split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim(); if (!line) return;
    let cells = line.split(/\t|;/).map(c => c.trim());
    while (cells.length > 2 && cells[cells.length - 1] === '') cells.pop();
    if (cells.length >= 4 && /^\d{1,4}$/.test(cells[0])) cells = cells.slice(1);
    if (cells.length < 2) { problems.push('řádek ' + (i + 1) + ': chybí množství'); return; }
    const qty = Number(String(cells[cells.length - 1]).replace(/\s/g, '').replace(',', '.'));
    const code = cells[0], name = cells.slice(1, -1).join(' ').replace(/\s+/g, ' ').trim();
    if (!code || !isFinite(qty) || qty <= 0) { problems.push('řádek ' + (i + 1) + ': nerozpoznáno'); return; }
    if (/^PAL-\d+$/i.test(code)) { if (!pals.some(p => low(p.code) === low(code))) pals.push({ code: code.toUpperCase(), name }); return; }
    const k = low(code), g = items.get(k) || { code, name, seen: 0 };
    g.seen += Math.round(qty); items.set(k, g);
  });
  return { items: [...items.values()], pals, problems };
}
export function nextKoloCode(combos) {
  const n = (combos || []).filter(r => r.mode === 'group' && /^KOLI-\d+$/i.test(r.group || '')).map(r => Number(String(r.group).replace(/\D/g, '')) || 0);
  return 'KOLI-' + ((n.length ? Math.max(...n) : 0) + 1);
}

// older imported koli (one special entry) → normal table rows, one per article
export function expandKolo(combos) {
  let changed = false;
  const out = [];
  (combos || []).forEach(r => {
    if (r.mode !== 'kolo') { out.push(r); return; }
    changed = true;
    (r.items || []).forEach(it => out.push(koloRow(it, r.code, r.pal, r.name, r.on)));
  });
  return { combos: out, changed };
}
export function koloRow(it, group, pal, name, on) {
  return { on: on !== false, code: it.code, withCode: '', min: 0, max: 0, mode: 'group', host: '', pal, group, pl: 0, pw: 0, per: it.seen || 0, kg: 0, name: it.name || '', note: 'Koli ' + group + (name ? ' – ' + name : '') };
}
