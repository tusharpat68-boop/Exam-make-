'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const load = async () => ({ m: await import('../public/paperModel.js'), v: await import('../public/paperView.js') });
const paper = () => ({
  title: 'T',
  sections: [
    { heading: 'MCQ', type: 'mcq', questions: [
      { id: 'a', text: 'Q1 <b>x</b>', marks: 1, options: ['1', '2', '3', '4'] },
      { id: 'b', text: 'Q2', marks: 1, options: ['1', '2', '3', '4'] }] },
    { heading: 'Creative', type: 'creative', questions: [
      { id: 'c', text: 'stem', marks: 10, parts: [{ label: 'ক', text: 'p1', marks: 1 }, { label: 'খ', text: 'p2', marks: 2 }, { label: 'গ', text: 'p3', marks: 3 }, { label: 'ঘ', text: 'p4', marks: 4 }] }] }
  ]
});

test('add, duplicate, move, delete questions and sections', async () => {
  const { m } = await load(); const p = paper();
  const nq = m.addQuestion(p, 0);
  assert.equal(nq.options.length, 4); assert.equal(p.sections[0].questions.length, 3);
  assert.equal(m.addQuestion(p, 1).parts.length, 4);
  const dup = m.duplicateQuestion(p, 0, 0);
  assert.notEqual(dup.id, 'a'); assert.equal(dup.text, 'Q1 <b>x</b>'); assert.equal(p.sections[0].questions[1].id, dup.id);
  dup.options[0] = 'changed'; assert.equal(p.sections[0].questions[0].options[0], '1');       // deep copy
  assert.equal(m.moveQuestion(p, 0, 0, -1), false);                                           // already first
  assert.equal(m.moveQuestion(p, 0, 0, 1), true); assert.equal(p.sections[0].questions[0].id, dup.id);
  m.deleteQuestion(p, 0, 0); assert.equal(p.sections[0].questions[0].id, 'a');
  assert.equal(m.moveSection(p, 1, -1), true); assert.equal(p.sections[0].heading, 'Creative');
  m.addSection(p, 'short'); assert.equal(p.sections.at(-1).type, 'short');
  m.deleteSection(p, 0); assert.equal(p.sections[0].heading, 'MCQ');
});

test('ensureIds fixes missing and duplicate ids', async () => {
  const { m } = await load();
  const p = m.ensureIds({ sections: [{ questions: [{ text: 'a' }, { id: 'x', text: 'b' }, { id: 'x', text: 'c' }] }] });
  const ids = p.sections[0].questions.map(q => q.id);
  assert.equal(new Set(ids).size, 3); assert.ok(ids.every(i => /^[A-Za-z0-9_-]+$/.test(i)));
});

test('marks recalculation and paper checks', async () => {
  const { m } = await load(); const p = paper();
  assert.equal(m.totalMarks(p), 12);
  assert.deepEqual(m.checkPaper(p, 12), []);
  assert.match(m.checkPaper(p, 30)[0], /add up to 12.*full marks is 30/);
  p.sections[0].questions[1].text = 'q1 <B>x</B>';                                  // duplicate ignoring case
  assert.ok(m.checkPaper(p, 12).some(w => /repeats question 1/.test(w)));
  p.sections[0].questions[1].text = ''; p.sections[0].questions[0].options[2] = ' ';
  const w = m.checkPaper(p, 12).join('|');
  assert.match(w, /Question 2 is empty/); assert.match(w, /option is empty/);
  p.sections[1].questions[0].parts[3].marks = 5;
  assert.match(m.checkPaper(p, 12).join('|'), /part marks add up to 11, not 10/);
  p.sections[1].questions[0].marks = 0;
  assert.match(m.checkPaper(p, 12).join('|'), /needs marks greater than 0/);
  assert.match(m.checkPaper({ sections: [{ heading: 'E', questions: [] }] }, 0)[0], /no questions/);
});

test('answer payload and batching', async () => {
  const { m } = await load(); const p = paper();
  const pl = m.answerPayload(p, ['a', 'c'], { language: 'bn', subject: 'S', className: '9', extra: 'ignored' });
  assert.deepEqual(pl.questions.map(q => q.id), ['a', 'c']);
  assert.equal(pl.questions[0].type, 'mcq'); assert.equal(pl.questions[1].type, 'creative');
  assert.equal(pl.meta.extra, undefined);
  assert.deepEqual(m.missingAnswerIds(p, { a: {} }), ['b', 'c']);
  assert.deepEqual(m.batches([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  p.sections[0].questions[1].text = ' ';
  assert.deepEqual(m.missingAnswerIds(p, {}), ['a', 'c']);                              // empty questions are skipped
});

test('view: escapes HTML, shows the 4 modes, labels follow language', async () => {
  const { v } = await load(); const p = paper();
  const meta = { school: '<img onerror=x>', examName: 'Exam', language: 'bn', fullMarks: 12 };
  const q = v.renderPaper(p, meta, { mode: 'questions' });
  assert.ok(!q.includes('<img') && !q.includes('<b>x</b>')); assert.ok(q.includes('&lt;b&gt;x&lt;/b&gt;'));
  assert.ok(q.includes('(ক) 1')); assert.ok(!q.includes('Answer Sheet') && !q.includes('উত্তরপত্র'));
  assert.ok(v.renderPaper(p, { ...meta, language: 'en' }, { mode: 'questions' }).includes('(a) 1'));

  const answers = {
    a: { answer: '2', correctOption: 1, steps: ['<s>tep</s>'], checked: '{"kind":"evaluate"}', verification: { status: 'VERIFIED_CORRECT', message: 'ok' } },
    c: { answer: 'sol', steps: [], verification: { status: 'VERIFICATION_UNAVAILABLE', message: 'Not independently verified.' } }
  };
  const wa = v.renderPaper(p, meta, { mode: 'with_answers', answers });
  assert.ok(wa.includes('উত্তরপত্র') && wa.includes('answers-page'));       // Bengali paper -> Bengali title
  assert.ok(wa.includes('(খ) 2'));                                                         // MCQ shows the chosen option
  assert.ok(wa.includes('Verified by SymPy') && wa.includes('Not verified: teacher review'));
  assert.ok(wa.includes('No answer generated yet'));                                       // question b has none
  assert.ok(!wa.includes('tep') && !wa.includes('Checked form'));                          // steps only in detailed
  const d = v.renderPaper(p, meta, { mode: 'detailed', answers });
  assert.ok(d.includes('&lt;s&gt;tep&lt;/s&gt;') && d.includes('Checked form'));
  const only = v.renderPaper(p, meta, { mode: 'answers_only', answers });
  assert.ok(only.includes('উত্তরপত্র') && !only.includes('Q2</div>') && !only.includes('class="q"'));
  assert.ok(!only.includes('answers-page'));                                               // no forced page break when alone
});

test('view: unknown statuses never render as verified', async () => {
  const { v } = await load();
  const html = v.renderPaper({ sections: [{ heading: 'h', questions: [{ id: 'z', text: 't', marks: 1 }] }] }, {}, { mode: 'with_answers', answers: { z: { answer: 'x', verification: { status: 'ALL_GOOD' } } } });
  assert.ok(!html.includes('Verified by SymPy</span>'));
  assert.ok(html.includes('Not verified'));
});

// ---------------------------------------------------------------- Phase 5
const katex = () => require('../public/vendor/katex/katex.min.js');

test('formulas: typeset with KaTeX, escaped when not math, and never throw', async () => {
  const { v } = await load(); const k = katex();
  assert.match(v.fmt('Solve $x^2 + 1 = 0$ now', k), /class="katex"/);
  assert.ok(v.fmt('Solve $x^2$', k).startsWith('Solve '));
  assert.match(v.fmt('$$\\frac{a}{b}$$', k), /katex-display/);
  assert.equal(v.fmt('Cost $5 and $10 total', k), 'Cost $5 and $10 total');                 // currency is not math
  assert.equal(v.fmt('a < b & "c"', k), 'a &lt; b &amp; &quot;c&quot;');
  assert.equal(v.fmt('plain $x$ text', null), 'plain $x$ text');                            // no KaTeX: shown as text
  assert.doesNotThrow(() => v.fmt('$\\frac{1}{$ and $\\badcommand{x}$', k));
  assert.ok(!v.fmt('$<img src=x onerror=alert(1)>$', k).includes('<img'));                  // HTML inside math stays inert
  assert.ok(!v.fmt('<script>x</script> $y$', k).includes('<script>'));
  assert.match(v.fmt('line1\nline2', k), /line1<br>line2/);
});

test('layout: sanitizer clamps, falls back and rejects bad logos', async () => {
  const { sanitizeLayout, DEFAULT_LAYOUT } = await import('../public/layout.js');
  assert.deepEqual(sanitizeLayout(undefined), DEFAULT_LAYOUT);
  const l = sanitizeLayout({ template: 'evil', pageSize: 'A3', margin: 999, fontSize: 'x', lineHeight: 0, border: 'double',
    numerals: 'bn', pageNumbers: 'yes', watermark: 'W'.repeat(99), footerText: 'a\nb\u0000c', logo: 'javascript:alert(1)' });
  assert.equal(l.template, 'traditional'); assert.equal(l.pageSize, 'A4'); assert.equal(l.margin, 30);
  assert.equal(l.fontSize, 12); assert.equal(l.lineHeight, 1.1); assert.equal(l.border, 'double'); assert.equal(l.numerals, 'bn');
  assert.equal(l.pageNumbers, false); assert.equal(l.watermark.length, 30); assert.equal(l.footerText, 'a b c'); assert.equal(l.logo, '');
  const ok = 'data:image/png;base64,iVBORw0KGgo=';
  assert.equal(sanitizeLayout({ logo: ok }).logo, ok);
  assert.equal(sanitizeLayout({ logo: 'data:image/svg+xml;base64,PHN2Zz4=' }).logo, '');   // SVG not allowed
  assert.equal(sanitizeLayout({ logo: ok + '"onerror="x' }).logo, '');
  assert.equal(sanitizeLayout({ logo: 'data:image/png;base64,' + 'A'.repeat(130000) }).logo, '');
});

test('layout: server and browser sanitizers agree on many inputs', async () => {
  const client = (await import('../public/layout.js')).sanitizeLayout;
  const server = require('../src/services/paper').sanitizeLayout;
  const cases = [undefined, null, 5, {}, { margin: 12.4, fontSize: 11.3, lineHeight: 1.37 }, { margin: -5 }, { margin: '20' },
    { fontSize: 99 }, { lineHeight: '1.8' }, { template: 'modern', pageSize: 'A5', fontFamily: 'serif', questionSpacing: 'relaxed', headerAlign: 'left' },
    { pageNumbers: false }, { pageNumbers: 1 }, { headerText: '  hi  ', footerText: 'x'.repeat(300), watermark: 'ওয়াটারমার্ক' },
    { logo: 'data:image/jpeg;base64,/9j/4AAQ' }, { logo: 'data:image/gif;base64,R0lGOD' }, { border: 'dashed' }, { numerals: 'bn' }];
  for (const c of cases) assert.deepEqual(server(c), client(c), JSON.stringify(c)?.slice(0, 60));
});

test('layout: CSS has page size, margins, page numbers and safe strings', async () => {
  const { layoutCss, cssStr, toBn } = await import('../public/layout.js');
  const a5 = layoutCss({ pageSize: 'A5', margin: 10 });
  assert.match(a5, /@page\{size:A5;margin:10mm 10mm 14mm;/); assert.match(a5, /"Page " counter\(page\) " of " counter\(pages\)/);
  assert.match(a5, /max-width:148mm/); assert.match(layoutCss({}), /max-width:210mm/);
  assert.match(layoutCss({ numerals: 'bn' }), /counter\(page, bengali\)/);
  assert.ok(!layoutCss({ pageNumbers: false }).includes('counter(page'));
  const evil = layoutCss({ footerText: '"} body{display:none} /*', headerText: 'a\\b' });
  const lit = evil.match(/@bottom-left\{content:("(?:[^"\\]|\\.)*")/);                    // the whole literal, honouring escapes
  assert.ok(lit && lit[1].includes('body{display:none}'));                                    // attack text stays inside the string
  assert.ok(!evil.replace(lit[1], '').includes('display:none'));                              // and appears nowhere as real CSS
  assert.equal(cssStr('a"b\\c'), '"a\\"b\\\\c"');
  assert.equal(toBn('Class 10, 2026'), 'Class ১০, ২০২৬');
});

test('view: templates, Bengali numerals, watermark, border, logo, labels and set badge', async () => {
  const { v } = await load(); const p = paper();
  const meta = { school: 'S', address: 'Dhaka', examName: 'E', className: '9', subject: 'গণিত', duration: '2 hours', date: '2026-12-01', language: 'bn', fullMarks: 12 };
  const html = v.renderPaper(p, meta, { layout: { template: 'modern', numerals: 'bn', border: 'double', watermark: 'DRAFT', headerAlign: 'left',
    logo: 'data:image/png;base64,iVBORw0KGgo=' }, setLabel: 'B', breakBefore: true });
  assert.match(html, /^<div class="sheet tpl-modern bd-double newset">/);
  assert.ok(html.includes('<div class="wm">DRAFT</div>') && html.includes('class="logo"') && html.includes('align-left'));
  assert.ok(html.includes('<b>১.</b>') && html.includes('[১]') && html.includes('পূর্ণমান: ১২') && html.includes('শ্রেণি: ৯'));
  assert.ok(html.includes('সেট B') && html.includes('Dhaka') && html.includes('সময়: 2 hours'.replace('2', '২')));
  const en = v.renderPaper(p, { ...meta, language: 'en' }, { layout: {} });
  assert.ok(en.includes('<b>1.</b>') && en.includes('Full marks: 12') && en.includes('Class: 9') && !en.includes('class="wm"'));
  assert.ok(!v.renderPaper(p, meta, { layout: { logo: '"><script>' } }).includes('<script>'));
  assert.ok(v.renderPaper(p, meta, { layout: { numerals: 'bn' }, math: katex() }).includes('<b>১.</b>'));
  // question text digits are never converted (only numbering, marks and header values)
  const t = v.renderPaper({ sections: [{ heading: 'h', questions: [{ id: 'z', text: '12 + 3', marks: 2 }] }] }, meta, { layout: { numerals: 'bn' } });
  assert.ok(t.includes('12 + 3') && t.includes('[২]'));
});

test('sets: same questions and marks per section, different order, answers stay correct', async () => {
  const { makeSets, MAX_SETS } = await import('../public/sets.js');
  const m = await import('../public/paperModel.js');
  const base = { title: 'T', sections: [
    { heading: 'MCQ', type: 'mcq', questions: Array.from({ length: 8 }, (_, i) => ({ id: 'm' + i, text: 'MCQ ' + i, marks: 1, difficulty: 'easy', options: ['A' + i, 'B' + i, 'C' + i, 'D' + i] })) },
    { heading: 'Short', type: 'short', questions: Array.from({ length: 5 }, (_, i) => ({ id: 's' + i, text: 'Short ' + i, marks: 2, difficulty: 'hard' })) }] };
  const answers = {}; base.sections[0].questions.forEach((q, i) => { answers[q.id] = { answer: q.options[i % 4], correctOption: i % 4, steps: [], verification: { status: 'VERIFICATION_UNAVAILABLE', message: '' } }; });
  const orig = JSON.stringify([base, answers]);

  const { sets, notes } = makeSets(base, answers, 3, 12345);
  assert.equal(JSON.stringify([base, answers]), orig);                                 // inputs never mutated
  assert.deepEqual(sets.map(s => s.name), ['A', 'B', 'C']);
  assert.deepEqual(sets[0].paper, base);                                               // set A is the original
  const sig = p => p.sections.map(s => s.questions.map(q => q.id).join(','));
  assert.notDeepEqual(sig(sets[1].paper), sig(sets[0].paper)); assert.notDeepEqual(sig(sets[2].paper), sig(sets[1].paper));
  assert.notDeepEqual(sig(sets[2].paper), sig(sets[0].paper));
  for (const s of sets) {
    assert.equal(m.totalMarks(s.paper), 8 + 10);                                       // consistent marks
    assert.deepEqual(s.paper.sections.map(x => x.questions.length), [8, 5]);
    assert.deepEqual(s.paper.sections[0].questions.map(q => q.id).sort(), base.sections[0].questions.map(q => q.id).sort());
    assert.deepEqual(s.paper.sections.map(x => x.questions.map(q => q.difficulty).sort().join()), base.sections.map(x => x.questions.map(q => q.difficulty).sort().join()));
    for (const q of s.paper.sections[0].questions) {                                   // answer key follows the shuffled options
      const orig0 = base.sections[0].questions.find(o => o.id === q.id);
      assert.equal(q.options[s.answers[q.id].correctOption], orig0.options[answers[q.id].correctOption]);
      assert.deepEqual([...q.options].sort(), [...orig0.options].sort());
    }
  }
  assert.ok(sets.slice(1).some(s => s.paper.sections[0].questions.some(q => q.options.join() !== base.sections[0].questions.find(o => o.id === q.id).options.join())));
  assert.deepEqual(makeSets(base, answers, 3, 12345).sets.map(s => sig(s.paper)), sets.map(s => sig(s.paper)));     // deterministic by seed
  assert.deepEqual(notes, []);
  assert.equal(makeSets(base, answers, 99, 1).sets.length, MAX_SETS);
  assert.equal(makeSets(base, answers, 1, 1).sets.length, 1);
});

test('sets: "all/none of the above" options keep their order; tiny sections are reported', async () => {
  const { makeSets } = await import('../public/sets.js');
  const base = { sections: [
    { heading: 'MCQ', questions: [{ id: 'a', text: 'q', marks: 1, options: ['1', '2', '3', 'None of the above'] }, { id: 'b', text: 'q2', marks: 1, options: ['x', 'y', 'উপরের সবগুলো', 'z'] }] },
    { heading: 'Two', questions: [{ id: 'c', text: 'c', marks: 1 }, { id: 'd', text: 'd', marks: 1 }] }] };
  const { sets, notes } = makeSets(base, {}, 3, 7);
  for (const s of sets) { assert.deepEqual(s.paper.sections[0].questions[0] ? s.paper.sections[0].questions.find(q => q.id === 'a').options : [], ['1', '2', '3', 'None of the above']); }
  assert.ok(notes.some(n => /Two/.test(n)));                                           // 2 questions cannot give 3 different orders
});

test('server meta sanitizer keeps layout and details', () => {
  const m = require('../src/services/paper').sanitizeMeta({ school: 'S', address: 'A', date: '2026-12-01', duration: '2h', layout: { pageSize: 'A5', border: 'x', watermark: 'W' } });
  assert.equal(m.layout.pageSize, 'A5'); assert.equal(m.layout.border, 'none'); assert.equal(m.layout.watermark, 'W');
  assert.equal(m.address, 'A'); assert.equal(m.duration, '2h');
  assert.equal(require('../src/services/paper').sanitizeMeta(null).layout.pageSize, 'A4');
});
