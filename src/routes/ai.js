'use strict';
const { fail } = require('../middleware/auth');
const { generateAnswers } = require('../services/answers');
const { regenerateQuestion } = require('../services/regenerate');
const { PaperError } = require('../services/paper');

const status = e => (e instanceof PaperError ? 400 : e.code === 'AI_TIMEOUT' ? 504 : 502);
const wrap = fn => async (req, res) => {
  try { res.json({ ok: true, ...(await fn(req.body)) }); }
  catch (e) { fail(res, status(e), e.code || 'AI_ERROR', e.message); }
};

// POST /api/answers/generate  { meta, questions:[≤10] }  ->  { answers:{id:{answer,steps,verification,...}} }
const answersHandler = wrap(generateAnswers);
// POST /api/questions/regenerate  { question, type, difficulty, others, ... }  ->  { question }
const regenerateHandler = wrap(async body => ({ question: await regenerateQuestion(body) }));

module.exports = { answersHandler, regenerateHandler };
