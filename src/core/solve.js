import { EPS, fmtKg, fmtM, palWord, balWord, vehWord } from './util.js';
import { makePallets, groupageCheck, parcelCheck } from './pallets.js';
import { typeOf } from './palletTypes.js';
import { planPallets, unplaced } from './plan.js';
import { isEuro } from './util.js';
import { packAll, prepareVehicles } from './packing.js';
import { projectOf, combosFor, koliOf } from './combos.js';

export function recoText(vehicles) {
  const m = new Map();
  vehicles.forEach(v => { const g = m.get(v.vi) || { name: v.name, L: v.L, n: 0 }; g.n++; m.set(v.vi, g); });
  return [...m.values()].map(g => g.n + '× ' + g.name + ' ' + fmtM(g.L) + ' m').join(' + ');
}

export function groupItems(items) {
  const m = new Map();
  items.forEach(it => {
    let g = m.get(it.code);
    if (!g) { g = { code: it.code, ci: it.ci, count: 0, units: 0, kg: 0 }; m.set(it.code, g); }
    g.count++; g.units += it.units; g.kg += it.kg;
  });
  return [...m.values()];
}

// The operator's pallet plan replaces the calculated pallets; what is not on any pallet shows up as "to place".
function applyPlan(mp, plan, lines, catalog, types) {
  const idx = new Map(catalog.map((a, i) => [String(a.code).toLowerCase(), i]));
  const extraCi = new Map();
  const ci = code => { const k = code.toLowerCase(); if (idx.has(k)) return idx.get(k); if (!extraCi.has(k)) extraCi.set(k, catalog.length + 50 + extraCi.size); return extraCi.get(k); };
  mp.pallets = planPallets(plan, types, ci);
  const parcelCodes = new Set(mp.parcels.map(p => p.code.toLowerCase()));
  // services (freight, fees) are never on a pallet, so they are not "unplaced"
  const service = new Set(catalog.filter(a => a.pack === 'sluzba' || a.pack === 'kit').map(a => String(a.code).toLowerCase()));
  const left = unplaced(lines, plan).filter(u => !parcelCodes.has(u.code.toLowerCase()) && !service.has(u.code.toLowerCase()));
  mp.unknown = left.map(u => Object.assign(u, { known: idx.has(u.code.toLowerCase()) }));
  mp.errors = mp.errors.filter(e => !/není v číselníku|se nevešlo/.test(e));
  left.forEach(u => mp.errors.push('Artikl „' + u.code + '“: ' + u.qty + ' ks není na žádné paletě' + (u.known ? '' : ' (není v číselníku)') + '.'));
  // same wording as the calculation: "3 plné po 156 ks, 1 neúplná: 32 ks, 21 %" – just with the current numbers
  const parts = new Map();
  plan.forEach(b => b.contents.forEach(c => {
    if (!(c.units > 0)) return;
    const k = (c.so || '') + '|' + c.code.toLowerCase(), g = parts.get(k) || { per: c.per || c.units, full: 0, part: [], ride: 0 };
    if (c.ride) g.ride += c.units; else if (c.units >= (c.per || c.units)) g.full++; else g.part.push(c.units);
    parts.set(k, g);
  }));
  const plural = (n, f) => (n === 1 ? f[0] : n >= 2 && n <= 4 ? f[1] : f[2]);
  const distText = g => {
    const out = [];
    if (g.full) out.push(g.per === 1 ? g.full + ' ' + plural(g.full, ['paleta', 'palety', 'palet']) : g.full + ' ' + plural(g.full, ['plná', 'plné', 'plných']) + ' po ' + g.per + ' ks');
    if (g.part.length) out.push(g.part.length + ' ' + plural(g.part.length, ['neúplná', 'neúplné', 'neúplných']) + ': ' + g.part.map(u => u + ' ks, ' + Math.round(u / g.per * 100) + ' %').join('; '));
    if (g.ride) out.push(g.ride + ' ks navrch');
    return out.join(', ');
  };
  const dist = new Map([...parts].map(([k, g]) => [k, [distText(g)]]));
  const distOf = x => dist.get((x.so || '') + '|' + x.code.toLowerCase()) || dist.get('|' + x.code.toLowerCase());
  mp.rows.forEach(x => { const d = distOf(x); x.planDist = d ? d.join(', ') : 'na žádné paletě'; });
  plan.forEach(b => b.contents.forEach(c => {
    if (idx.has(c.code.toLowerCase())) return;
    if (!mp.rows.some(x => x.code.toLowerCase() === c.code.toLowerCase())) mp.rows.push({ code: c.code, name: c.name || '', qty: 0, kg: 0, ci: ci(c.code), pack: 'paleta', full: 0, rem: 0, per: c.per || 1, fillRem: 0, count: 0, board: b.pal || 'JINÁ' });
    const row = mp.rows.find(x => x.code.toLowerCase() === c.code.toLowerCase());
    if (row.board) { row.qty += c.units; row.kg += c.units * (c.kg || 0); }
  }));
  mp.rows.forEach(x => { if (!x.planDist) { const d = distOf(x); x.planDist = d ? d.join(', ') : ''; } });
}

// Board pallets: material that is not in the catalog, placed by hand on a pallet type for this order only.
function addBoardPallets(mp, added, types, ci0) {
  (added || []).forEach((b, k) => {
    // a saved pallet type, or a one-off pallet defined only for this order
    const t = typeOf(types, b.pal) || b.custom, list = (b.contents || []).filter(c => c.units > 0);
    if (!t || !list.length) return;
    const ci = ci0 + 50 + k;
    const [m, ...rest] = list;
    mp.pallets.push({
      code: m.code, units: m.units, fill: list.reduce((s, c) => s + c.units / (c.per || c.units), 0),
      kg: (t.tare || 0) + list.reduce((s, c) => s + c.units * (c.kg || 0), 0), tare: t.tare || 0,
      pl: t.L, pw: t.W, rot: t.rot !== false, euro: isEuro({ pl: t.L, pw: t.W }), ci, pal: t.code, palName: t.name, palH: t.H || 0, maxKg: t.maxKg || 0,
      extra: rest.length ? rest.map(c => ({ code: c.code, units: c.units, ci, mixed: true, so: c.so })) : undefined, board: b.id, so: m.so
    });
    list.forEach(c => {
      const u = mp.unknown.find(x => x.code.toLowerCase() === c.code.toLowerCase() && (!c.so || !x.so || x.so === c.so));
      if (u) u.qty -= c.units;
      mp.rows.push({ code: c.code, name: c.name || '', qty: c.units, kg: c.units * (c.kg || 0), ci, pack: 'paleta', full: 0, rem: 0, per: c.per || c.units, fillRem: 0, count: 0, board: t.code });
    });
  });
  // what is fully placed is no longer unknown
  const left = mp.unknown.filter(u => u.qty > 0);
  const gone = mp.unknown.filter(u => u.qty <= 0).map(u => u.code);
  mp.unknown.length = 0; left.forEach(u => mp.unknown.push(u));
  if (gone.length) for (let i = mp.errors.length - 1; i >= 0; i--) if (gone.some(c => mp.errors[i].indexOf('„' + c + '“') >= 0)) mp.errors.splice(i, 1);
}

// Pure: order + catalog + vehicles + rules -> result. `forced` = vehicle index chosen by the user.
// `added` = pallets the operator put on the calculator board for this order: [{ id, pal, contents: [{ code, name, units, per, kg }] }]
export function solve(o, { catalog, vehicles, rules, combos = [], pallets = [], forced = null, added = [], plan = null, project, variant = null }) {
  const lines = [...o.lines.values()];
  // project of the order: chosen by hand, otherwise recognised by its key articles; balení of other projects do not apply
  // each zakázka is calculated on its own pallets (pallets do not mix zakázky); everything is tagged with its zakázka
  const sos = o.sos && o.sos.length ? o.sos : [o.id];
  // project per zakázka (an ID can carry an Action order and a small order without project); chosen by hand = for all
  const allCombos = combos, soProj = new Map(), soCombos = new Map();
  sos.forEach(so => {
    const sl = new Map([...o.lines].filter(([, l]) => (l.so || o.id) === so));
    const pj = project !== undefined ? project : ((projectOf({ lines: sl }, rules.projects) || {}).name || '');
    soProj.set(so, pj); soCombos.set(so, combosFor(allCombos, pj));
  });
  const projList = [...new Set([...soProj.values()].filter(Boolean))];
  const proj = project !== undefined ? project : projList.join(', ');
  combos = soCombos.get(sos[0]);
  const mp = { pallets: [], parcels: [], errors: [], rows: [], unknown: [] };
  sos.forEach(so => {
    const part = makePallets(lines.filter(l => (l.so || o.id) === so), catalog, soCombos.get(so), pallets, { mix: rules.mix !== false });
    const tag = x => Object.assign(x, { so });
    mp.pallets.push(...part.pallets.map(tag)); mp.parcels.push(...part.parcels.map(tag));
    mp.rows.push(...part.rows.map(tag)); mp.unknown.push(...part.unknown.map(tag));
    mp.errors.push(...part.errors.map(e => (sos.length > 1 ? 'Zakázka ' + so + ': ' : '') + e));
  });
  if (plan) applyPlan(mp, plan, lines, catalog, pallets);
  else addBoardPallets(mp, added, pallets, catalog.length);
  // article bigger than its pallet (posts, tubes): the pallet takes the size of its biggest article – that is the real
  // footprint in the vehicle, for LDM and for oversize; the pallet itself stays the same (palL × palW kept for the label)
  const sized = new Map(catalog.filter(a => a.aL > 0 || a.aW > 0).map(a => [String(a.code).toLowerCase(), a]));
  if (sized.size) mp.pallets.forEach(p => {
    let L = p.pl || 0, W = p.pw || 0, by = '';
    [p.code].concat((p.extra || []).map(e => e.code)).forEach(c => {
      const a = sized.get(String(c).toLowerCase()); if (!a) return;
      const al = Math.max(a.aL || 0, a.aW || 0), aw = Math.min(a.aL || al, a.aW || al);
      if (al > L) { L = al; by = c; }
      if (aw > W) { W = aw; by = by || c; }
    });
    if (by) { p.overhang = { code: by, palL: p.pl, palW: p.pw }; p.pl = L; p.pw = W; p.euro = false; }
  });
  // balení number on every balení pallet, also on hand-edited ones
  // main item with several imported balení (two V11): 1st pallet = 1st balení, 2nd = 2nd …
  const lowc = s => String(s).toLowerCase(), seenHost = new Map();
  mp.pallets.forEach(p => {
    if (p.group) { p.tag = p.group; return; }
    const ks = [...new Set((soCombos.get(p.so) || combos).filter(r => r.mode === 'host' && r.strict && lowc(r.host) === lowc(p.code)).map(koliOf).filter(Boolean))].sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')));
    if (!ks.length) return;
    const n = seenHost.get(lowc(p.code)) || 0; seenHost.set(lowc(p.code), n + 1);
    p.tag = ks[n % ks.length];
  });
  // what waits on the right says which balení it belongs to
  mp.unknown.forEach(u => {
    if (u.hint) return;
    const own = (soCombos.get(u.so) || combos).filter(r => lowc(r.code) === lowc(u.code));
    const hr = own.filter(r => r.mode === 'host' && r.strict);
    const grp = [...new Set(own.filter(r => r.mode === 'group').map(r => r.group))];
    // přibal: name the main items (what is on the board) and say that none of them is in this zakázka
    const inOrder = new Set(lines.filter(l => !u.so || (l.so || o.id) === u.so).map(l => lowc(l.code)));
    if (hr.length) {
      const hosts = [...new Set(hr.map(r => r.host))], here = hosts.filter(h => inOrder.has(lowc(h)));
      const bal = [...new Set(hr.map(koliOf).filter(Boolean))].join(', ');
      u.hint = here.length ? 'přibal k ' + here.join(', ') + (bal ? ' (' + bal + ')' : '') + ' – nevešel se'
        : 'přibal k ' + hosts.slice(0, 2).join(', ') + (hosts.length > 2 ? ' …' : '') + (bal ? ' (' + bal + ')' : '') + ' – ta hlavní položka v zakázce není';
    }
    else if (grp.length) u.hint = 'patří do ' + grp.join(', ');
  });
  const r = {
    id: o.id, sos, project: proj, soProj, planOn: !!plan, plan, pallets: mp.pallets, parcels: mp.parcels, errors: mp.errors, rows: mp.rows, unknown: mp.unknown,
    kg: 0, units: 0, groupage: null, parcelInfo: null, vehicles: [], oversize: [], mode: 'empty', reco: '', forced
  };
  // goods + own weight of the pallets
  r.kg = mp.rows.reduce((s, x) => s + x.kg, 0) + mp.pallets.reduce((s, p) => s + (p.tare || 0), 0);
  r.tare = mp.pallets.reduce((s, p) => s + (p.tare || 0), 0);
  r.units = mp.rows.reduce((s, x) => s + x.qty, 0);
  const pool = prepareVehicles(vehicles);
  const widest = pool.slice().sort((a, b) => b.Lmm * b.Wmm - a.Lmm * a.Wmm)[0];
  // LDM is an industry unit: 1 m of trailer length at the standard width of 2.4 m
  const ldmW = 2400; void widest;
  r.ldm = mp.pallets.reduce((s, p) => s + p.pl * p.pw, 0) / ldmW / 1000;
  r.euroCount = mp.pallets.filter(p => p.euro).length;
  r.big = [];
  mp.pallets.forEach(p => {
    const lg = Math.max(p.pl, p.pw), sh = Math.min(p.pl, p.pw);
    if (lg >= rules.oL * 1000 - EPS || sh > rules.oW * 1000 + EPS) {
      const t = p.code + ' ' + lg + '×' + sh + ' mm'; if (r.big.indexOf(t) < 0) r.big.push(t);
    }
  });
  if (mp.parcels.length) r.parcelInfo = parcelCheck(mp.parcels, rules);

  const info = [];
  if (mp.pallets.length) info.push(mp.pallets.length + ' ' + palWord(mp.pallets.length));
  if (mp.parcels.length) info.push(mp.parcels.length + ' ' + balWord(mp.parcels.length));
  if (!info.length) { r.listInfo = 'žádná data'; r.stat = 'Zkontrolovat'; return r; }
  r.listInfo = info.join(' + ') + ', ' + fmtKg(r.kg);

  if (!mp.pallets.length) {
    r.mode = r.parcelInfo.ok ? 'parcels' : 'warn';
    r.stat = r.parcelInfo.ok ? 'Balíky' : 'Zkontrolovat';
    return r;
  }
  r.groupage = groupageCheck(mp.pallets, rules);
  if (r.groupage.ok && forced == null) { r.mode = 'groupage'; r.stat = 'Sběrná služba'; }
  else {
    if (sos.length > 1) mp.pallets.forEach(p => { p.showSo = true; });
    // different datum dodání (SO „551220·21.07.26“) = different loading days: every date is loaded on its own
    const termOf = so => { const m = String(so).match(/·(.+)$/); return m ? m[1] : ''; };
    const terms = [...new Set(sos.map(termOf))];
    let pk;
    if (terms.length > 1) {
      pk = { vehicles: [], oversize: [] };
      terms.forEach(t => {
        const tsos = sos.filter(so => termOf(so) === t), part = packAll(mp.pallets.filter(p => tsos.includes(p.so)), vehicles, forced, rules.oneVeh !== false, tsos, rules);
        part.vehicles.forEach(v => { v.term = t; v.title = v.title + (t ? ' · ' + t : ''); });
        pk.vehicles.push(...part.vehicles); pk.oversize.push(...part.oversize);
      });
    } else pk = packAll(mp.pallets, vehicles, forced, rules.oneVeh !== false, sos, rules);
    // a second variant (every zakázka in its own vehicles) when it needs more vehicles: the dispatcher decides
    if (pk.alt) { r.variants = [{ key: 'min', label: 'Méně vozidel', n: pk.vehicles.length }, { key: 'sep', label: pk.alt.label, n: pk.alt.vehicles.length }]; r.variant = variant === 'sep' ? 'sep' : 'min'; if (variant === 'sep') pk = pk.alt; }
    r.vehicles = pk.vehicles; r.oversize = pk.oversize;
    r.reco = recoText(pk.vehicles);
    if (pk.oversize.length) { r.mode = 'warn'; r.stat = 'Zkontrolovat'; }
    else { r.mode = 'trucks'; r.stat = pk.vehicles.length + ' ' + vehWord(pk.vehicles.length); }
  }
  if (r.parcelInfo && !r.parcelInfo.ok && r.mode !== 'warn') { r.mode = 'warn'; r.stat = 'Zkontrolovat'; }
  return r;
}
