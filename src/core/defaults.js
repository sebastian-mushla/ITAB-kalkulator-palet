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
  { name: 'Kamion (návěs)', type: 'kamion', L: 13.6, W: 2.4, kg: 24000, eup: 33, lift: false, cost: 1 },
  { name: 'Plachťák', type: 'plachta', L: 4.8, W: 2.2, kg: 1200, eup: 8, lift: false, cost: 0.6 },
  { name: 'Dodávka s čelem', type: 'celo', L: 4.2, W: 2.0, kg: 1000, eup: 6, lift: true, cost: 0.45 },
  { name: 'Dodávka', type: 'dodavka', L: 3.2, W: 1.7, kg: 1000, eup: 3, lift: false, cost: 0.3 }
];

export const VEHICLE_TYPES = [
  ['kamion', 'Kamion'], ['plachta', 'Plachťák'], ['celo', 'Dodávka s čelem'], ['dodavka', 'Dodávka'], ['jine', 'Jiné']
];

export const DEFAULT_RULES = { oneVeh: true, mix: true, gMax: 3, oL: 2.4, oW: 1.2, pKg: 31.5, pL: 1.2 };
export const RULE_FIELDS = [
  ['oneVeh', 'Jedna zakázka jede jedním vozidlem, pokud se vejde (i když by víc menších vozidel vyšlo levněji)', 'bool'],
  ['mix', 'Neúplné palety stejného typu skládat dohromady (smíšená paleta, do 100 % a do nosnosti palety)', 'bool'],
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
