'use strict';
const ocr = require('../services/ocr');
const { fail } = require('../middleware/auth');

// Handles one file per request so the browser can show per-file progress and retry.
// body: { name, mimeType, data (base64, no data: prefix), mode: "text" | "math" }
async function extractHandler(req, res) {
  const { name, mimeType, data } = req.body || {};
  const mode = req.body?.mode === 'math' ? 'math' : 'text';

  const v = ocr.validateFile(mimeType, data);
  if (!v.ok) return fail(res, v.code === 'FILE_TOO_LARGE' ? 413 : 400, v.code, v.message);

  try {
    const out = await ocr.extract(mimeType, v.buf, mode);
    if (!out.text) return fail(res, 422, 'NO_TEXT', 'No readable text was found in this file. Try a clearer photo.');
    const markers = (out.text.match(/⟦/g) || []).length;
    res.json({
      ok: true,
      name: String(name || '').slice(0, 120),
      mode,
      ...out,
      uncertainMarkers: markers,
      note: 'Review the text before using it. Parts marked ⟦ ⟧ were hard to read.'
    });
  } catch (e) {
    const status = e.code === 'AI_TIMEOUT' ? 504 : 502;
    fail(res, status, e.code || 'AI_ERROR', e.message);
  }
}

module.exports = { extractHandler };
