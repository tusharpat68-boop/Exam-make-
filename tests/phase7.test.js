'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { validateConfig, validatePaper, sectionMarks } = require('../src/services/marks');
const { sanitizePaper, totalMarks } = require('../src/services/paper');
const { sanitizeTemplate } = require('../src/services/profiles');

const cfg = (o = {}) => ({ subject: 'x', fullMarks: 100, difficulty: { easy: 30, medium: 50, hard: 20 },
  sections: [{ type: 'mcq', count: 30, marksEach: 1 }, { type: 'creative', count: 10, marksEach: 10, choose: 7 }], ...o });
const qs = (n, marks) => Array.from({ length: n }, (_, i) => ({ text: 'q' + Math.random() + i, marks }));

test('validateConfig counts only the chosen questions', () => {
  const v = validateConfig(cfg());
  assert.ok(v.ok, v.errors.join()); assert.strictEqual(v.total, 100);
  assert.ok(!validateConfig(cfg({ fullMarks: 130 })).ok);           // 30 + 100 all-compulsory would be 130 only if choose ignored
});

test('validateConfig rejects bad "answer any" values', () => {
  for (const choose of [0, -1, 1.5, 10, 11, 'abc']) {
    const v = validateConfig(cfg({ sections: [{ type: 'short', count: 10, marksEach: 2, choose }], fullMarks: 20 }));
    assert.ok(!v.ok, 'should reject ' + choose);
  }
  assert.ok(validateConfig(cfg({ sections: [{ type: 'short', count: 5, marksEach: 2, choose: '' }], fullMarks: 10 })).ok);   // blank = all
});

test('sectionMarks: equal marks, all compulsory, and unequal (lowest N counted)', () => {
  assert.strictEqual(sectionMarks([10, 10, 10], 2), 20);
  assert.strictEqual(sectionMarks([10, 10, 10], undefined), 30);
  assert.strictEqual(sectionMarks([10, 10, 10], 3), 30);            // choose >= count means all
  assert.strictEqual(sectionMarks([5, 10, 10], 2), 15);             // never overstates
});

test('validatePaper uses the optional rule and still flags real mismatches', () => {
  const c = cfg();
  const paper = { sections: [{ questions: qs(30, 1) }, { questions: qs(10, 10) }] };
  assert.ok(validatePaper(paper, c).ok, validatePaper(paper, c).errors.join());
  const bad = { sections: [{ questions: qs(30, 1) }, { questions: qs(10, 9) }] };
  assert.ok(!validatePaper(bad, c).ok);
});

test('sanitizePaper keeps valid choose, drops junk; total follows it', () => {
  const p = sanitizePaper({ sections: [
    { heading: 'a', type: 'creative', choose: 2, questions: qs(3, 10) },
    { heading: 'b', type: 'short', choose: 'x', questions: qs(2, 5) },
    { heading: 'c', type: 'short', choose: -3, questions: qs(2, 5) }] });
  assert.strictEqual(p.sections[0].choose, 2);
  assert.ok(!('choose' in p.sections[1]) && !('choose' in p.sections[2]));
  assert.strictEqual(totalMarks(p), 20 + 10 + 10);
});

test('templates keep choose and enforce marks', () => {
  const t = sanitizeTemplate({ name: 'N', fullMarks: 100, difficulty: { easy: 30, medium: 50, hard: 20 }, sections: cfg().sections });
  assert.strictEqual(t.sections[1].choose, 7); assert.strictEqual(t.sections[0].choose, undefined);
  assert.throws(() => sanitizeTemplate({ name: 'N', fullMarks: 100, difficulty: { easy: 30, medium: 50, hard: 20 }, sections: [{ type: 'mcq', count: 30, marksEach: 1 }, { type: 'creative', count: 10, marksEach: 10, choose: 10 }] }));
});

test('prompt tells the AI to write all questions of an optional section', () => {
  const { buildPrompt } = require('../src/services/gemini');
  if (typeof buildPrompt !== 'function') return;
  assert.match(buildPrompt(cfg(), ''), /answer any 7 of these 10/);
});

test('client: totals agree with the server, warnings, printed rule, sets, presets', async () => {
  const m = await import('../public/paperModel.js');
  const { renderPaper } = await import('../public/paperView.js');
  const { makeSets } = await import('../public/sets.js');
  const { PRESETS } = await import('../public/presets.js');
  const mk = (choose, marks = [10, 10, 10]) => ({ title: 't', sections: [{ heading: 'সৃজনশীল', type: 'creative', ...(choose ? { choose } : {}), questions: marks.map((x, i) => ({ id: 'q' + i, text: 'প্রশ্ন ' + i, marks: x })) }] });
  for (const [c, marks] of [[2, [10, 10, 10]], [0, [10, 10, 10]], [3, [10, 10, 10]], [2, [5, 10, 10]], [9, [1, 2]]]) {
    const p = mk(c, marks);
    assert.strictEqual(m.totalMarks(p), totalMarks(p), JSON.stringify([c, marks]));
  }
  assert.strictEqual(m.totalMarks(mk(2)), 20);
  assert.ok(m.checkPaper(mk(2), 20).length === 0);
  assert.ok(m.checkPaper(mk(2), 30).some(w => /add up to 20/.test(w)));
  assert.ok(m.checkPaper(mk(2, [5, 10, 10]), 15).some(w => /equal marks/.test(w)));
  assert.ok(m.checkPaper(mk(5), 30).some(w => /needs more than 5/.test(w)));
  // printed instruction line
  const bn = renderPaper(mk(2), { language: 'bn', layout: { numerals: 'bn' } });
  assert.ok(bn.includes('নিচের ৩টি প্রশ্নের মধ্যে যেকোনো ২টির উত্তর দাও'));
  assert.ok(renderPaper(mk(2), { language: 'en' }).includes('Answer any 2 of the following 3 questions.'));
  assert.ok(!renderPaper(mk(0), { language: 'en' }).includes('Answer any'));
  assert.ok(!renderPaper(mk(3), { language: 'en' }).includes('Answer any'));      // choose = all: no line
  // sets keep the rule
  const { sets } = makeSets(mk(2), {}, 3, 7);
  assert.ok(sets.every(s => s.paper.sections[0].choose === 2));
  // built-in presets still add up, and the 100-mark one uses the real optional rule
  const p100 = PRESETS.find(p => p.id === 'p-model100');
  assert.strictEqual(p100.sections[1].choose, 7);
  for (const p of PRESETS) assert.ok(validateConfig({ subject: 'x', fullMarks: p.fullMarks, sections: p.sections, difficulty: p.difficulty }).ok, p.name);
});
