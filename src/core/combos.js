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

// All active rules matching the article (in table order).
export function findRules(code, qty, present, combos) {
  return (combos || []).filter(r => r.on !== false && r.mode !== 'kolo'
    && low(r.code) === low(code)
    && (!low(r.withCode) || present.has(low(r.withCode)))
    && (!(r.min > 0) || qty >= r.min)
    && (!(r.max > 0) || qty <= r.max));
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
  // KOLI-n from shared pallets and from machine koli (their note says „Koli KOLI-n – hlavní položka …“)
  const n = (combos || []).map(r => { const m = String((r.mode === 'group' && r.group) || r.note || '').match(/KOLI-(\d+)/i); return m ? Number(m[1]) : 0; });
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
export function koloRow(it, group, pal, name, on, project) {
  return { project: project || '', on: on !== false, code: it.code, withCode: '', min: 0, max: 0, mode: 'group', host: '', pal, group, pl: 0, pw: 0, per: it.seen || 0, kg: 0, name: it.name || '', note: 'Koli ' + group + (name ? ' – ' + name : '') };
}

// Consolidation of koli (unconditional 'group' rows):
//  - koli on the same pallet type that share at least one article are one koli seen in parts → merged into the oldest
//    (1 2 3 4 5 + 3 4 5 6 → 1 2 3 4 5 6), verified pcs = the larger;
//  - a koli with a single article that is also in a bigger koli adds nothing → removed.
// Returns actions: { kind: 'merge', keep, drop: [..], pal, codes } | { kind: 'solo', drop, pal, code, into }
const grpNum = g => Number(String(g).replace(/\D/g, '')) || 0;
function koliGroups(combos) {
  const g = new Map();
  (combos || []).forEach(r => {
    if (r.mode !== 'group' || !r.group || low(r.withCode) || r.min > 0 || r.max > 0) return;
    const k = low(r.group) + '|' + low(r.pal);
    if (!g.has(k)) g.set(k, { group: r.group, pal: r.pal, project: low(r.project), key: k, codes: new Set() });
    g.get(k).codes.add(low(r.code));
  });
  return [...g.values()];
}
export function findDuplicateGroups(combos) {
  const list = koliGroups(combos), out = [];
  const parent = new Map(list.map(x => [x, x])), root = x => (parent.get(x) === x ? x : root(parent.get(x)));
  list.forEach((a, i) => list.slice(i + 1).forEach(b => {
    if (low(a.pal) === low(b.pal) && a.project === b.project && [...a.codes].some(c => b.codes.has(c))) parent.set(root(b), root(a));
  }));
  const comps = new Map();
  list.forEach(x => { const r = root(x); if (!comps.has(r)) comps.set(r, []); comps.get(r).push(x); });
  const merged = new Set();
  comps.forEach(c => {
    if (c.length < 2) return;
    c.sort((a, b) => grpNum(a.group) - grpNum(b.group));
    const codes = new Set(); c.forEach(x => x.codes.forEach(k => codes.add(k)));
    out.push({ kind: 'merge', keep: c[0].group, drop: c.slice(1).map(x => x.group), pal: c[0].pal, codes: codes.size });
    c.slice(1).forEach(x => merged.add(x));
  });
  // přibal of a main item imported twice: same article + same main item → one rule, max = the larger (never summed)
  const seenHost = new Map();
  (combos || []).forEach((r, i) => {
    if (r.mode !== 'host' || !r.strict) return;
    const k = low(r.code) + '|' + low(r.withCode) + '|' + low(r.host);
    if (!seenHost.has(k)) { seenHost.set(k, i); return; }
    const j = seenHost.get(k);
    out.push({ kind: 'hostdup', code: r.code, host: r.host, keep: j, drop: i, per: Math.max(combos[j].per || 0, r.per || 0) });
  });
  // single-article koli whose article is in a bigger koli (after merging)
  const big = list.filter(x => !merged.has(x) && x.codes.size > 1);
  const bigCodes = new Map(); big.forEach(x => x.codes.forEach(c => { const k = x.project + '|' + c; if (!bigCodes.has(k)) bigCodes.set(k, x); }));
  list.filter(x => !merged.has(x) && x.codes.size === 1).forEach(x => {
    const c = [...x.codes][0], into = bigCodes.get(x.project + '|' + c);
    if (into && into !== x) out.push({ kind: 'solo', drop: x.group, pal: x.pal, code: c, into: into.group });
  });
  return out;
}
export function mergeGroups(combos, actions) {
  const rename = new Map(), remove = new Set(), dropIdx = new Set(), raise = new Map();
  actions.forEach(a => {
    if (a.kind === 'hostdup') { dropIdx.add(a.drop); raise.set(a.keep, Math.max(raise.get(a.keep) || 0, a.per)); return; }
    if (a.kind === 'merge') a.drop.forEach(d => rename.set(low(d) + '|' + low(a.pal), a.keep));
    else remove.add(low(a.drop) + '|' + low(a.pal));
  });
  const plain = r => r.mode === 'group' && !low(r.withCode) && !(r.min > 0) && !(r.max > 0);
  const out = [];
  (combos || []).forEach((r0, i) => {
    if (dropIdx.has(i)) return;
    const r = raise.has(i) ? Object.assign({}, r0, { per: raise.get(i) }) : r0;
    const k = low(r.group) + '|' + low(r.pal);
    if (plain(r) && remove.has(k)) return;
    const nr = plain(r) && rename.has(k) ? Object.assign({}, r, { group: rename.get(k), note: 'Koli ' + rename.get(k) + ' (sloučeno)' }) : r;
    // the same article twice in one koli → one row, verified pcs = the larger
    const dup = plain(nr) && out.find(x => plain(x) && low(x.group) === low(nr.group) && low(x.pal) === low(nr.pal) && low(x.code) === low(nr.code));
    if (dup) { dup.per = Math.max(dup.per || 0, nr.per || 0); return; }
    out.push(nr);
  });
  return out;
}
// koli of a machine: the other articles ride on the machine's pallet (when the machine is in the order)
export function koloHostRows(items, main, group, name) {
  const m = items.find(x => low(x.code) === low(main)), n = Math.max(1, (m && m.seen) || 1);
  return items.filter(x => low(x.code) !== low(main)).map(x => ({ on: true, strict: true, code: x.code, withCode: main, min: 0, max: 0, mode: 'host', host: main, pl: 0, pw: 0,
    per: Math.ceil((x.seen || 1) / n), kg: 0, name: x.name || '', note: 'Koli ' + group + ' – hlavní položka ' + main + (name ? ' – ' + name : '') }));
}

// ---------- projects: an order is recognised by its key articles; koli can belong to one project ----------
// projects = [{ name, keys: ['V-06-…', …] }]
export function projectOf(order, projects) {
  const codes = new Set([...order.lines.values()].map(l => low(l.code)));
  let best = null, n = 0;
  (projects || []).forEach(p => {
    const hit = (p.keys || []).filter(k => codes.has(low(k))).length;
    if (hit > n) { n = hit; best = p.name; }
  });
  return best ? { name: best, hits: n } : null;
}
// koli of another project do not apply; koli without a project apply everywhere
export function combosFor(combos, project) {
  return (combos || []).filter(r => r.mode !== 'group' || !low(r.project) || (project && low(r.project) === low(project)));
}
