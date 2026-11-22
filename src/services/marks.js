'use strict';

// Validates a generation request's marks BEFORE calling the AI,
// and validates the AI's returned paper AFTER. Never silently accept bad totals.

// "Answer any N of M": the marks a student can earn in a section. With unequal marks the N SMALLEST count,
// so the guaranteed total is never overstated (the editor also warns about unequal marks).
function sectionMarks(marksList, choose) {
  const m = marksList.map(x => Number(x) || 0);
  const k = Number.isInteger(choose) && choose >= 1 && choose < m.length ? choose : m.length;
  const used = k === m.length ? m : [...m].sort((a, b) => a - b).slice(0, k);
  return Math.round(used.reduce((a, b) => a + b, 0) * 100) / 100;
}

function validateConfig(cfg) {
  const errors = [];
  const sections = Array.isArray(cfg.sections) ? cfg.sections : [];
  const fullMarks = Number(cfg.fullMarks);

  if (!cfg.subject || typeof cfg.subject !== 'string') errors.push('subject is required');
  if (!Number.isFinite(fullMarks) || fullMarks <= 0 || fullMarks > 1000) errors.push('fullMarks must be 1-1000');
  if (sections.length === 0 || sections.length > 10) errors.push('1-10 sections required');

  let total = 0;
  sections.forEach((s, i) => {
    const n = Number(s.count), m = Number(s.marksEach);
    if (!s.type) errors.push(`section ${i + 1}: type required`);
    if (!Number.isInteger(n) || n < 1 || n > 50) errors.push(`section ${i + 1}: count must be 1-50`);
    if (!Number.isFinite(m) || m <= 0 || m > 100) errors.push(`section ${i + 1}: marksEach must be >0 and <=100`);
    let k = n;
    if (s.choose !== undefined && s.choose !== null && s.choose !== '') {
      const c = Number(s.choose);
      if (!Number.isInteger(c) || c < 1 || c >= n) errors.push(`section ${i + 1}: "answer any" must be a whole number from 1 to ${n - 1}`);
      else k = c;
    }
    total += k * m;
  });

  if (errors.length === 0 && Math.abs(total - fullMarks) > 1e-9) {
    errors.push(`section marks add up to ${total}, but full marks is ${fullMarks}`);
  }

  const d = cfg.difficulty || { easy: 30, medium: 50, hard: 20 };
  const dsum = Number(d.easy) + Number(d.medium) + Number(d.hard);
  if (dsum !== 100) errors.push(`difficulty percentages add up to ${dsum}, must be 100`);

  return { ok: errors.length === 0, errors, total };
}

function validatePaper(paper, cfg) {
  const errors = [];
  if (!paper || !Array.isArray(paper.sections)) return { ok: false, errors: ['AI returned an invalid paper'] };
  let total = 0;
  paper.sections.forEach((sec, i) => {
    const want = cfg.sections[i];
    const qs = Array.isArray(sec.questions) ? sec.questions : [];
    if (want && qs.length !== Number(want.count)) {
      errors.push(`section ${i + 1}: expected ${want.count} questions, got ${qs.length}`);
    }
    total += sectionMarks(qs.map(q => q.marks), want && want.choose !== '' ? Number(want.choose) || undefined : undefined);
  });
  if (Math.abs(total - Number(cfg.fullMarks)) > 1e-9) {
    errors.push(`generated marks total ${total}, expected ${cfg.fullMarks}`);
  }
  // duplicate detection
  const seen = new Set();
  paper.sections.forEach(sec => (sec.questions || []).forEach(q => {
    const key = String(q.text || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (key && seen.has(key)) errors.push(`duplicate question: ${key.slice(0, 40)}`);
    seen.add(key);
  }));
  return { ok: errors.length === 0, errors, total };
}

module.exports = { validateConfig, validatePaper, sectionMarks };
