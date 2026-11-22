// Print/PDF layout settings: validation, CSS generation, Bengali numerals. Pure (no DOM).
export const PAGE_SIZES = { A4: [210, 297], A5: [148, 210] };
export const OPTIONS = {
  template: ['traditional', 'modern'],
  pageSize: ['A4', 'A5'],
  fontFamily: ['sans', 'serif'],
  questionSpacing: ['compact', 'normal', 'relaxed'],
  numerals: ['en', 'bn'],
  headerAlign: ['center', 'left'],
  border: ['none', 'single', 'double']
};
export const RANGES = { margin: [8, 30, 1], fontSize: [9, 16, 0.5], lineHeight: [1.1, 2.2, 0.05] };
export const MAX_LOGO_CHARS = 120000;

export const DEFAULT_LAYOUT = {
  template: 'traditional', pageSize: 'A4', margin: 15, fontFamily: 'sans', fontSize: 12, lineHeight: 1.5,
  questionSpacing: 'normal', numerals: 'en', headerAlign: 'center', border: 'none',
  pageNumbers: true, headerText: '', footerText: '', watermark: '', logo: ''
};

const SANS = "'Noto Sans Bengali','Kalpurush','SolaimanLipi',system-ui,sans-serif";
const SERIF = "'Noto Serif Bengali','Kalpurush','SolaimanLipi',serif";
const LOGO_RE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;

const pick = (v, list, d) => (list.includes(v) ? v : d);
function num(v, [lo, hi, step], d) {
  const n = Number(v);
  if (v === '' || v === null || !Number.isFinite(n)) return d;
  const c = Math.min(hi, Math.max(lo, n));
  return Math.round(Math.round(c / step) * step * 100) / 100;
}
const text = (v, max) => (typeof v === 'string' ? v : '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

export function sanitizeLayout(l) {
  l = l && typeof l === 'object' ? l : {};
  const d = DEFAULT_LAYOUT;
  return {
    template: pick(l.template, OPTIONS.template, d.template),
    pageSize: pick(l.pageSize, OPTIONS.pageSize, d.pageSize),
    margin: num(l.margin, RANGES.margin, d.margin),
    fontFamily: pick(l.fontFamily, OPTIONS.fontFamily, d.fontFamily),
    fontSize: num(l.fontSize, RANGES.fontSize, d.fontSize),
    lineHeight: num(l.lineHeight, RANGES.lineHeight, d.lineHeight),
    questionSpacing: pick(l.questionSpacing, OPTIONS.questionSpacing, d.questionSpacing),
    numerals: pick(l.numerals, OPTIONS.numerals, d.numerals),
    headerAlign: pick(l.headerAlign, OPTIONS.headerAlign, d.headerAlign),
    border: pick(l.border, OPTIONS.border, d.border),
    pageNumbers: l.pageNumbers === undefined ? d.pageNumbers : l.pageNumbers === true,
    headerText: text(l.headerText, 100),
    footerText: text(l.footerText, 100),
    watermark: text(l.watermark, 30),
    logo: typeof l.logo === 'string' && l.logo.length <= MAX_LOGO_CHARS && LOGO_RE.test(l.logo) ? l.logo : ''
  };
}

const BN = '০১২৩৪৫৬৭৮৯';
export const toBn = s => String(s).replace(/[0-9]/g, d => BN[d]);

// A CSS string literal that cannot break out of its quotes.
export const cssStr = s => '"' + String(s).replace(/[\\"]/g, '\\$&').replace(/[\u0000-\u001f\u007f]/g, ' ') + '"';

// CSS for the current layout: the printed page (@page) and the paper typography.
export function layoutCss(layout) {
  const l = sanitizeLayout(layout);
  const [w] = PAGE_SIZES[l.pageSize];
  const fam = l.fontFamily === 'serif' ? SERIF : SANS;
  const gap = { compact: '0.35em', normal: '0.7em', relaxed: '1.15em' }[l.questionSpacing];
  const boxes = [];
  if (l.headerText) boxes.push(`@top-center{content:${cssStr(l.headerText)};font:8pt ${fam}}`);
  if (l.footerText) boxes.push(`@bottom-left{content:${cssStr(l.footerText)};font:8pt ${fam}}`);
  if (l.pageNumbers) {
    const c = l.numerals === 'bn' ? 'counter(page, bengali) " / " counter(pages, bengali)' : '"Page " counter(page) " of " counter(pages)';
    boxes.push(`@bottom-right{content:${c};font:8pt ${fam}}`);
  }
  return [
    `@page{size:${l.pageSize};margin:${l.margin}mm ${l.margin}mm ${l.margin + 4}mm;${boxes.join('')}}`,
    `.paper{font-family:${fam};font-size:${l.fontSize}pt;line-height:${l.lineHeight};--qgap:${gap};max-width:${w}mm;margin-left:auto;margin-right:auto}`
  ].join('\n');
}
