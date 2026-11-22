// Word (.docx) export. Pure ES module, no dependencies, no DOM: builds the OOXML parts by hand and
// packs them into a ZIP (stored, uncompressed). Works in the browser and in Node (for tests).
import { LABELS_BN, LABELS_EN, effectiveChoose } from './paperModel.js';
import { STATUS_TEXT } from './paperView.js';
import { sanitizeLayout, toBn, PAGE_SIZES } from './layout.js';

// ---------- XML helpers ----------
const xmlText = s => String(s ?? '')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')      // characters XML 1.0 forbids
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------- LaTeX -> readable text (Word cannot typeset KaTeX; formulas become plain Unicode text) ----------
const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', n: 'ⁿ' };
const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉' };
const SYMBOLS = { pi: 'π', theta: 'θ', alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', lambda: 'λ', mu: 'μ', sigma: 'σ', omega: 'ω', phi: 'φ',
  times: '×', div: '÷', cdot: '·', pm: '±', le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈', infty: '∞',
  degree: '°', circ: '°', angle: '∠', triangle: '△', therefore: '∴', rightarrow: '→', to: '→', in: '∈', cup: '∪', cap: '∩', sum: 'Σ', Delta: 'Δ', perp: '⊥', parallel: '∥' };
const mapAll = (s, m) => [...s].every(c => m[c] !== undefined) ? [...s].map(c => m[c]).join('') : null;

export function texToText(tex) {
  let s = String(tex);
  for (let i = 0; i < 6; i++) {                                              // innermost-first, a few levels
    const before = s;
    s = s.replace(/\\d?frac\{([^{}]*)\}\{([^{}]*)\}/g, (_, a, b) => `(${a})/(${b})`)
      .replace(/\\sqrt\[([^\]]*)\]\{([^{}]*)\}/g, (_, n, a) => `${n}√(${a})`)
      .replace(/\\sqrt\{([^{}]*)\}/g, (_, a) => `√(${a})`)
      .replace(/\\(?:text|mathrm|mathbf)\{([^{}]*)\}/g, '$1')
      .replace(/\^\{([^{}]*)\}/g, (_, a) => mapAll(a, SUP) ?? `^(${a})`)
      .replace(/_\{([^{}]*)\}/g, (_, a) => mapAll(a, SUB) ?? `_(${a})`);
    if (s === before) break;
  }
  s = s.replace(/\^([0-9n])/g, (_, a) => SUP[a]).replace(/_([0-9])/g, (_, a) => SUB[a])
    .replace(/\\([A-Za-z]+)/g, (m, n) => SYMBOLS[n] ?? m)
    .replace(/\\[,;:! ]/g, ' ').replace(/\\([{}%$&#_])/g, '$1')
    .replace(/[{}]/g, '');
  return s.replace(/\s+/g, ' ').trim();
}

const MATH_RE = /\$\$([^$]{1,500}?)\$\$|\$([^\s$](?:[^$\n]{0,498}?[^\s$])?)\$/g;
export const plainText = t => String(t ?? '').replace(MATH_RE, (_, a, b) => texToText(a ?? b));

// ---------- ZIP (stored) ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

export function zip(files) {                    // files: [{name, data: Uint8Array}]
  const enc = new TextEncoder(), chunks = [], central = [];
  let offset = 0;
  const u16 = n => [n & 255, (n >>> 8) & 255], u32 = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
    const common = [...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0)];
    chunks.push(Uint8Array.from([0x50, 0x4b, 3, 4, ...common]), name, f.data);
    central.push(Uint8Array.from([0x50, 0x4b, 1, 2, ...u16(20), ...common, ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name);
    offset += 30 + name.length + size;
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0);
  const end = Uint8Array.from([0x50, 0x4b, 5, 6, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
  const parts = [...chunks, ...central, end];
  const out = new Uint8Array(parts.reduce((a, c) => a + c.length, 0));
  let p = 0; for (const c of parts) { out.set(c, p); p += c.length; }
  return out;
}

// ---------- logo ----------
function b64(s) { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
function imageInfo(dataUrl) {                   // PNG and JPEG only (Word cannot show WEBP); returns null if unreadable
  const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+=*)$/.exec(dataUrl || '');
  if (!m) return null;
  let bytes; try { bytes = b64(m[2]); } catch (e) { return null; }
  if (m[1] === 'png') {
    if (bytes.length < 24 || bytes[1] !== 0x50) return null;
    const dv = new DataView(bytes.buffer); return { ext: 'png', bytes, w: dv.getUint32(16), h: dv.getUint32(20) };
  }
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xFF) { i++; continue; }
    const mk = bytes[i + 1];
    if (mk >= 0xC0 && mk <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(mk)) return { ext: 'jpeg', bytes, h: (bytes[i + 5] << 8) | bytes[i + 6], w: (bytes[i + 7] << 8) | bytes[i + 8] };
    i += 2 + ((bytes[i + 2] << 8) | bytes[i + 3]);
  }
  return null;
}

// ---------- WordprocessingML ----------
const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const MM = 56.6929;                             // twips per millimetre

const run = (text, o = {}) => {
  const props = (o.b ? '<w:b/><w:bCs/>' : '') + (o.i ? '<w:i/><w:iCs/>' : '') + (o.color ? `<w:color w:val="${o.color}"/>` : '') +
    (o.sz ? `<w:sz w:val="${o.sz}"/><w:szCs w:val="${o.sz}"/>` : '');
  const parts = String(text).split('\t');
  return parts.map((t, i) => `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}${i ? '<w:tab/>' : ''}${t ? `<w:t xml:space="preserve">${xmlText(t)}</w:t>` : ''}</w:r>`).join('');
};

function para(runs, o = {}) {
  const ppr = (o.style ? `<w:pStyle w:val="${o.style}"/>` : '') + (o.keepNext ? '<w:keepNext/>' : '') + (o.pageBreak ? '<w:pageBreakBefore/>' : '') +
    (o.tab ? `<w:tabs><w:tab w:val="right" w:pos="${o.tab}"/></w:tabs>` : '') +
    (o.before !== undefined || o.after !== undefined ? `<w:spacing${o.before !== undefined ? ` w:before="${o.before}"` : ''}${o.after !== undefined ? ` w:after="${o.after}"` : ''}/>` : '') +
    (o.ind ? `<w:ind w:left="${o.ind}"${o.hang ? ` w:hanging="${o.hang}"` : ''}/>` : '') + (o.align ? `<w:jc w:val="${o.align}"/>` : '');
  return `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${runs}</w:p>`;
}

export function buildDocx(paper, meta, { mode = 'questions', answers = {}, layout, sets } = {}) {
  const L = sanitizeLayout(layout ?? meta.layout);
  const N = L.numerals === 'bn' ? toBn : String;
  const bn = meta.language !== 'en';
  const W = bn
    ? { cls: 'শ্রেণি', subject: 'বিষয়', time: 'সময়', date: 'তারিখ', full: 'পূর্ণমান', eiin: 'ইআইআইএন', set: 'সেট', answer: 'উত্তরপত্র', page: 'পৃষ্ঠা', of: '/' }
    : { cls: 'Class', subject: 'Subject', time: 'Time', date: 'Date', full: 'Full marks', eiin: 'EIIN', set: 'Set', answer: 'Answer Sheet', page: 'Page', of: 'of' };
  const labels = meta.language === 'en' ? LABELS_EN : LABELS_BN;
  const [pw, ph] = PAGE_SIZES[L.pageSize];
  const textW = Math.round((pw - 2 * L.margin) * MM);
  const sz = Math.round(L.fontSize * 2);
  const line = Math.round(L.lineHeight * 240);
  const gap = { compact: 60, normal: 120, relaxed: 200 }[L.questionSpacing];
  const align = L.headerAlign === 'left' ? 'left' : 'center';
  const showQ = mode !== 'answers_only', showA = mode !== 'questions', detailed = mode === 'detailed';
  const logo = imageInfo(L.logo);
  const f = plainText;

  const header = (m, p, setLabel) => {
    let x = '';
    if (logo) {
      const cy = Math.round(16 * 36000), cx = Math.round(cy * logo.w / logo.h);
      x += para(`<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="1" name="Logo" descr="School logo"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="logo.${logo.ext}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdLogo"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`, { align, after: 40 });
    }
    if (m.school) x += para(run(m.school, { b: 1, sz: sz + 8 }), { align, after: 20 });
    if (m.address) x += para(run(m.address, { sz: sz - 2 }), { align, after: 20 });
    const contact = [m.eiin && `${W.eiin}: ${N(m.eiin)}`, m.contact && N(m.contact), m.website].filter(Boolean).join(' · ');
    if (contact) x += para(run(contact, { sz: sz - 2 }), { align, after: 20 });
    x += para(run(m.examName || p.title || '', { b: 1, sz: sz + 4 }) + (setLabel ? run(`   ${W.set} ${setLabel}`, { b: 1, color: '4B2E83' }) : ''), { align, after: 40 });
    const bits = [m.className && `${W.cls}: ${N(m.className)}`, m.subject && `${W.subject}: ${m.subject}`, m.duration && `${W.time}: ${N(m.duration)}`,
      m.date && `${W.date}: ${N(m.date)}`, m.fullMarks && `${W.full}: ${N(m.fullMarks)}`].filter(Boolean);
    if (bits.length) x += para(run(bits.join(' · '), { sz: sz - 2 }), { align, after: 80 });
    return x + `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="8" w:space="1" w:color="000000"/></w:pBdr><w:spacing w:after="120"/></w:pPr></w:p>`;
  };

  const question = (q, n) => {
    let x = para(run(`${N(n)}.  `, { b: 1 }) + run(f(q.text)) + run(`\t[${N(q.marks)}]`, { b: 1 }), { tab: textW, ind: 400, hang: 400, before: gap, after: 20, keepNext: !!(q.options || q.parts) });
    if (q.options) q.options.forEach((o, i) => { x += para(run(`(${labels[i] || N(i + 1)})  ${f(o)}`), { ind: 800, after: 0 }); });
    if (q.parts) q.parts.forEach(p => { x += para(run(`${p.label}.  ${f(p.text)}`) + run(`\t[${N(p.marks)}]`, { b: 1 }), { tab: textW, ind: 800, hang: 400, after: 20 }); });
    return x;
  };

  const answer = (q, n, a) => {
    if (!a) return para(run(`${N(n)}.  `, { b: 1 }) + run('No answer generated yet.', { i: 1, color: '888888' }), { ind: 400, hang: 400, after: 40 });
    const st = STATUS_TEXT[a.verification?.status] ? a.verification.status : 'VERIFICATION_UNAVAILABLE';
    let shown = f(a.answer);
    if (q.options && Number.isInteger(a.correctOption) && q.options[a.correctOption] !== undefined) shown = `(${labels[a.correctOption] || N(a.correctOption + 1)})  ${f(q.options[a.correctOption])}`;
    let x = para(run(`${N(n)}.  `, { b: 1 }) + run(shown) + run(`   [${STATUS_TEXT[st]}]`, { i: 1, sz: sz - 4, color: st === 'VERIFIED_CORRECT' ? '1F7A3A' : st === 'INCORRECT' ? 'B42318' : '7A5B00' }), { ind: 400, hang: 400, after: 40 });
    if (a.verification?.message && st !== 'VERIFIED_CORRECT') x += para(run(a.verification.message, { i: 1, sz: sz - 4, color: '666666' }), { ind: 800, after: 20 });
    if (detailed && a.steps?.length) a.steps.forEach((s, i) => { x += para(run(`${N(i + 1)}) ${f(s)}`, { sz: sz - 2 }), { ind: 1000, hang: 300, after: 10 }); });
    if (detailed && a.checked) x += para(run(`Checked form: ${a.checked}`, { i: 1, sz: sz - 4, color: '666666' }), { ind: 800, after: 20 });
    return x;
  };

  const parts = sets && sets.length ? sets : [{ paper, answers, setLabel: '' }];
  let body = '', first = true;
  for (const part of parts) {
    const p = part.paper, lab = part.setLabel || '';
    let qx = '', ax = '', n = 0;
    for (const s of p.sections) {
      let sq = '', sa = '';
      for (const q of s.questions) { n++; sq += question(q, n); sa += answer(q, n, (part.answers || {})[q.id]); }
      const k = effectiveChoose(s);
      const rule = k ? para(run(meta.language === 'en' ? `Answer any ${N(k)} of the following ${N(s.questions.length)} questions.` : `নিচের ${N(s.questions.length)}টি প্রশ্নের মধ্যে যেকোনো ${N(k)}টির উত্তর দাও।`, { i: 1 }), { after: 40, keepNext: true }) : '';
      const head = para(run(s.heading || '', { b: 1, sz: sz + 2 }), { before: 200, after: 60, keepNext: true });
      qx += head + rule + sq; ax += head + sa;
    }
    let chunk = '';
    if (showQ) chunk += header(meta, p, lab) + qx;
    if (showA) {
      chunk += para(run(W.answer + (meta.subject ? ' · ' + meta.subject : ''), { b: 1, sz: sz + 4 }) + (lab ? run(`   ${W.set} ${lab}`, { b: 1, color: '4B2E83' }) : ''), { align, after: 40, pageBreak: showQ });
      chunk += para(run(meta.examName || p.title || '', { sz: sz - 2 }), { align, after: 80 });
      chunk += para(run('Answers marked "Verified by SymPy" were checked by an independent program against the question as restated for the checker. All others were not independently verified.', { i: 1, sz: sz - 4, color: '666666' }), { after: 80 }) + ax;
    }
    if (!first) chunk = chunk.replace('<w:p>', '<w:p><w:r><w:br w:type="page"/></w:r></w:p><w:p>');
    body += chunk; first = false;
  }

  // header / footer parts
  const hasHeader = !!L.headerText;
  const hasFooter = !!(L.footerText || L.pageNumbers);
  const RP = '<w:rPr><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr>';
  const fld = instr => `<w:r>${RP}<w:fldChar w:fldCharType="begin"/></w:r><w:r>${RP}<w:instrText xml:space="preserve"> ${instr} </w:instrText></w:r><w:r>${RP}<w:fldChar w:fldCharType="separate"/></w:r><w:r>${RP}<w:t>1</w:t></w:r><w:r>${RP}<w:fldChar w:fldCharType="end"/></w:r>`;
  const hdrXml = hasHeader ? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${NS}>${para(run(L.headerText, { sz: 16 }), { align: 'center' })}</w:hdr>` : '';
  const ftrXml = hasFooter ? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${NS}>${para(
    run(L.footerText, { sz: 16 }) + (L.pageNumbers ? run(`\t${W.page} `, { sz: 16 }) + fld('PAGE') + run(` ${W.of} `, { sz: 16 }) + fld('NUMPAGES') : ''), { tab: textW })}</w:ftr>` : '';

  const sp = Math.min(31, Math.max(6, Math.round(L.margin * 2.835 - 6)));
  const bd = L.border === 'none' ? '' : `<w:pgBorders w:offsetFrom="page">${['top', 'left', 'bottom', 'right'].map(e => `<w:${e} w:val="${L.border === 'double' ? 'double' : 'single'}" w:sz="${L.border === 'double' ? 6 : 8}" w:space="${sp}" w:color="000000"/>`).join('')}</w:pgBorders>`;
  const m = Math.round(L.margin * MM);
  const sect = `<w:sectPr>${hasHeader ? '<w:headerReference w:type="default" r:id="rIdHdr"/>' : ''}${hasFooter ? '<w:footerReference w:type="default" r:id="rIdFtr"/>' : ''}<w:pgSz w:w="${Math.round(pw * MM)}" w:h="${Math.round(ph * MM)}"/><w:pgMar w:top="${m}" w:right="${m}" w:bottom="${m + 227}" w:left="${m}" w:header="${Math.round(m / 2)}" w:footer="${Math.round(m / 2)}" w:gutter="0"/>${bd}</w:sectPr>`;

  const fonts = L.fontFamily === 'serif' ? { a: 'Times New Roman', cs: 'Nirmala UI' } : { a: 'Arial', cs: 'Nirmala UI' };
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${fonts.a}" w:hAnsi="${fonts.a}" w:eastAsia="${fonts.a}" w:cs="${fonts.cs}"/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/><w:lang w:val="${bn ? 'bn-BD' : 'en-US'}" w:eastAsia="en-US" w:bidi="bn-BD"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="${line}" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style></w:styles>`;

  const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${logo ? `<Default Extension="${logo.ext}" ContentType="image/${logo.ext}"/>` : ''}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>${hasHeader ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' : ''}${hasFooter ? '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' : ''}</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdSt" Type="${R}/styles" Target="styles.xml"/>${hasHeader ? `<Relationship Id="rIdHdr" Type="${R}/header" Target="header1.xml"/>` : ''}${hasFooter ? `<Relationship Id="rIdFtr" Type="${R}/footer" Target="footer1.xml"/>` : ''}${logo ? `<Relationship Id="rIdLogo" Type="${R}/image" Target="media/logo.${logo.ext}"/>` : ''}</Relationships>`;
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body}${sect}</w:body></w:document>`;

  const enc = new TextEncoder();
  const files = [
    { name: '[Content_Types].xml', data: enc.encode(ct) }, { name: '_rels/.rels', data: enc.encode(rels) },
    { name: 'word/document.xml', data: enc.encode(doc) }, { name: 'word/styles.xml', data: enc.encode(styles) },
    { name: 'word/_rels/document.xml.rels', data: enc.encode(docRels) }
  ];
  if (hasHeader) files.push({ name: 'word/header1.xml', data: enc.encode(hdrXml) });
  if (hasFooter) files.push({ name: 'word/footer1.xml', data: enc.encode(ftrXml) });
  if (logo) files.push({ name: `word/media/logo.${logo.ext}`, data: logo.bytes });
  return zip(files);
}
