// pack: 'paleta' = goes on its own pallets, 'balik' = parcel (no pallet), pl/pw are then the parcel size.
export const DEFAULT_CATALOG = [
  { code: 'V06', name: 'Kabina', pack: 'paleta', pal: 'PAL-0002', per: 1, kg: 200, rot: true },
  { code: 'V04', name: 'Dopravník', pack: 'paleta', pal: 'PAL-0003', per: 1, kg: 200, rot: true },
  { code: 'V-POL', name: 'Police', pack: 'paleta', pal: 'PAL-0001', per: 156, kg: 3, rot: true }
];

// Level 2: pallet types. L, W, H in mm, tare = own weight kg, maxKg = max load (0 = not checked).
export const DEFAULT_PALLETS = [
  { code: 'PAL-0001', name: 'Europaleta', L: 1200, W: 800, H: 144, tare: 25, maxKg: 1500, rot: true },
  { code: 'PAL-0002', name: 'Paleta kabina 245 × 130', L: 2450, W: 1300, H: 150, tare: 0, maxKg: 0, rot: true },
  { code: 'PAL-0003', name: 'Paleta dopravník 350 × 80', L: 3500, W: 800, H: 150, tare: 0, maxKg: 0, rot: true }
];

// L, W in metres. eup = max pallets on board (0 = no limit). cost = relative price, lower wins.
export const DEFAULT_VEHICLES = [
  // typical inner dimensions / payloads in CZ & EU (see 'Jak to funguje'); the operator adjusts them to his carriers
  { name: 'Kamion – návěs 13,6 m (plachta)', type: 'kamion', L: 13.6, W: 2.45, kg: 24000, eup: 33, lift: false, cost: 1 },
  { name: 'Plachťák 3,5 t (8 palet)', type: 'plachta', L: 4.8, W: 2.2, kg: 1100, eup: 8, lift: false, cost: 0.35 },
  { name: 'Dodávka 3,5 t s hydraulickým čelem', type: 'celo', L: 4.2, W: 2.1, kg: 900, eup: 8, lift: true, cost: 0.4 },
  { name: 'Dodávka 3,5 t (skříň)', type: 'dodavka', L: 3.7, W: 1.75, kg: 1100, eup: 5, lift: false, cost: 0.25 },
  { name: 'Sólo 7,5 t (15 palet)', type: 'solo', L: 6.0, W: 2.45, kg: 2800, eup: 15, lift: true, cost: 0.55 },
  { name: 'Sólo 12 t (17 palet)', type: 'solo', L: 7.2, W: 2.45, kg: 5500, eup: 17, lift: true, cost: 0.7 },
  { name: 'Sólo 18 t (20 palet)', type: 'solo', L: 8.2, W: 2.45, kg: 9000, eup: 20, lift: false, cost: 0.8 }
];

export const VEHICLE_TYPES = [
  ['kamion', 'Kamion'], ['plachta', 'Plachťák'], ['celo', 'Dodávka s čelem'], ['dodavka', 'Dodávka'], ['solo', 'Sólo (nákladní auto)'], ['jine', 'Jiné']
];

export const DEFAULT_RULES = { oneVeh: true, mix: true, lrTol: 60, cgMin: 35, cgMax: 60, heavyShare: 50, gMax: 3, oL: 2.4, oW: 1.2, pKg: 31.5, pL: 1.2 };
export const RULE_FIELDS = [
  ['oneVeh', 'Jedna zakázka jede jedním vozidlem, pokud se vejde (i když by víc menších vozidel vyšlo levněji)', 'bool'],
  ['mix', 'Neúplné palety stejného typu skládat dohromady (smíšená paleta, do 100 % a do nosnosti palety)', 'bool'],
  ['lrTol', 'Nakládka: max. podíl váhy na jedné straně, % (60 = rozdíl do 60/40)', '1'],
  ['cgMin', 'Nakládka: těžiště těžkého nákladu od, % délky korby', '1'],
  ['cgMax', 'Nakládka: těžiště těžkého nákladu do, % délky korby', '1'],
  ['heavyShare', 'Nakládka: náklad je „těžký“ od, % nosnosti vozidla', '1'],
  ['gMax', 'Sběrná služba: maximum europalet', '1'],
  ['pKg', 'Balík: maximální váha, kg', '0.5'],
  ['pL', 'Balík: nejdelší strana, m', '0.05'],
  ['oL', 'Nadrozměr: paleta delší než, m', '0.1'],
  ['oW', 'Nadrozměr: paleta širší než, m', '0.1']
];

export const SAMPLE = ['SO 505111', 'r10 V06 kabina 6', 'r20 V04 dopravnik 10', 'r30 V-POL police 1240', '', 'SO 505112', 'r10 V-POL police 156'].join('\n');

// Kombinace: example rule, switched off so the reference results stay unchanged.
export const DEFAULT_COMBOS = [
  { on: false, code: 'V04', withCode: 'V06', min: 0, max: 10, mode: 'host', host: 'V06', pl: 0, pw: 0, per: 0, note: 'Dopravník do 10 ks jede na paletě kabiny' }
];
