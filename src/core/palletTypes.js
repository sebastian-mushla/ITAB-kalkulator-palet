// Level 2: pallet types (PAL-0001 …). Articles (level 3) point to a type with `pal` and say how many pcs fit (`per`).
const low = s => String(s == null ? '' : s).trim().toLowerCase();

export function typeOf(types, code) {
  return (types || []).find(t => low(t.code) === low(code)) || null;
}

export function nextCode(types) {
  const n = (types || []).reduce((m, t) => { const x = /PAL-(\d+)/i.exec(t.code || ''); return x ? Math.max(m, Number(x[1])) : m; }, 0);
  return 'PAL-' + String(n + 1).padStart(4, '0');
}

const sameSize = (t, L, W) => (t.L === L && t.W === W) || (t.L === W && t.W === L);

// Old catalogs kept pallet sizes on the article. Give every such article a pallet type, creating types as needed.
export function migrateCatalog(catalog, types) {
  const ts = (types || []).map(t => Object.assign({}, t));
  let changed = false;
  const cat = catalog.map(a => {
    if (a.pack === 'balik' || (a.pal && typeOf(ts, a.pal))) return a;
    if (!(a.pl > 0 && a.pw > 0)) return a;
    let t = ts.find(x => sameSize(x, a.pl, a.pw));
    if (!t) {
      const euro = sameSize({ L: 1200, W: 800 }, a.pl, a.pw);
      t = { code: nextCode(ts), name: euro ? 'Europaleta' : 'Paleta ' + Math.round(a.pl / 10) + ' × ' + Math.round(a.pw / 10), L: a.pl, W: a.pw, H: euro ? 144 : 0, tare: euro ? 25 : 0, maxKg: euro ? 1500 : 0, rot: a.rot !== false };
      ts.push(t);
    }
    changed = true;
    return Object.assign({}, a, { pal: t.code });
  });
  return { catalog: cat, types: ts, changed: changed || ts.length !== (types || []).length };
}

// Article as the calculation needs it: pallet size, tare and limits taken from its pallet type.
export function resolveArticle(a, types) {
  if (a.pack === 'balik') return a;
  const t = typeOf(types, a.pal);
  if (!t) return a;
  return Object.assign({}, a, { pl: t.L, pw: t.W, pal: t.code, palName: t.name, palH: t.H || 0, tare: t.tare || 0, maxKg: t.maxKg || 0, rot: a.rot !== false && t.rot !== false });
}
