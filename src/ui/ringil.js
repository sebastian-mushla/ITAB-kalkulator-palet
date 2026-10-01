// Values for the Ringil "new transport" form, one row per form field, each with its own copy button.
import { esc } from '../core/util.js';
import { groupItems } from '../core/solve.js';

const num = n => String(Math.round(n * 10) / 10).replace('.', ',');
const cm = mm => String(Math.round(mm / 10));

// one "náklad" (load unit block) per vehicle, pallet type or parcel type
export function ringilLoads(r) {
  const loads = [];
  if (r.vehicles.length && r.mode !== 'groupage') {
    r.vehicles.filter(v => v.items.length).forEach(v => {
      const usedL = Math.max(...v.items.map(i => i.x + i.w));
      loads.push({ title: v.title, unit: 'Ložné metry', count: num(Math.ceil(usedL / 100) / 10), L: '', W: '', H: '', kg: num(v.kg),
        note: groupItems(v.items).map(g => g.code + ' ' + g.count + '×').join(', ') });
    });
  } else if (r.pallets.length) {
    const m = new Map();
    r.pallets.forEach(p => { const k = p.pl + '×' + p.pw, g = m.get(k) || { p, n: 0, kg: 0 }; g.n++; g.kg += p.kg; m.set(k, g); });
    m.forEach(g => loads.push({ title: 'Palety ' + cm(g.p.pl) + ' × ' + cm(g.p.pw) + ' cm', unit: g.p.euro ? 'Europaleta' : 'Paleta', count: String(g.n), L: cm(g.p.pl), W: cm(g.p.pw), H: '', kg: num(g.kg), note: '' }));
  }
  if (r.parcels.length) {
    const m = new Map();
    r.parcels.forEach(p => { const k = p.code, g = m.get(k) || { p, n: 0, kg: 0 }; g.n++; g.kg += p.kg; m.set(k, g); });
    m.forEach(g => loads.push({ title: 'Balíky ' + g.p.code, unit: 'Krabice', count: String(g.n), L: cm(g.p.pl), W: cm(g.p.pw), H: '', kg: num(g.kg / g.n), note: 'hmotnost 1 balíku; celkem ' + num(g.kg) + ' kg' }));
  }
  return loads;
}

function row(label, value, hint) {
  const empty = value === '' || value == null;
  return '<div class="rg-row"><span class="rg-label">' + esc(label) + '</span>' +
    '<span class="rg-val' + (empty ? ' rg-empty' : '') + '">' + (empty ? esc(hint || 'doplňte') : esc(value)) + '</span>' +
    (empty ? '<span></span>' : '<button type="button" class="btn small rg-copy" data-copy="' + esc(value) + '">Kopírovat</button>') + '</div>';
}

export function ringilHtml(r) {
  const loads = ringilLoads(r);
  let h = '<div class="rg-block">' + row('Objednávka / Reference', r.id) + '</div>';
  loads.forEach((l, i) => {
    h += '<div class="rg-block"><h3>Náklad ' + (i + 1) + (loads.length > 1 ? ' z ' + loads.length : '') + ': ' + esc(l.title) + '</h3>' +
      row('Manipulační jednotka', l.unit) + row('Počet', l.count) + row('Stohovatelné', 'ne') +
      (l.unit === 'Ložné metry' ? '' : row('Délka (celková), cm', l.L) + row('Šířka jednotky, cm', l.W) + row('Výška jednotky, cm', l.H, 'výška není v číselníku – doplňte')) +
      row(l.unit === 'Ložné metry' ? 'Hmotnost nákladu, kg' : 'Hmotnost, kg', l.kg) +
      (l.note ? '<p class="hint">' + esc(l.note) + '</p>' : '') + '</div>';
  });
  if (loads.length > 1) h += '<p class="hint">V Ringilu přidejte každý náklad tlačítkem „Přidat náklad“.</p>';
  h += '<div class="rg-block">' + row('Celková hmotnost objednávky, kg', num(r.kg)) + '</div>';
  return h;
}

