'use strict';
const express = require('express');
const { requireAuth, fail } = require('../middleware/auth');
const { validateConfig, validatePaper } = require('../services/marks');
const { generatePaper } = require('../services/gemini');

const router = express.Router();

// POST /api/questions/validate  — check marks/difficulty before generating
router.post('/validate', requireAuth, (req, res) => {
  const v = validateConfig(req.body || {});
  res.json({ ok: v.ok, errors: v.errors, total: v.total });
});

// POST /api/questions/generate
router.post('/generate', requireAuth, async (req, res) => {
  const cfg = req.body?.config || {};
  const sourceText = String(req.body?.sourceText || '').slice(0, 20000);

  const v = validateConfig(cfg);
  if (!v.ok) return fail(res, 400, 'INVALID_CONFIG', v.errors.join('; '));

  try {
    const paper = await generatePaper(cfg, sourceText);
    const check = validatePaper(paper, cfg);
    // Never hide a marks problem: return the paper with warnings so the teacher can fix it.
    res.json({ ok: true, paper, warnings: check.errors, marksTotal: check.total });
  } catch (e) {
    const status = e.code === 'AI_TIMEOUT' ? 504 : 502;
    return fail(res, status, e.code || 'AI_ERROR', e.message);
  }
});

module.exports = router;
