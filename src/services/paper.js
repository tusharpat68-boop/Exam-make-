'use strict';
// Strict shape/size cleaning for papers, questions and answers coming from the browser or the AI.
// Everything stored in Firestore or sent to Gemini goes through here first.
const crypto = require('crypto');
const { sectionMarks } = require('./marks');

const DIFFICULTY = ['easy', 'medium', 'hard'];
const LIMITS = { sections: 10, questionsPerSection: 50, totalQuestions: 100, text: 2000, heading: 200, option: 300, options: 6, parts: 8, steps: 30, step: 1000 };

class PaperError extends Error {
  constructor(message) { super(message); this.code = 'INVALID_PAPER'; }
}

const str = (v, max) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, max);
const newId = () => 'q' + crypto.randomBytes(5).toString('hex');
const cleanId = v => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : null);

function cleanMarks(v, what) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new PaperError(`${what}: marks must be a number from 0 to 100`);
  return Math.round(n * 100) / 100;
}

function sanitizeQuestion(q, usedIds = new Set()) {
  if (!q || typeof q !== 'object') throw new PaperError('question is not an object');
  const text = str(q.text, LIMITS.text).trim();
  if (!text) throw new PaperError('a question has no text');
  let id = cleanId(q.id);
  if (!id || usedIds.has(id)) id = newId();
  usedIds.add(id);
  const out = {
    id, text,
    marks: cleanMarks(q.marks, 'question'),
    difficulty: DIFFICULTY.includes(q.difficulty) ? q.difficulty : 'medium'
  };
  if (Array.isArray(q.options)) {
    if (q.options.length > LIMITS.options) throw new PaperError('too many options');
    out.options = q.options.map(o => str(o, LIMITS.option));
  }
  if (Array.isArray(q.parts)) {
    if (q.parts.length > LIMITS.parts) throw new PaperError('too many parts');
    out.parts = q.parts.map(p => ({
      label: str(p?.label, 10), text: str(p?.text, LIMITS.text), marks: cleanMarks(p?.marks ?? 0, 'part')
    }));
  }
  return out;
}

function sanitizePaper(paper) {
  if (!paper || typeof paper !== 'object' || !Array.isArray(paper.sections)) throw new PaperError('paper has no sections');
  if (paper.sections.length === 0 || paper.sections.length > LIMITS.sections) throw new PaperError(`a paper needs 1-${LIMITS.sections} sections`);
  const used = new Set();
  let total = 0;
  const sections = paper.sections.map((s, i) => {
    if (!s || typeof s !== 'object' || !Array.isArray(s.questions)) throw new PaperError(`section ${i + 1} is invalid`);
    if (s.questions.length > LIMITS.questionsPerSection) throw new PaperError(`section ${i + 1} has too many questions`);
    total += s.questions.length;
    if (total > LIMITS.totalQuestions) throw new PaperError('too many questions in the paper');
    return {
      heading: str(s.heading, LIMITS.heading),
      type: str(s.type, 30),
      ...(Number.isInteger(s.choose) && s.choose >= 1 && s.choose <= LIMITS.questionsPerSection ? { choose: s.choose } : {}),
      questions: s.questions.map(q => sanitizeQuestion(q, used))
    };
  });
  return { title: str(paper.title, LIMITS.heading), sections };
}

// Print layout. Mirrors public/layout.js (a test checks that both sanitizers agree).
const LAYOUT_OPTIONS = {
  template: ['traditional', 'modern'], pageSize: ['A4', 'A5'], fontFamily: ['sans', 'serif'],
  questionSpacing: ['compact', 'normal', 'relaxed'], numerals: ['en', 'bn'], headerAlign: ['center', 'left'],
  border: ['none', 'single', 'double']
};
const LAYOUT_RANGES = { margin: [8, 30, 1], fontSize: [9, 16, 0.5], lineHeight: [1.1, 2.2, 0.05] };
const LAYOUT_DEFAULT = {
  template: 'traditional', pageSize: 'A4', margin: 15, fontFamily: 'sans', fontSize: 12, lineHeight: 1.5,
  questionSpacing: 'normal', numerals: 'en', headerAlign: 'center', border: 'none', pageNumbers: true
};
const LOGO_RE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;
const MAX_LOGO_CHARS = 120000;
const pick = (v, list, d) => (list.includes(v) ? v : d);
function num(v, [lo, hi, step], d) {
  const n = Number(v);
  if (v === '' || v === null || !Number.isFinite(n)) return d;
  const c = Math.min(hi, Math.max(lo, n));
  return Math.round(Math.round(c / step) * step * 100) / 100;
}
const plainText = (v, max) => (typeof v === 'string' ? v : '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

function sanitizeLayout(l) {
  l = l && typeof l === 'object' ? l : {};
  const d = LAYOUT_DEFAULT, o = LAYOUT_OPTIONS, r = LAYOUT_RANGES;
  return {
    template: pick(l.template, o.template, d.template), pageSize: pick(l.pageSize, o.pageSize, d.pageSize),
    margin: num(l.margin, r.margin, d.margin), fontFamily: pick(l.fontFamily, o.fontFamily, d.fontFamily),
    fontSize: num(l.fontSize, r.fontSize, d.fontSize), lineHeight: num(l.lineHeight, r.lineHeight, d.lineHeight),
    questionSpacing: pick(l.questionSpacing, o.questionSpacing, d.questionSpacing),
    numerals: pick(l.numerals, o.numerals, d.numerals), headerAlign: pick(l.headerAlign, o.headerAlign, d.headerAlign),
    border: pick(l.border, o.border, d.border),
    pageNumbers: l.pageNumbers === undefined ? d.pageNumbers : l.pageNumbers === true,
    headerText: plainText(l.headerText, 100), footerText: plainText(l.footerText, 100), watermark: plainText(l.watermark, 30),
    logo: typeof l.logo === 'string' && l.logo.length <= MAX_LOGO_CHARS && LOGO_RE.test(l.logo) ? l.logo : ''
  };
}

function sanitizeMeta(m) {
  m = m && typeof m === 'object' ? m : {};
  const fm = Number(m.fullMarks);
  return {
    school: str(m.school, 200), address: str(m.address, 200), examName: str(m.examName, 200), className: str(m.className, 40),
    subject: str(m.subject, 100), chapter: str(m.chapter, 200), date: str(m.date, 40), duration: str(m.duration, 40),
    eiin: str(m.eiin, 20), contact: str(m.contact, 100), website: str(m.website, 200),
    language: ['bn', 'en', 'mixed'].includes(m.language) ? m.language : 'bn',
    fullMarks: Number.isFinite(fm) && fm > 0 && fm <= 1000 ? fm : 0,
    layout: sanitizeLayout(m.layout)
  };
}

const VERIF_STATUS = ['VERIFIED_CORRECT', 'INCORRECT', 'PARTIALLY_VERIFIED', 'VERIFICATION_UNAVAILABLE', 'NEEDS_MANUAL_REVIEW'];

// answers: { [questionId]: { answer, steps[], correctOption?, verification:{status,message}, checked? } }
function sanitizeAnswers(a, validIds) {
  const out = {};
  if (!a || typeof a !== 'object') return out;
  for (const id of Object.keys(a)) {
    if (!validIds.has(id)) continue;
    const x = a[id] || {};
    const v = x.verification || {};
    out[id] = {
      answer: str(x.answer, LIMITS.text),
      steps: Array.isArray(x.steps) ? x.steps.slice(0, LIMITS.steps).map(s => str(s, LIMITS.step)) : [],
      ...(Number.isInteger(x.correctOption) && x.correctOption >= 0 && x.correctOption < LIMITS.options ? { correctOption: x.correctOption } : {}),
      verification: {
        status: VERIF_STATUS.includes(v.status) ? v.status : 'VERIFICATION_UNAVAILABLE',
        message: str(v.message, 300)
      },
      ...(typeof x.checked === 'string' ? { checked: x.checked.slice(0, 400) } : {})
    };
  }
  return out;
}

function totalMarks(paper) {
  return Math.round(paper.sections.reduce((a, s) => a + sectionMarks(s.questions.map(q => q.marks), s.choose), 0) * 100) / 100;
}

module.exports = { sanitizePaper, sanitizeQuestion, sanitizeMeta, sanitizeLayout, sanitizeAnswers, totalMarks, newId, PaperError, LIMITS };
