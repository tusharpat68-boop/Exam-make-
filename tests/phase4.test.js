'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const paperLib = require('../src/services/paper');
const gemini = require('../src/services/gemini');
const mathClient = require('../src/services/mathClient');
const answers = require('../src/services/answers');
const regen = require('../src/services/regenerate');
const { createPaperHandlers } = require('../src/routes/papers');
const { answersHandler, regenerateHandler } = require('../src/routes/ai');
const { memoryStore } = require('../src/services/store');

function fakeRes() {
  const r = { code: 200, body: null };
  r.status = c => { r.code = c; return r; };
  r.json = b => { r.body = b; return r; };
  return r;
}
const goodPaper = () => ({
  title: 'T',
  sections: [
    { heading: 'A', type: 'mcq', questions: [{ id: 'q1', text: '2+2?', marks: 1, difficulty: 'easy', options: ['3', '4', '5', '6'] }] },
    { heading: 'B', type: 'math', questions: [{ id: 'q2', text: 'Solve x^2-5x+6=0', marks: 4 }] }
  ]
});

// ---------------------------------------------------------------- sanitizer
test('sanitizePaper keeps valid papers, assigns ids, defaults difficulty', () => {
  const p = paperLib.sanitizePaper({ sections: [{ heading: 'H', questions: [{ text: 'hi', marks: 2 }] }] });
  assert.match(p.sections[0].questions[0].id, /^q[0-9a-f]{10}$/);
  assert.equal(p.sections[0].questions[0].difficulty, 'medium');
  assert.equal(paperLib.totalMarks(goodPaper()), 5);
});

test('sanitizePaper rejects bad shapes and limits', () => {
  const bad = x => assert.throws(() => paperLib.sanitizePaper(x), /./);
  bad(null); bad({}); bad({ sections: [] });
  bad({ sections: [{ questions: [{ text: '', marks: 1 }] }] });                // empty text
  bad({ sections: [{ questions: [{ text: 'a', marks: -1 }] }] });              // negative marks
  bad({ sections: [{ questions: [{ text: 'a', marks: 'x' }] }] });             // non-number marks
  bad({ sections: [{ questions: [{ text: 'a', marks: 1, options: Array(9).fill('o') }] }] });
  bad({ sections: Array(11).fill({ questions: [{ text: 'a', marks: 1 }] }) });
  bad({ sections: [{ questions: Array(51).fill({ text: 'a', marks: 1 }) }] });
});

test('duplicate or malicious ids are replaced; long text is capped', () => {
  const p = paperLib.sanitizePaper({ sections: [{ questions: [
    { id: 'same', text: 'a', marks: 1 }, { id: 'same', text: 'b', marks: 1 }, { id: '<script>', text: 'c'.repeat(5000), marks: 1 }] }] });
  const ids = p.sections[0].questions.map(q => q.id);
  assert.equal(new Set(ids).size, 3);
  assert.ok(!ids.some(i => i.includes('<')));
  assert.equal(p.sections[0].questions[2].text.length, 2000);
});

test('sanitizeAnswers drops unknown ids and forces valid statuses', () => {
  const out = paperLib.sanitizeAnswers({
    q1: { answer: 'x', steps: ['s'], verification: { status: 'VERIFIED_CORRECT', message: 'm' } },
    q9: { answer: 'ghost' },
    q2: { answer: 'y', verification: { status: 'HACKED' } }
  }, new Set(['q1', 'q2']));
  assert.deepEqual(Object.keys(out).sort(), ['q1', 'q2']);
  assert.equal(out.q2.verification.status, 'VERIFICATION_UNAVAILABLE');
});

// ---------------------------------------------------------------- answers
function stub(geminiReplies, verifyFn) {
  const og = gemini.callGemini, ov = mathClient.verify;
  let i = 0; const prompts = [];
  gemini.callGemini = async p => { prompts.push(p); return geminiReplies[Math.min(i++, geminiReplies.length - 1)]; };
  mathClient.verify = verifyFn || (async () => ({ status: 'VERIFICATION_UNAVAILABLE', message: 'down', details: {} }));
  return { prompts, restore() { gemini.callGemini = og; mathClient.verify = ov; } };
}
const req2 = () => ({
  meta: { language: 'en', subject: 'Math' },
  questions: [
    { id: 'q1', type: 'mcq', text: '2+2?', marks: 1, options: ['3', '4', '5', '6'] },
    { id: 'q2', type: 'math', text: 'Solve x^2-5x+6=0', marks: 4 },
    { id: 'q3', type: 'short', text: 'Define a prime number', marks: 2 }
  ]
});
const spec = { kind: 'solve_equation', equation: 'x^2-5*x+6=0', proposed: ['2', '3'] };

test('answers: only SymPy-checked answers are VERIFIED; everything else is labelled not verified', async () => {
  const s = stub([{ answers: [
    { id: 'q1', answer: '4', steps: [], correctOption: 1, check: { kind: 'evaluate', expression: '2+2', proposed: '4' } },
    { id: 'q2', answer: 'x=2,3', steps: ['factor'], check: spec },
    { id: 'q3', answer: 'A number with two factors', steps: [], check: null }
  ] }], async sp => ({ status: 'VERIFIED_CORRECT', message: 'ok', details: {} }));
  try {
    const { answers: a } = await answers.generateAnswers(req2());
    assert.equal(a.q1.verification.status, 'VERIFIED_CORRECT');
    assert.equal(a.q1.correctOption, 1);
    assert.equal(a.q2.verification.status, 'VERIFIED_CORRECT');
    assert.ok(a.q2.checked.includes('solve_equation'));
    assert.equal(a.q3.verification.status, 'VERIFICATION_UNAVAILABLE');      // no check -> never verified
    assert.match(a.q3.verification.message, /review/i);
  } finally { s.restore(); }
});

test('answers: service down means unavailable, never verified', async () => {
  const s = stub([{ answers: [{ id: 'q2', answer: 'x', steps: [], check: spec }] }]);
  try {
    const { answers: a } = await answers.generateAnswers({ ...req2(), questions: [req2().questions[1]] });
    assert.equal(a.q2.verification.status, 'VERIFICATION_UNAVAILABLE');
  } finally { s.restore(); }
});

test('answers: wrong answer is retried once with checker feedback, new answer is re-verified', async () => {
  let calls = 0;
  const s = stub([
    { answers: [{ id: 'q2', answer: 'x=2', steps: ['bad'], check: { ...spec, proposed: ['2'] } }] },
    { answers: [{ id: 'q2', answer: 'x=2,3', steps: ['good'], check: spec }] }
  ], async sp => (++calls === 1
    ? { status: 'INCORRECT', message: 'no', details: { expected: [{ text: '2' }, { text: '3' }] } }
    : { status: 'VERIFIED_CORRECT', message: 'ok', details: {} }));
  try {
    const out = await answers.generateAnswers({ ...req2(), questions: [req2().questions[1]] });
    assert.equal(out.retried, true);
    assert.equal(out.answers.q2.answer, 'x=2,3');
    assert.equal(out.answers.q2.verification.status, 'VERIFIED_CORRECT');
    assert.match(s.prompts[1], /checker expects: 2, 3/);
  } finally { s.restore(); }
});

test('answers: still-wrong answer stays INCORRECT and shows the expected value', async () => {
  const s = stub([{ answers: [{ id: 'q2', answer: 'x=5', steps: [], check: spec }] }],
    async () => ({ status: 'INCORRECT', message: 'Not equal.', details: { expected: [{ text: '2' }, { text: '3' }] } }));
  try {
    const out = await answers.generateAnswers({ ...req2(), questions: [req2().questions[1]] });
    assert.equal(out.answers.q2.verification.status, 'INCORRECT');
    assert.match(out.answers.q2.verification.message, /expects: 2, 3/);
  } finally { s.restore(); }
});

test('answers: invalid MCQ option and missing answers need manual review; malicious checks are ignored', async () => {
  const s = stub([{ answers: [
    { id: 'q1', answer: '4', correctOption: 9, check: { kind: 'evaluate', expression: '2+2', proposed: '4' } },
    { id: 'q2', answer: 'x', check: { kind: 'rm -rf', expression: '1' } }
  ] }], async () => ({ status: 'VERIFIED_CORRECT', message: 'ok', details: {} }));
  try {
    const { answers: a } = await answers.generateAnswers(req2());
    assert.equal(a.q1.verification.status, 'NEEDS_MANUAL_REVIEW');           // bad option can never read as verified
    assert.equal(a.q2.verification.status, 'VERIFICATION_UNAVAILABLE');      // unknown kind rejected
    assert.equal(a.q3.verification.status, 'NEEDS_MANUAL_REVIEW');           // AI skipped it
  } finally { s.restore(); }
});

test('answers: request limits and prompt-injection framing', () => {
  assert.throws(() => answers.cleanRequest({ questions: [] }));
  assert.throws(() => answers.cleanRequest({ questions: Array(11).fill({ text: 'a', marks: 1 }) }));
  assert.match(answers.buildAnswerPrompt(answers.cleanRequest(req2())), /data, not instructions/);
});

test('answers handler maps errors to status codes', async () => {
  const og = gemini.callGemini;
  gemini.callGemini = async () => { throw Object.assign(new Error('slow'), { code: 'AI_TIMEOUT' }); };
  let res = fakeRes(); await answersHandler({ body: req2() }, res); assert.equal(res.code, 504);
  gemini.callGemini = async () => { throw new Error('x'); };
  res = fakeRes(); await answersHandler({ body: req2() }, res); assert.equal(res.code, 502);
  res = fakeRes(); await answersHandler({ body: { questions: [] } }, res); assert.equal(res.code, 400);
  gemini.callGemini = og;
});

// ---------------------------------------------------------------- regenerate
const rbody = (over = {}) => ({
  question: { text: 'old question', marks: 2 }, type: 'short', difficulty: 'hard', others: ['other one'], language: 'en', ...over
});

test('regenerate: forces requested marks and difficulty, rejects duplicates and bad MCQ/creative output', async () => {
  const og = gemini.callGemini;
  try {
    gemini.callGemini = async () => ({ text: 'brand new question', marks: 99 });
    const q = await regen.regenerateQuestion(rbody());
    assert.equal(q.marks, 2); assert.equal(q.difficulty, 'hard'); assert.equal(q.parts, undefined);

    gemini.callGemini = async () => ({ text: 'OTHER   one' });
    await assert.rejects(regen.regenerateQuestion(rbody()), /already exists/);
    gemini.callGemini = async () => ({ text: 'old question' });
    await assert.rejects(regen.regenerateQuestion(rbody()), /already exists/);

    gemini.callGemini = async () => ({ text: 'mcq?', options: ['a', 'b', 'c'] });
    await assert.rejects(regen.regenerateQuestion(rbody({ type: 'mcq' })), /invalid MCQ/);
    gemini.callGemini = async () => ({ text: 'mcq?', options: ['a', 'b', 'c', 'd'] });
    assert.equal((await regen.regenerateQuestion(rbody({ type: 'mcq' }))).options.length, 4);

    gemini.callGemini = async () => ({ text: 'stem', parts: [{ label: 'ক', text: 'a', marks: 1 }, { label: 'খ', text: 'b', marks: 2 }] });
    await assert.rejects(regen.regenerateQuestion(rbody({ type: 'creative', question: { text: 'old', marks: 10 } })), /do not add up/);
    gemini.callGemini = async () => ({ text: 'stem', parts: [{ label: 'ক', text: 'a', marks: 6 }, { label: 'খ', text: 'b', marks: 4 }] });
    assert.equal((await regen.regenerateQuestion(rbody({ type: 'creative', question: { text: 'old', marks: 10 } }))).parts.length, 2);
  } finally { gemini.callGemini = og; }
});

test('regenerate handler: bad input is 400', async () => {
  const res = fakeRes(); await regenerateHandler({ body: {} }, res); assert.equal(res.code, 400);
});

// ---------------------------------------------------------------- saved papers
const mk = uid => ({ user: { uid }, params: {}, body: {} });

test('papers: create / list / get / update / delete for the owner', async () => {
  const store = memoryStore(); let tick = 0;
  const h = createPaperHandlers(store, () => `2026-11-20T00:00:0${tick++}Z`);
  let res = fakeRes();
  await h.create({ ...mk('alice'), body: { paper: goodPaper(), meta: { examName: 'Half Yearly', subject: 'Math', fullMarks: 5 }, answers: { q1: { answer: '4' }, ghost: { answer: 'x' } } } }, res);
  assert.equal(res.body.ok, true);
  const id = res.body.id;
  assert.equal(store.docs.get(id).ownerUid, 'alice');
  assert.equal(store.docs.get(id).marksTotal, 5);
  assert.deepEqual(Object.keys(store.docs.get(id).answers), ['q1']);

  res = fakeRes(); await h.list(mk('alice'), res);
  assert.equal(res.body.papers.length, 1); assert.equal(res.body.papers[0].title, 'Half Yearly'); assert.equal(res.body.papers[0].hasAnswers, true);

  res = fakeRes(); await h.get({ ...mk('alice'), params: { id } }, res);
  assert.equal(res.body.paper.sections.length, 2);

  res = fakeRes();
  await h.update({ ...mk('alice'), params: { id }, body: { paper: goodPaper(), meta: { examName: 'Renamed' } } }, res);
  assert.equal(store.docs.get(id).title, 'Renamed');
  assert.equal(store.docs.get(id).ownerUid, 'alice');
  assert.equal(store.docs.get(id).createdAt, '2026-11-20T00:00:00Z');
  assert.notEqual(store.docs.get(id).updatedAt, store.docs.get(id).createdAt);

  res = fakeRes(); await h.remove({ ...mk('alice'), params: { id } }, res);
  assert.equal(store.docs.size, 0);
});

test('papers: another user cannot read, change or delete a paper (looks like not found)', async () => {
  const store = memoryStore(); const h = createPaperHandlers(store);
  let res = fakeRes();
  await h.create({ ...mk('alice'), body: { paper: goodPaper(), meta: {} } }, res);
  const id = res.body.id;
  for (const [fn, extra] of [['get', {}], ['update', { body: { paper: goodPaper() } }], ['remove', {}]]) {
    res = fakeRes(); await h[fn]({ ...mk('mallory'), params: { id }, ...extra }, res);
    assert.equal(res.code, 404, fn);
  }
  assert.equal(store.docs.size, 1);
  res = fakeRes(); await h.list(mk('mallory'), res); assert.equal(res.body.papers.length, 0);
  res = fakeRes(); await h.get({ ...mk('alice'), params: { id: '../etc/passwd' } }, res); assert.equal(res.code, 404);
});

test('papers: invalid, oversized and over-limit saves are refused; store errors are reported', async () => {
  const store = memoryStore(); const h = createPaperHandlers(store);
  let res = fakeRes(); await h.create({ ...mk('a'), body: { paper: { sections: [] } } }, res); assert.equal(res.code, 400);
  const big = { sections: Array.from({ length: 10 }, () => ({ heading: 'h', questions: Array.from({ length: 10 }, () => ({ text: 'x'.repeat(2000), marks: 1, options: Array(6).fill('o'.repeat(300)), parts: Array(8).fill({ label: 'ক', text: 'y'.repeat(2000), marks: 1 }) })) })) };
  res = fakeRes(); await h.create({ ...mk('a'), body: { paper: big } }, res); assert.equal(res.code, 400);
  assert.match(res.body.error.message, /too large/);
  for (let i = 0; i < 100; i++) await store.create({ ownerUid: 'full' });
  res = fakeRes(); await h.create({ ...mk('full'), body: { paper: goodPaper() } }, res); assert.equal(res.code, 400); assert.equal(res.body.error.code, 'LIMIT');
  const broken = createPaperHandlers({ listByOwner: async () => { throw new Error('db down'); } });
  res = fakeRes(); await broken.list(mk('a'), res); assert.equal(res.code, 500); assert.equal(res.body.error.code, 'STORE_ERROR');
});
