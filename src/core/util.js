export const EPS = 0.5;
export const PALETTE = ['#2F6FDE', '#7B4FD6', '#E0902A', '#D0457F', '#2E9464', '#4B6584', '#B85A1E', '#8746A8'];

export function clone(x) { return JSON.parse(JSON.stringify(x)); }
export function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function plural(n, f) { n = Math.abs(n); if (n === 1) return f[0]; if (n >= 2 && n <= 4) return f[1]; return f[2]; }
export function fmtM(mm) { return (mm / 1000).toLocaleString('cs-CZ', { maximumFractionDigits: 2 }); }
export function fmtKg(n) { return Math.round(n).toLocaleString('cs-CZ') + ' kg'; }
export function fmtN(n) { return Math.round(n).toLocaleString('cs-CZ'); }
export function color(i) { return PALETTE[i % PALETTE.length]; }
export function palWord(n) { return plural(n, ['paleta', 'palety', 'palet']); }
export function balWord(n) { return plural(n, ['balík', 'balíky', 'balíků']); }
export function vehWord(n) { return plural(n, ['vozidlo', 'vozidla', 'vozidel']); }
export function isEuro(a) { return (a.pl === 1200 && a.pw === 800) || (a.pl === 800 && a.pw === 1200); }
export function toNum(v) {
  if (typeof v === 'number') return v;
  return Number(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.'));
}
export function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
