'use strict';
const express = require('express');
const { requireAuth, fail } = require('../middleware/auth');
const { callGemini } = require('../services/gemini');
const { verify } = require('../services/mathClient');
const { KINDS, validSpec, SPEC_HELP } = require('../services/mathSpec');

const router = express.Router();

// POST /api/math/verify  body: a check spec, e.g. {kind:"solve_equation", equation:"x^2-5x+6=0", proposed:["2","3"]}
router.post('/verify', requireAuth, async (req, res) => {
  const spec = validSpec(req.body);
  if (!spec) return fail(res, 400, 'INVALID_SPEC', 'Unsupported or invalid check. Supported kinds: ' + [...KINDS].join(', '));
  res.json({ ok: true, verification: await verify(spec) });
});

function solvePrompt(problem, classLevel, language, feedback) {
  const lang = language === 'bn' ? 'Bengali' : 'English';
  return [
    `You are a careful mathematics teacher for Bangladesh school students.`,
    `Solve this problem step by step, explaining in ${lang}. Class level: ${classLevel || 'not specified'}.`,
    `Problem: ${problem}`,
    feedback ? `An independent checker found your previous answer wrong: ${feedback}\nSolve again carefully from scratch.` : '',
    `Return ONLY JSON: {"given":[string],"find":string,"formulas":[string],"steps":[string],"finalAnswer":string,"check":object|null}`,
    SPEC_HELP
  ].filter(Boolean).join('\n\n');
}

// POST /api/math/solve  body: {problem, classLevel, language}
router.post('/solve', requireAuth, async (req, res) => {
  const problem = String(req.body?.problem || '').trim();
  if (!problem || problem.length > 2000) return fail(res, 400, 'INVALID_PROBLEM', 'Problem must be 1-2000 characters');
  const classLevel = String(req.body?.classLevel || '').slice(0, 20);
  const language = req.body?.language === 'en' ? 'en' : 'bn';

  try {
    let solution = await callGemini(solvePrompt(problem, classLevel, language));
    let spec = validSpec(solution.check);
    let verification = spec ? await verify(spec) : {
      status: 'VERIFICATION_UNAVAILABLE', kind: 'none',
      message: 'This problem could not be turned into an automatic check. Review it manually.', details: {}
    };
    let retried = false;

    // One retry if the independent check proves the answer wrong.
    if (verification.status === 'INCORRECT') {
      retried = true;
      const hint = JSON.stringify(verification.details?.expected ?? verification.message).slice(0, 400);
      const second = await callGemini(solvePrompt(problem, classLevel, language, `expected result by SymPy: ${hint}`));
      const spec2 = validSpec(second.check);
      const ver2 = spec2 ? await verify(spec2) : null;
      if (ver2) { solution = second; spec = spec2; verification = ver2; }
    }

    res.json({
      ok: true,
      solution: {
        given: solution.given, find: solution.find, formulas: solution.formulas,
        steps: solution.steps, finalAnswer: solution.finalAnswer
      },
      verification,
      checkedSpec: spec,
      retried,
      note: 'Verification covers the machine-checkable form in "checkedSpec". Confirm that it matches your original problem.'
    });
  } catch (e) {
    const status = e.code === 'AI_TIMEOUT' ? 504 : 502;
    fail(res, status, e.code || 'AI_ERROR', e.message);
  }
});

module.exports = router;
