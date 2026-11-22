'use strict';
// Plain handler functions (wired to Express in server.js) so they can be tested without a server.
const { fail } = require('../middleware/auth');
const { sanitizePaper, sanitizeMeta, sanitizeAnswers, totalMarks, PaperError } = require('../services/paper');

const MAX_PAPERS = 100;
const MAX_BYTES = 400 * 1024;
const ID_RE = /^[A-Za-z0-9]{8,40}$/;

function buildDoc(body) {
  const paper = sanitizePaper(body?.paper);
  const meta = sanitizeMeta(body?.meta);
  const ids = new Set(paper.sections.flatMap(s => s.questions.map(q => q.id)));
  const answers = sanitizeAnswers(body?.answers, ids);
  const doc = {
    title: (meta.examName || paper.title || meta.subject || 'Untitled paper').slice(0, 200),
    subject: meta.subject, className: meta.className, fullMarks: meta.fullMarks,
    marksTotal: totalMarks(paper), meta, paper, answers
  };
  if (Buffer.byteLength(JSON.stringify(doc)) > MAX_BYTES) throw new PaperError('This paper is too large to save');
  return doc;
}

function createPaperHandlers(store, now = () => new Date().toISOString()) {
  const owned = async (req, res) => {
    const id = req.params?.id;
    if (!ID_RE.test(id || '')) { fail(res, 404, 'NOT_FOUND', 'Paper not found'); return null; }
    const doc = await store.get(id);
    // Someone else's paper looks exactly like a missing one.
    if (!doc || doc.ownerUid !== req.user.uid) { fail(res, 404, 'NOT_FOUND', 'Paper not found'); return null; }
    return doc;
  };
  const guard = fn => async (req, res) => {
    try { await fn(req, res); } catch (e) {
      if (e instanceof PaperError) return fail(res, 400, e.code, e.message);
      console.error('papers error:', e.message);
      return fail(res, 500, 'STORE_ERROR', 'Could not reach the database. Please try again.');
    }
  };

  return {
    list: guard(async (req, res) => {
      const rows = await store.listByOwner(req.user.uid);
      rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      res.json({ ok: true, papers: rows.map(d => ({
        id: d.id, title: d.title, subject: d.subject, className: d.className, fullMarks: d.fullMarks,
        hasAnswers: !!d.answers && Object.keys(d.answers).length > 0, updatedAt: d.updatedAt
      })) });
    }),
    get: guard(async (req, res) => {
      const d = await owned(req, res); if (!d) return;
      res.json({ ok: true, paper: d.paper, meta: d.meta, answers: d.answers || {}, id: d.id, updatedAt: d.updatedAt });
    }),
    create: guard(async (req, res) => {
      const doc = buildDoc(req.body);
      const existing = await store.listByOwner(req.user.uid);
      if (existing.length >= MAX_PAPERS) return fail(res, 400, 'LIMIT', `You can save up to ${MAX_PAPERS} papers. Delete an old one first.`);
      const t = now();
      const id = await store.create({ ...doc, ownerUid: req.user.uid, createdAt: t, updatedAt: t });
      res.json({ ok: true, id, updatedAt: t });
    }),
    update: guard(async (req, res) => {
      const d = await owned(req, res); if (!d) return;
      const doc = buildDoc(req.body);
      const t = now();
      await store.update(d.id, { ...doc, updatedAt: t });   // ownerUid and createdAt are never overwritten
      res.json({ ok: true, id: d.id, updatedAt: t });
    }),
    remove: guard(async (req, res) => {
      const d = await owned(req, res); if (!d) return;
      await store.remove(d.id);
      res.json({ ok: true });
    })
  };
}

module.exports = { createPaperHandlers, buildDoc, MAX_PAPERS };
