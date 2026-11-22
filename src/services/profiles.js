'use strict';
// School profiles and saved exam templates (question patterns). Strict cleaning of everything stored.
const { sanitizeLayout } = require('./paper');
const { validateConfig } = require('./marks');

class InvalidInput extends Error {
  constructor(message) { super(message); this.code = 'INVALID_INPUT'; }
}

const text = (v, max) => (typeof v === 'string' ? v : '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const LANGS = ['bn', 'en', 'mixed'];

function sanitizeSchool(b) {
  b = b && typeof b === 'object' ? b : {};
  const name = text(b.name, 100);
  if (!name) throw new InvalidInput('Give the profile a name');
  const d = b.defaults && typeof b.defaults === 'object' ? b.defaults : {};
  return {
    name,
    school: text(b.school, 200), address: text(b.address, 200), eiin: text(b.eiin, 20),
    contact: text(b.contact, 100), website: text(b.website, 200),
    defaults: { language: LANGS.includes(d.language) ? d.language : 'bn', duration: text(d.duration, 40) },
    layout: sanitizeLayout(b.layout)
  };
}

const typeOk = t => typeof t === 'string' && /^[a-z]{2,20}$/.test(t);

function sanitizeTemplate(b) {
  b = b && typeof b === 'object' ? b : {};
  const name = text(b.name, 100);
  if (!name) throw new InvalidInput('Give the template a name');
  if (!Array.isArray(b.sections) || b.sections.length === 0 || b.sections.length > 10) throw new InvalidInput('A template needs 1-10 sections');
  const sections = b.sections.map((s, i) => {
    if (!s || !typeOk(s.type)) throw new InvalidInput(`Section ${i + 1} has an invalid type`);
    const out = { type: s.type, count: Number(s.count), marksEach: Number(s.marksEach) };
    if (s.choose !== undefined && s.choose !== null && s.choose !== '') out.choose = Number(s.choose);   // validateConfig checks the range
    return out;
  });
  const dd = b.difficulty && typeof b.difficulty === 'object' ? b.difficulty : { easy: 30, medium: 50, hard: 20 };
  const difficulty = { easy: Number(dd.easy), medium: Number(dd.medium), hard: Number(dd.hard) };
  const fullMarks = Number(b.fullMarks);
  // Same rules as paper generation: counts, marks and total must be consistent. Never store a template that cannot be used.
  const v = validateConfig({ subject: 'template', fullMarks, sections, difficulty });
  if (!v.ok) throw new InvalidInput(v.errors.join('; '));
  return {
    name, language: LANGS.includes(b.language) ? b.language : 'bn', fullMarks, difficulty, sections,
    className: text(b.className, 40), subject: text(b.subject, 100), chapter: text(b.chapter, 200)
  };
}

module.exports = { sanitizeSchool, sanitizeTemplate, InvalidInput };
