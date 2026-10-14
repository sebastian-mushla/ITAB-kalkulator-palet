// Operator-defined exceptions to the normal pallet logic ("Způsob balení" tab).
// rule: { on, code, withCode, min, max, mode: 'host'|'pallet'|'parcel', host, pl, pw, per, note }
//  host   - ride on the pallets of article `host`, at most `per` pcs per host pallet (0 = no limit); size unchanged, weight added
//  pallet - use pallet pl × pw with `per` pcs instead of the catalog values
//  parcel - send as parcels, `per` pcs per parcel (pl/pw = parcel size, empty = catalog)
//  group  - all articles with the same `group` go together on ONE pallet of type `pal`; per = verified pcs (more = warning, not a limit)
export const COMBO_MODES = [['host', 'na paletě artiklu'], ['pallet', 'na jiné paletě'], ['group', 'na společné paletě'], ['parcel', 'jako balík']];

const low = s => String(s == null ? '' : s).trim().toLowerCase();

// First active rule matching the article, the "together with" article and the quantity range.
// Priority: balení with a main item (strict přibal) → balení mix (shared pallet) → other rows; table order inside each.
const rank = r => r.mode === 'host' && r.strict ? 0 : r.mode === 'group' ? 1 : low(r.project) ? 2 : 3; // solo/balík: in the project first, then without project

export function findRule(code, qty, present, combos) {
  return findRules(code, qty, present, combos)[0] || null;
}

// All active rules matching the article, in priority order (stable by table order).
export function findRules(code, qty, present, combos) {
  return (combos || []).filter(r => r.on !== false && r.mode !== 'kolo'
    && low(r.code) === low(code)
    && (!low(r.withCode) || present.has(low(r.withCode)))
    && (!(r.min > 0) || qty >= r.min)
    && (!(r.max > 0) || qty <= r.max))
    .map((r, i) => [r, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(x => x[0]);
}

export function ruleText(r) {
  const cond = [];
  if (low(r.withCode)) cond.push('s ' + r.withCode);
  if (r.min > 0) cond.push('od ' + r.min + ' ks');
  if (r.max > 0) cond.push('do ' + r.max + ' ks');
  let act;
  if (r.mode === 'group') act = 'na společné paletě ' + (r.group || '?') + ' (' + (r.pal || '?') + (r.per > 0 ? ', ověřeno ' + r.per + ' ks' : '') + ')';
  else if (r.mode === 'host') act = 'na paletě ' + r.host + (r.per > 0 ? ' (max ' + r.per + ' ks/paleta)' : '');
  else if (r.mode === 'pallet') act = 'solo na paletě ' + (r.pal || r.pl + '×' + r.pw + ' mm') + ', ' + r.per + ' ks' + (r.project ? ' (' + r.project + ')' : '');
  else act = 'jako balík' + (r.per > 0 ? ' po ' + r.per + ' ks' : '') + (r.project ? ' (' + r.project + ')' : '');
  return r.code + (cond.length ? ' ' + cond.join(', ') : '') + ' → ' + act;
}

// Pasted balení from the ERP: "artikl<TAB>název<TAB>1,00" (optional position number first).
// PAL-xxxx lines are the pallet, not goods. Same article twice is summed.
export function parseKolo(text) {
  const items = new Map(), pals = [], problems = [];
  String(text || '').split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim(); if (!line) return;
    let cells = line.split(/\t|;/).map(c => c.trim());
    // pasted with spaces only: first word = article, last = quantity, the rest = name
    // a number at the end counts as quantity only in the ERP form „1,00“ – „IMPULSE ISLAND 1096“ is a name, quantity 1
    if (cells.length < 2) {
      const w = line.split(/\s+/), last = w[w.length - 1];
      cells = w.length >= 2 && /^\d+[.,]\d+$/.test(last) ? [w[0], w.slice(1, -1).join(' '), last] : [w[0], w.slice(1).join(' '), '1'];
    }
    while (cells.length > 2 && cells[cells.length - 1] === '') cells.pop();
    if (cells.length >= 4 && /^\d{1,4}$/.test(cells[0])) cells = cells.slice(1);
    if (cells.length < 2) { problems.push('řádek ' + (i + 1) + ': chybí množství'); return; }
    const qty = Number(String(cells[cells.length - 1]).replace(/\s/g, '').replace(',', '.'));
    const code = cells[0], name = cells.slice(1, -1).join(' ').replace(/\s+/g, ' ').trim();
    if (!code || !isFinite(qty) || qty <= 0) { problems.push('řádek ' + (i + 1) + ': nerozpoznáno'); return; }
    if (/^PAL-[0-9][0-9A-Z-]*$/i.test(code)) { if (!pals.some(p => low(p.code) === low(code))) pals.push({ code: code.toUpperCase(), name }); return; }
    const k = low(code), g = items.get(k) || { code, name, seen: 0 };
    g.seen += Math.round(qty); items.set(k, g);
  });
  return { items: [...items.values()], pals, problems };
}
export function nextKoloCode(combos) {
  // BAL-n (formerly KOLI-n) from shared pallets and from machine balení (their note says „Balení KOLI-n – hlavní položka …“)
  const n = (combos || []).map(r => { const m = String((r.mode === 'group' && r.group) || r.koli || r.note || '').match(/(?:KOLI|BAL)-(\d+)/i); return m ? Number(m[1]) : 0; });
  return 'BAL-' + ((n.length ? Math.max(...n) : 0) + 1);
}

// older imported balení (one special entry) → normal table rows, one per article
export function expandKolo(combos) {
  let changed = false;
  const out = [];
  (combos || []).forEach(r => {
    if (r.mode !== 'kolo') { out.push(r); return; }
    changed = true;
    (r.items || []).forEach(it => out.push(koloRow(it, r.code, r.pal, r.name, r.on)));
  });
  // codes KOLI-n were renamed to BAL-n
  const ren = v => typeof v === 'string' && /KOLI-\d/i.test(v) ? (changed = true, v.replace(/KOLI-(\d)/gi, 'BAL-$1')) : v;
  out.forEach(r => ['group', 'koli', 'note'].forEach(f => { if (r[f] != null) r[f] = ren(r[f]); }));
  // only two kinds now: a rule riding on another article is always a main item + přibal
  out.forEach(r => { if (r.mode === 'host' && !r.strict && r.host) { r.strict = true; changed = true; } });
  return { combos: out, changed };
}
export function koloRow(it, group, pal, name, on, project) {
  return { project: project || '', on: on !== false, code: it.code, withCode: '', min: 0, max: 0, mode: 'group', host: '', pal, group, pl: 0, pw: 0, per: it.seen || 0, kg: 0, name: it.name || '', note: 'Balení ' + group + (name ? ' – ' + name : '') };
}

// Consolidation of balení (unconditional 'group' rows):
//  - balení on the same pallet type that share at least one article are one balení seen in parts → merged into the oldest
//    (1 2 3 4 5 + 3 4 5 6 → 1 2 3 4 5 6), verified pcs = the larger;
//  - a balení with a single article that is also in a bigger balení adds nothing → removed.
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
  // one main item = one koli: balení numbers of the same main item are merged into the oldest
  const byHost = new Map();
  (combos || []).forEach(r => { if (r.mode === 'host' && r.strict) { const k = low(r.host); if (!byHost.has(k)) byHost.set(k, { host: r.host, ks: new Set() }); const n = koliOf(r); if (n) byHost.get(k).ks.add(n); } });
  byHost.forEach(h => { if (h.ks.size > 1) { const ks = [...h.ks].sort((a, b) => grpNum(a) - grpNum(b)); out.push({ kind: 'hostmerge', host: h.host, keep: ks[0], drop: ks.slice(1) }); } });
  // přibal of a main item imported twice: same article + same main item → one rule, max = the larger (never summed)
  const seenHost = new Map();
  const strictKeys = new Set((combos || []).filter(r => r.mode === 'host' && r.strict).map(r => low(r.code) + '|' + low(r.host)));
  (combos || []).forEach((r, i) => {
    // an older plain rule for the same přibal + main item counts as a duplicate too
    if (r.mode !== 'host' || !(r.strict || strictKeys.has(low(r.code) + '|' + low(r.host)))) return;
    const k = low(r.code) + '|' + low(r.withCode) + '|' + low(r.host);
    if (!seenHost.has(k)) { seenHost.set(k, i); return; }
    const j = seenHost.get(k);
    out.push({ kind: 'hostdup', code: r.code, host: r.host, keep: j, drop: i, per: Math.max(combos[j].per || 0, r.per || 0) });
  });
  // single-article balení whose article is in a bigger balení (after merging)
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
    if (a.kind === 'hostdup') { dropIdx.add(a.drop); raise.set(a.keep, Math.max(raise.get(a.keep) || 0, a.per)); const k = combos[a.keep], d = combos[a.drop]; if (k) { k.strict = true; k.max = 0; if (!k.koli && d) { k.koli = d.koli; k.note = d.note; } } return; }
    if (a.kind === 'hostmerge') { (combos || []).forEach(r => { if (r.mode === 'host' && r.strict && low(r.host) === low(a.host)) { r.koli = a.keep; r.note = 'Balení ' + a.keep + ' – hlavní položka ' + r.host; } }); return; }
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
    const nr = plain(r) && rename.has(k) ? Object.assign({}, r, { group: rename.get(k), note: 'Balení ' + rename.get(k) + ' (sloučeno)' }) : r;
    // the same article twice in one balení → one row, verified pcs = the larger
    const dup = plain(nr) && out.find(x => plain(x) && low(x.group) === low(nr.group) && low(x.pal) === low(nr.pal) && low(x.code) === low(nr.code));
    if (dup) { dup.per = Math.max(dup.per || 0, nr.per || 0); return; }
    out.push(nr);
  });
  return out;
}
// balení of a machine: the other articles ride on the machine's pallet (when the machine is in the order)
export function koloHostRows(items, main, group, name) {
  const m = items.find(x => low(x.code) === low(main)), n = Math.max(1, (m && m.seen) || 1);
  return items.filter(x => low(x.code) !== low(main)).map(x => ({ on: true, strict: true, koli: group, code: x.code, withCode: main, min: 0, max: 0, mode: 'host', host: main, pl: 0, pw: 0,
    per: Math.ceil((x.seen || 1) / n), kg: 0, name: x.name || '', note: 'Balení ' + group + ' – hlavní položka ' + main + (name ? ' – ' + name : '') }));
}

// ---------- projects: an order is recognised by its key articles; balení can belong to one project ----------
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
// balení of another project do not apply; balení without a project apply everywhere
export function combosFor(combos, project) {
  return (combos || []).filter(r => !low(r.project) || (project && low(r.project) === low(project)));
}

// balení number of a rule (main item + přibal rows keep it in `balení`, older ones only in the note)
export function koliOf(r) { const m = String(r.koli || r.group || r.note || '').match(/(?:KOLI|BAL)-\d+/i); return m ? m[0].toUpperCase().replace('KOLI-', 'BAL-') : ''; }

// Packing lives only in Způsob balení: an article definition with a pallet or a parcel size becomes a solo / balík row
// (project = the order's project when learned in an order, none when migrated). The catalog keeps code, name, weight, service.
export function defsToSolo(catalog, combos, project) {
  let changed = false;
  (catalog || []).forEach(a => {
    if (a.pack !== 'paleta' && a.pack !== 'balik') return;
    const par = a.pack === 'balik';
    if (par ? (a.pl > 0 && a.pw > 0) : (a.pal || (a.pl > 0 && a.pw > 0))) {
      const proj = project || '';
      const ex = combos.find(r => (r.mode === 'pallet' || r.mode === 'parcel') && low(r.code) === low(a.code) && low(r.project) === low(proj));
      const row = { on: true, code: a.code, withCode: '', min: 0, max: 0, mode: par ? 'parcel' : 'pallet', host: '', pal: par ? '' : (a.pal || ''), pl: a.pal && !par ? 0 : (a.pl || 0), pw: a.pal && !par ? 0 : (a.pw || 0), per: a.per || 1, kg: 0, name: a.name || '', project: proj, note: '' };
      if (ex) Object.assign(ex, row); else combos.push(row);
    }
    a.pack = 'neurceno'; delete a.pal; delete a.pl; delete a.pw; a.per = 0;
    changed = true;
  });
  return changed;
}
