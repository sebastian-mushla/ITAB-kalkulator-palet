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

// Shared pallets that say the same thing: a group whose articles are all in another group on the same
// pallet type (same set or a subset) adds nothing. Only unconditional rows are compared.
// Returns [{ keep, drop, pal, same, raise: [{ code, from, to }] }]
export function findDuplicateGroups(combos) {
  const g = new Map();
  (combos || []).forEach((r, i) => {
    if (r.mode !== 'group' || !r.group || low(r.withCode) || r.min > 0 || r.max > 0) return;
    const k = low(r.group) + '|' + low(r.pal);
    if (!g.has(k)) g.set(k, { group: r.group, pal: r.pal, rows: [], codes: new Map(), first: i });
    const x = g.get(k); x.rows.push(i); x.codes.set(low(r.code), r.per || 0);
  });
  const list = [...g.values()], out = [], gone = new Set();
  const num = x => Number(String(x.group).replace(/\D/g, '')) || 0;
  list.forEach(b => {
    if (gone.has(b)) return;
    // the group that covers b: same pallet, contains all of b's articles; prefer the biggest, then the oldest
    const host = list.filter(a => a !== b && !gone.has(a) && low(a.pal) === low(b.pal) && a.codes.size >= b.codes.size && [...b.codes.keys()].every(c => a.codes.has(c)))
      .sort((x, y) => y.codes.size - x.codes.size || num(x) - num(y))[0];
    if (!host) return;
    const same = host.codes.size === b.codes.size;
    if (same && num(host) > num(b)) return; // identical sets: the older one stays (handled when we reach the newer)
    gone.add(b);
    const raise = [...b.codes].filter(([c, per]) => per > (host.codes.get(c) || 0)).map(([c, per]) => ({ code: c, from: host.codes.get(c) || 0, to: per }));
    out.push({ keep: host.group, drop: b.group, pal: b.pal, same, n: b.codes.size, raise });
  });
  return out;
}
// apply chosen merges: drop the redundant group's rows, raise verified pcs in the group that stays
export function mergeGroups(combos, merges) {
  const dropKeys = new Set(merges.map(m => low(m.drop) + '|' + low(m.pal)));
  const res = combos.filter(r => !(r.mode === 'group' && dropKeys.has(low(r.group) + '|' + low(r.pal)) && !low(r.withCode) && !(r.min > 0) && !(r.max > 0)));
  merges.forEach(m => m.raise.forEach(x => {
    const r = res.find(c => c.mode === 'group' && low(c.group) === low(m.keep) && low(c.pal) === low(m.pal) && low(c.code) === x.code);
    if (r) r.per = Math.max(r.per || 0, x.to);
  }));
  return res;
}
