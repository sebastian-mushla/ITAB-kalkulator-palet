// Acceptance tests from CLAUDE.md. Run in the browser (tests/index.html) or with `node --test tests/`.
import { parseOrders, rowsToOrderText } from '../src/core/parse.js';
import { fromResult, replaceVehicle, viewOf } from '../src/core/manual.js';
import { loadStats } from '../src/core/packing.js';
import { freezePlan, moveUnits, mergePallets } from '../src/core/plan.js';
import { solve } from '../src/core/solve.js';
import { DEFAULT_CATALOG, DEFAULT_VEHICLES, DEFAULT_RULES, DEFAULT_COMBOS, DEFAULT_PALLETS, SAMPLE } from '../src/core/defaults.js';
import { migrateCatalog } from '../src/core/palletTypes.js';
import { parseCsvRows, rowsToCatalog, rowsToVehicles, rowsToCombos, mergeBy } from '../src/io/importTable.js';

const ctx = { catalog: DEFAULT_CATALOG, vehicles: DEFAULT_VEHICLES, rules: DEFAULT_RULES, combos: DEFAULT_COMBOS, pallets: DEFAULT_PALLETS };
const RULE_ON = [Object.assign({}, DEFAULT_COMBOS[0], { on: true })];
const order = t => parseOrders(t).orders.values().next().value;
const EPS = 0.5;

function assert(c, msg) { if (!c) throw new Error(msg); }
const line = (o, code) => [...o.lines.values()].find(l => l.code.toLowerCase() === code.toLowerCase());
function run(id, extra) {
  const o = parseOrders(SAMPLE).orders.get(id);
  return solve(o, Object.assign({}, ctx, extra || {}));
}
function checkLayout(r) {
  r.vehicles.forEach(v => {
    v.items.forEach((a, i) => {
      assert(a.x >= -EPS && a.y >= -EPS && a.x + a.w <= v.L + EPS && a.y + a.h <= v.W + EPS, v.title + ': paleta mimo korbu');
      v.items.forEach((b, j) => {
        if (j <= i) return;
        const overlap = a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;
        assert(!overlap, v.title + ': palety se překrývají');
      });
    });
    assert(v.kg <= v.maxKg, v.title + ': překročena nosnost');
  });
}

export const cases = [
  ['505111: 24 palet, 7120 kg (6920 zboží + 8 europalet × 25 kg), LDM ~22,8, nadrozměr, 2× kamion', () => {
    const r = run('505111');
    assert(r.pallets.length === 24, 'palet: ' + r.pallets.length);
    assert(Math.round(r.kg) === 7120, 'kg: ' + r.kg);
    assert(Math.abs(r.ldm - 22.8) < 0.1, 'LDM: ' + r.ldm);
    assert(r.big.length === 2, 'nadrozměr: ' + r.big.join(', '));
    assert(!r.groupage.ok, 'sběrná služba by neměla projít');
    assert(r.mode === 'trucks', 'mode: ' + r.mode);
    assert(r.vehicles.length === 2 && r.vehicles.every(v => v.type === 'kamion'), 'vozidla: ' + r.reco);
    const pol = r.rows.find(x => x.code === 'V-POL');
    assert(pol.full === 7 && pol.rem === 148, 'V-POL: ' + pol.full + ' + ' + pol.rem);
    checkLayout(r);
  }],
  ['505112: 1 europaleta, 493 kg (468 + 25), sběrná služba', () => {
    const r = run('505112');
    assert(r.pallets.length === 1 && r.euroCount === 1, 'palet: ' + r.pallets.length);
    assert(Math.round(r.kg) === 493, 'kg: ' + r.kg);
    assert(r.mode === 'groupage', 'mode: ' + r.mode);
  }],
  ['Ruční volba vozidla: 505112 na plachťáku', () => {
    const r = run('505112', { forced: 1 });
    assert(r.mode === 'trucks' && r.vehicles.length === 1 && r.vehicles[0].type === 'plachta', r.reco);
    checkLayout(r);
  }],
  ['Ruční volba: 505111 na dodávce → nadrozměr se nevejde', () => {
    const r = run('505111', { forced: 3 });
    assert(r.mode === 'warn' && r.oversize.length > 0, 'mode: ' + r.mode);
    checkLayout(r);
  }],
  ['Jedna zakázka = jedno vozidlo: 5 europalet (2340 kg) → 1 kamion, ne 3 dodávky', () => {
    const r = solve(parseOrders('X;V-POL;' + (156 * 5)).orders.get('X'), ctx);
    assert(r.vehicles.length === 1 && r.vehicles[0].type === 'kamion', r.reco);
    checkLayout(r);
  }],
  ['Jedna zakázka = jedno vozidlo: 2 europalety (900 kg) → nejlevnější vozidlo, které unese vše', () => {
    const r = solve(parseOrders('X;V-POL;300').orders.get('X'), Object.assign({}, ctx, { rules: Object.assign({}, DEFAULT_RULES, { gMax: 0 }) }));
    assert(r.vehicles.length === 1 && r.vehicles[0].type === 'dodavka', r.reco);
    checkLayout(r);
  }],
  ['Pravidlo vypnuto: 5 europalet → menší vozidla, bez kamionu', () => {
    const o = parseOrders('X;V-POL;' + (156 * 5)).orders.get('X');
    const r = solve(o, Object.assign({}, ctx, { rules: Object.assign({}, DEFAULT_RULES, { oneVeh: false }) }));
    assert(r.mode === 'trucks' && r.vehicles.every(v => v.type !== 'kamion'), r.reco);
    checkLayout(r);
  }],
  ['Počet europalet na kamionu ≤ 33', () => {
    const o = parseOrders('X;V-POL;' + (156 * 40)).orders.get('X');
    const r = solve(o, ctx);
    assert(r.vehicles.every(v => v.items.length <= 33), r.reco);
    checkLayout(r);
  }],
  ['Balíky: sběrná služba, těžký balík → kontrola', () => {
    const catalog = DEFAULT_CATALOG.concat([
      { code: 'KAB', name: 'Kabel', pack: 'balik', pl: 400, pw: 300, per: 10, kg: 1.5, rot: true },
      { code: 'TIS', name: 'Tiskárna', pack: 'balik', pl: 500, pw: 400, per: 1, kg: 40, rot: true }
    ]);
    const a = solve(parseOrders('A;KAB;25').orders.get('A'), Object.assign({}, ctx, { catalog }));
    assert(a.mode === 'parcels' && a.parcels.length === 3, 'mode ' + a.mode + ', balíků ' + a.parcels.length);
    const b = solve(parseOrders('B;TIS;1').orders.get('B'), Object.assign({}, ctx, { catalog }));
    assert(b.mode === 'warn', 'mode ' + b.mode);
  }],
  ['Import číselníku z examples/catalog.csv', () => {
    const csv = 'article,name,pallet_length_mm,pallet_width_mm,units_per_pallet,unit_kg,rotatable\nV06,Kabina,2450,1300,1,200,true\nV-POL,Police,1200,800,156,3,true\nBAD,,0,800,1,2,true';
    const res = rowsToCatalog(parseCsvRows(csv));
    assert(res.items.length === 2 && res.errors.length === 1, JSON.stringify(res.errors));
    assert(res.items[1].per === 156 && res.items[1].kg === 3 && res.items[1].pack === 'paleta', JSON.stringify(res.items[1]));
    const m = mergeBy(DEFAULT_CATALOG, res.items, a => a.code.toLowerCase());
    assert(m.added === 0 && m.updated === 2, 'merge');
  }],
  ['Import českého CSV se středníky a desetinnou čárkou', () => {
    const csv = 'Artikl;Název;Balení;Délka palety, mm;Šířka palety, mm;Ks na paletě;Váha kusu, kg\nP1;"Pokladna; malá";paleta;1200;800;24;4,5\nB1;Kabel;balík;300;200;5;0,8';
    const res = rowsToCatalog(parseCsvRows(csv));
    assert(res.errors.length === 0, res.errors.join('; '));
    assert(res.items[0].name === 'Pokladna; malá' && res.items[0].kg === 4.5 && res.items[0].per === 24, JSON.stringify(res.items[0]));
    assert(res.items[1].pack === 'balik', 'balení');
  }],
  ['Import vozidel (rozměry v mm i m)', () => {
    const csv = 'Název;Typ;Délka;Šířka;Nosnost kg;Europalet;Čelo\nFura;kamion;13600;2450;24000;33;ne\nBus s čelem;;4,2;2;1000;6;ano';
    const res = rowsToVehicles(parseCsvRows(csv));
    assert(res.errors.length === 0, res.errors.join('; '));
    assert(res.items[0].L === 13.6 && res.items[0].type === 'kamion', JSON.stringify(res.items[0]));
    assert(res.items[1].L === 4.2 && res.items[1].lift === true && res.items[1].type === 'celo', JSON.stringify(res.items[1]));
  }],
  ['Zakázka z tabulky se záhlavím (Excel)', () => {
    const rows = [['Zakázka', 'Artikl', 'Název', 'Množství'], ['1001', 'V-POL', 'Police', 300], ['1001', 'V06', 'Kabina', 1]];
    const res = parseOrders(rowsToOrderText(rows));
    const o = res.orders.get('1001');
    assert(res.problems.length === 0 && o && o.lines.size === 2, res.problems.join('; '));
  }]
];

cases.push(
  ['Kombinace: V06 6 + V04 5 → V04 na paletách kabin', () => {
    const r = solve(order('A;V06;6\nA;V04;5'), Object.assign({}, ctx, { combos: RULE_ON }));
    assert(r.pallets.length === 6 && r.pallets.every(p => p.code === 'V06'), 'palet: ' + r.pallets.length);
    assert(Math.round(r.kg) === 2200 && Math.round(r.pallets.reduce((s, p) => s + p.kg, 0)) === 2200, 'kg: ' + r.kg);
    const v04 = r.rows.find(x => x.code === 'V04');
    assert(v04.onHost === 5 && v04.count === 0 && v04.rule, JSON.stringify(v04));
    checkLayout(r);
  }],
  ['Kombinace: V04 12 ks (nad limit) → běžný výpočet', () => {
    const r = solve(order('A;V06;6\nA;V04;12'), Object.assign({}, ctx, { combos: RULE_ON }));
    assert(r.pallets.length === 18, 'palet: ' + r.pallets.length);
  }],
  ['Kombinace: bez kabiny v zakázce → V04 na svých paletách', () => {
    const r = solve(order('A;V04;5'), Object.assign({}, ctx, { combos: RULE_ON }));
    assert(r.pallets.length === 5 && r.pallets.every(p => p.code === 'V04'), 'palet: ' + r.pallets.length);
  }],
  ['Kombinace: max ks na hostitelskou paletu, zbytek normálně', () => {
    const combos = [Object.assign({}, RULE_ON[0], { per: 1 })];
    const r = solve(order('A;V06;3\nA;V04;5'), Object.assign({}, ctx, { combos }));
    assert(r.pallets.length === 5 && r.pallets.filter(p => p.extra).length === 3, 'palet: ' + r.pallets.length);
  }],
  ['Kombinace: jiná paleta a balík', () => {
    const combos = [
      { on: true, code: 'V-POL', withCode: '', min: 0, max: 100, mode: 'parcel', host: '', pl: 400, pw: 300, per: 10, note: '' },
      { on: true, code: 'V-POL', withCode: '', min: 101, max: 0, mode: 'pallet', host: '', pl: 800, pw: 600, per: 50, note: '' }
    ];
    const a = solve(order('A;V-POL;40'), Object.assign({}, ctx, { combos }));
    assert(a.mode === 'parcels' && a.parcels.length === 4, 'mode ' + a.mode);
    const b = solve(order('B;V-POL;120'), Object.assign({}, ctx, { combos }));
    assert(b.pallets.length === 3 && b.pallets[0].pl === 800, 'palet: ' + b.pallets.length);
  }],
  ['Import kombinací z CSV', () => {
    const res = rowsToCombos(parseCsvRows('aktivni;artikl;kdyz_je_v_zakazce;mnozstvi_od;mnozstvi_do;pojede;cil;delka_mm;sirka_mm;max_ks_na_paletu;poznamka\nano;V04;V06;;10;na palete artiklu;V06;;;2;x'));
    assert(res.errors.length === 0 && res.items[0].mode === 'host' && res.items[0].host === 'V06' && res.items[0].max === 10 && res.items[0].per === 2, JSON.stringify(res));
  }]
);

cases.push(
  ['Učení: neznámý artikl → seznam neznámých', () => {
    const r = solve(order('A;V06;2\nA;XX-1;5'), ctx);
    assert(r.unknown.length === 1 && r.unknown[0].code === 'XX-1' && r.unknown[0].qty === 5, JSON.stringify(r.unknown));
  }],
  ['Učení: kombinace pro neznámý artikl → jede na V06, váha z pravidla', () => {
    const combos = [{ on: true, code: 'XX-1', withCode: 'V06', min: 0, max: 5, mode: 'host', host: 'V06', pl: 0, pw: 0, per: 0, kg: 2 }];
    const r = solve(order('A;V06;2\nA;XX-1;5'), Object.assign({}, ctx, { combos }));
    assert(r.unknown.length === 0 && r.pallets.length === 2, 'unknown ' + r.unknown.length + ', palet ' + r.pallets.length);
    assert(r.pallets.some(p => p.extra && p.extra[0].code === 'XX-1' && p.extra[0].units === 5), 'extra');
    assert(Math.round(r.kg) === 410, 'kg ' + r.kg);
  }],
  ['Učení: víc kusů než v kombinaci → znovu neznámý', () => {
    const combos = [{ on: true, code: 'XX-1', withCode: 'V06', min: 0, max: 5, mode: 'host', host: 'V06', pl: 0, pw: 0, per: 0, kg: 2 }];
    const r = solve(order('A;V06;2\nA;XX-1;8'), Object.assign({}, ctx, { combos }));
    assert(r.unknown.length === 1 && r.unknown[0].qty === 8, JSON.stringify(r.unknown));
  }]
);

cases.push(['Vložená tabulka se 4 sloupci (název uprostřed)', () => {
  const res = parseOrders('zakazka\tartikl\tnazev\tmnozstvi\n800001\tV06\tKabina\t3\n800001\tNEW-A\tDržák displeje\t4');
  const o = res.orders.get('800001');
  assert(res.problems.length === 0 && line(o, 'V06').qty === 3 && line(o, 'NEW-A').qty === 4, res.problems.join('; '));
}]);

cases.push(['Názvy artiklů ze zakázky (ERP, vložená tabulka, Excel)', () => {
  const erp = parseOrders('SO 1\nr10 XX-1 drzak displeje 5');
  const erpL = line(parseOrders('SO 1\nr10 XX-1 drzak displeje 5').orders.get('1'), 'XX-1');
  assert(erpL.name === 'drzak displeje', 'erp: ' + erpL.name);
  const tab = parseOrders('2\tNEW-A\tDržák displeje\t4').orders.get('2'); const tabL = line(tab, 'NEW-A');
  assert(tabL.name === 'Držák displeje' && tabL.qty === 4, 'tab: ' + JSON.stringify(tabL));
  const xl = parseOrders(rowsToOrderText([['Zakázka', 'Artikl', 'Název', 'Množství'], ['3', 'NEW-B', 'Kryt', 10]])).orders.get('3'); const xlL = line(xl, 'NEW-B');
  assert(xlL.name === 'Kryt' && xlL.qty === 10, 'xlsx: ' + JSON.stringify(xlL));
  const r = solve(parseOrders('2\tNEW-A\tDržák displeje\t4').orders.get('2'), ctx);
  assert(r.unknown[0].name === 'Držák displeje', 'unknown name');
}]);

cases.push(['Přetížené vozidlo → nové vozidlo převezme všechny palety, staré zmizí', () => {
  const r = solve(parseOrders('X;V-POL;300').orders.get('X'), Object.assign({}, ctx, { rules: Object.assign({}, DEFAULT_RULES, { gMax: 0 }) }));
  const m = fromResult(r);
  m.vehicles[0].items.forEach(i => { i.kg = 700; });          // simulate overload in a 1000 kg van
  const before = viewOf(r, m, DEFAULT_VEHICLES);
  assert(before.overweight.length === 1, 'not overloaded');
  assert(replaceVehicle(m, DEFAULT_VEHICLES, 0, 0), 'replace failed');
  const after = viewOf(r, m, DEFAULT_VEHICLES);
  assert(after.vehicles.length === 1 && after.vehicles[0].type === 'kamion' && after.vehicles[0].items.length === 2 && !after.overweight.length, after.reco);
  checkLayout(after);
}]);

cases.push(['Rozložení váhy: těžké palety u kabiny, levá/pravá strana vyvážená', () => {
  const r = solve(parseOrders('B;V-POL;' + (156 * 10) + '\nB;V06;4').orders.get('B'), ctx);
  checkLayout(r);
  r.vehicles.forEach(v => {
    const usedL = Math.max(...v.items.map(i => i.x + i.w)), st = loadStats(v.items, v.W);
    assert(st.cg <= usedL / 2 + 1, v.title + ': těžiště ' + Math.round(st.cg) + ' mm, polovina ' + usedL / 2);
  });
  // same-size pallets of different weight: heavy ones go to the cab and both sides even out
  const catalog = DEFAULT_CATALOG.concat([{ code: 'LEH', name: 'Lehké', pack: 'paleta', pl: 1200, pw: 800, per: 1, kg: 40, rot: true }]);
  const r2 = solve(parseOrders('C;V-POL;' + (156 * 9) + '\nC;LEH;9').orders.get('C'), Object.assign({}, ctx, { catalog }));
  checkLayout(r2);
  const v = r2.vehicles[0], usedL = Math.max(...v.items.map(i => i.x + i.w)), st = loadStats(v.items, v.W);
  assert(st.cg < usedL * 0.4, 'těžiště ' + Math.round(st.cg) + ' z ' + usedL);
  assert(Math.abs(st.leftPct - 50) <= 10, 'vlevo ' + st.leftPct + ' %');
}]);

cases.push(
  ['Palety: migrace starého číselníku na typy PAL-xxxx', () => {
    const old = [{ code: 'A', pack: 'paleta', pl: 1200, pw: 800, per: 10, kg: 1 }, { code: 'B', pack: 'paleta', pl: 800, pw: 1200, per: 5, kg: 1 }, { code: 'C', pack: 'paleta', pl: 2000, pw: 1000, per: 1, kg: 1 }, { code: 'D', pack: 'balik', pl: 300, pw: 200, per: 1, kg: 1 }];
    const m = migrateCatalog(old, []);
    assert(m.types.length === 2 && m.types[0].code === 'PAL-0001' && m.types[0].name === 'Europaleta' && m.types[0].tare === 25, JSON.stringify(m.types));
    assert(m.catalog[0].pal === 'PAL-0001' && m.catalog[1].pal === 'PAL-0001' && m.catalog[2].pal === 'PAL-0002' && !m.catalog[3].pal, JSON.stringify(m.catalog));
  }],
  ['Palety: zbytky různých artiklů na stejném typu → jedna smíšená paleta', () => {
    const catalog = DEFAULT_CATALOG.concat([{ code: 'SK', name: 'Skener', pack: 'paleta', pal: 'PAL-0001', per: 100, kg: 1, rot: true }]);
    const r = solve(order('M;V-POL;' + (156 + 78) + '\nM;SK;30'), Object.assign({}, ctx, { catalog, rules: Object.assign({}, DEFAULT_RULES, { gMax: 0 }) }));
    assert(r.pallets.length === 2, 'palet ' + r.pallets.length);
    const mixed = r.pallets.find(p => p.extra && p.extra.some(e => e.mixed));
    assert(mixed && Math.abs(mixed.fill - 0.8) < 0.01, 'fill ' + (mixed && mixed.fill));
    assert(Math.round(r.kg) === 234 * 3 + 30 + 2 * 25, 'kg ' + r.kg);
    const off = solve(order('M;V-POL;' + (156 + 78) + '\nM;SK;30'), Object.assign({}, ctx, { catalog, rules: Object.assign({}, DEFAULT_RULES, { gMax: 0, mix: false }) }));
    assert(off.pallets.length === 3, 'bez míchání ' + off.pallets.length);
  }]
);

cases.push(['Ručně přidaná paleta: materiál mimo číselník na PAL-0001', () => {
  const added = [{ id: 'b1', pal: 'PAL-0001', contents: [{ code: 'NN-1', name: 'Nový', units: 30, per: 60, kg: 2 }] }];
  const r = solve(order('Q;V06;1\nQ;NN-1;50'), Object.assign({}, ctx, { added }));
  const bp = r.pallets.find(p => p.board === 'b1');
  assert(bp && bp.pal === 'PAL-0001' && bp.units === 30 && Math.abs(bp.fill - 0.5) < 1e-9 && bp.kg === 25 + 60, JSON.stringify(bp));
  assert(r.unknown.length === 1 && r.unknown[0].qty === 20, JSON.stringify(r.unknown));
  const r2 = solve(order('Q;V06;1\nQ;NN-1;30'), Object.assign({}, ctx, { added }));
  assert(r2.unknown.length === 0 && !r2.errors.some(e => e.indexOf('NN-1') >= 0), 'vše položeno');
  checkLayout(r2);
}]);

cases.push(['Ruční úprava palet: přesun 48 polic z neúplné palety na novou', () => {
  const r = run('505111');
  const plan = freezePlan(r, DEFAULT_CATALOG);
  const part = plan.find(b => b.contents[0].code === 'V-POL' && b.contents[0].units === 148);
  assert(part, 'neúplná paleta 148 ks');
  assert(moveUnits(plan, part.id, 'V-POL', 48, 'new'), 'přesun');
  const r2 = run('505111', { plan });
  assert(r2.pallets.length === 25, 'palet ' + r2.pallets.length);
  assert(r2.unknown.length === 0, 'nic nechybí: ' + JSON.stringify(r2.unknown));
  assert(r2.pallets.some(p => p.code === 'V-POL' && p.units === 100) && r2.pallets.some(p => p.code === 'V-POL' && p.units === 48), 'rozdělení 100 + 48');
  assert(Math.round(r2.kg) === 7120 + 25, 'kg ' + r2.kg);
  checkLayout(r2);
  // taking pieces off a pallet without a target leaves them "to place"
  plan.find(b => b.contents[0].units === 100).contents[0].units = 90;
  const r3 = run('505111', { plan });
  assert(r3.unknown.length === 1 && r3.unknown[0].qty === 10 && r3.unknown[0].known, JSON.stringify(r3.unknown));
}]);

cases.push(['Sloučení palet: přeloží se jen to, co se vejde, zbytek zůstane', () => {
  const plan = [
    { id: 'a', pal: 'PAL-0001', contents: [{ code: 'V-POL', units: 100, per: 156, kg: 3 }] },
    { id: 'b', pal: 'PAL-0001', contents: [{ code: 'V-POL', units: 30, per: 156, kg: 3 }] },
    { id: 'c', pal: 'PAL-0001', contents: [{ code: 'V-POL', units: 40, per: 156, kg: 3 }] }
  ];
  let res = mergePallets(plan, 'b', 'a', DEFAULT_PALLETS);
  assert(res.moved === 30 && res.left === 0 && plan.length === 2, JSON.stringify(res));
  res = mergePallets(plan, 'c', 'a', DEFAULT_PALLETS);
  assert(res.moved === 26 && res.left === 14 && plan.find(b => b.id === 'a').contents[0].units === 156, JSON.stringify(res));
}]);

cases.push(
  ['ID → zakázky: import se sloupcem ID, pořadí zakázek z importu', () => {
    const t = 'ID;Zakázka;Artikl;Název;Množství\nA1;5001;V-POL;Police;156\nA1;5002;V06;Kabina;2\nA1;5003;V-POL;Police;100\nB7;6001;V04;Dopravník;1';
    const res = parseOrders(t);
    assert(res.problems.length === 0 && res.orders.size === 2, res.problems.join('; ') + ' / ' + res.orders.size);
    const a = res.orders.get('A1');
    assert(a.sos.join(',') === '5001,5002,5003' && a.lines.size === 3, JSON.stringify(a.sos));
  }],
  ['ID: palety nemíchají zakázky a nesou číslo zakázky', () => {
    const o = parseOrders('ID;Zakázka;Artikl;Množství\nA1;5001;V-POL;100\nA1;5002;V-POL;30').orders.get('A1');
    const r = solve(o, Object.assign({}, ctx, { rules: Object.assign({}, DEFAULT_RULES, { gMax: 0 }) }));
    assert(r.pallets.length === 2 && r.pallets.map(p => p.so).sort().join(',') === '5001,5002', JSON.stringify(r.pallets.map(p => [p.so, p.units])));
  }],
  ['ID: když se nevejde do jednoho vozidla, zakázky se nakládají postupně', () => {
    // 3 zakázky po 12 kabinách (kabina 245 × 130): do kamionu se vejde 10 kabin → zbytek do dalšího vozidla
    const t = 'ID;Zakázka;Artikl;Množství\nX;1;V06;12\nX;2;V06;12\nX;3;V06;12';
    const r = solve(parseOrders(t).orders.get('X'), ctx);
    checkLayout(r);
    assert(r.vehicles.length >= 2, r.reco);
    const firstSo = r.vehicles.map(v => Math.min(...v.items.map(i => Number(i.so))));
    assert(firstSo.every((x, i) => i === 0 || x >= firstSo[i - 1]), 'pořadí ' + firstSo);
    assert(r.vehicles[0].items.every(i => i.so === '1' || i.so === '2'), 'v1: ' + [...new Set(r.vehicles[0].items.map(i => i.so))]);
  }]
);

cases.push(['Palety z různých zakázek se nesloučí a přesun na cizí zakázku je blokovaný', () => {
  const plan = [
    { id: 'a', pal: 'PAL-0001', contents: [{ code: 'V-POL', units: 50, per: 156, kg: 3, so: '1' }] },
    { id: 'b', pal: 'PAL-0001', contents: [{ code: 'V-POL', units: 30, per: 156, kg: 3, so: '3' }] }
  ];
  const r1 = mergePallets(plan, 'b', 'a', DEFAULT_PALLETS);
  assert(r1.blocked && r1.moved === 0 && plan.length === 2, JSON.stringify(r1));
  assert(moveUnits(plan, 'b', 'V-POL', 10, 'a') === false, 'move blocked');
  assert(plan[0].contents[0].units === 50 && plan[1].contents[0].units === 30, 'nic se nezměnilo');
  const nid = moveUnits(plan, 'b', 'V-POL', 10, 'new');
  assert(nid && plan.find(x => x.id === nid).contents[0].so === '3', 'nová paleta nese zakázku 3');
}]);

export function runAll() {
  return cases.map(([name, fn]) => {
    try { fn(); return { name, ok: true }; } catch (e) { return { name, ok: false, msg: e.message }; }
  });
}
