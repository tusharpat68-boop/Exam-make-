'use strict';
// Owner-only CRUD for small per-user collections (school profiles, templates).
// Handlers are plain functions so they can be tested without Express.
const { fail } = require('../middleware/auth');
const { InvalidInput } = require('../services/profiles');

const ID_RE = /^[A-Za-z0-9]{8,40}$/;

function createCollectionHandlers(store, { sanitize, summarize, max, noun }, now = () => new Date().toISOString()) {
  const strip = d => { const { ownerUid, ...rest } = d; return rest; };   // never send ownerUid back
  const owned = async (req, res) => {
    const id = req.params?.id;
    if (!ID_RE.test(id || '')) { fail(res, 404, 'NOT_FOUND', `${noun} not found`); return null; }
    const doc = await store.get(id);
    if (!doc || doc.ownerUid !== req.user.uid) { fail(res, 404, 'NOT_FOUND', `${noun} not found`); return null; }
    return doc;
  };
  const guard = fn => async (req, res) => {
    try { await fn(req, res); } catch (e) {
      if (e instanceof InvalidInput) return fail(res, 400, e.code, e.message);
      console.error(`${noun} error:`, e.message);
      return fail(res, 500, 'STORE_ERROR', 'Could not reach the database. Please try again.');
    }
  };
  return {
    list: guard(async (req, res) => {
      const rows = await store.listByOwner(req.user.uid);
      rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      res.json({ ok: true, items: rows.map(d => summarize(strip(d))) });
    }),
    get: guard(async (req, res) => {
      const d = await owned(req, res); if (!d) return;
      res.json({ ok: true, item: strip(d) });
    }),
    create: guard(async (req, res) => {
      const data = sanitize(req.body);
      const existing = await store.listByOwner(req.user.uid);
      if (existing.length >= max) return fail(res, 400, 'LIMIT', `You can save up to ${max} ${noun}s. Delete an old one first.`);
      const t = now();
      const id = await store.create({ ...data, ownerUid: req.user.uid, createdAt: t, updatedAt: t });
      res.json({ ok: true, id, updatedAt: t });
    }),
    update: guard(async (req, res) => {
      const d = await owned(req, res); if (!d) return;
      const data = sanitize(req.body);
      const t = now();
      await store.update(d.id, { ...data, updatedAt: t });     // ownerUid and createdAt are never overwritten
      res.json({ ok: true, id: d.id, updatedAt: t });
    }),
    remove: guard(async (req, res) => {
      const d = await owned(req, res); if (!d) return;
      await store.remove(d.id);
      res.json({ ok: true });
    })
  };
}

const schoolHandlers = store => createCollectionHandlers(store, {
  sanitize: require('../services/profiles').sanitizeSchool,
  summarize: d => ({ id: d.id, name: d.name, school: d.school, hasLogo: !!d.layout?.logo, updatedAt: d.updatedAt }),
  max: 20, noun: 'school profile'
});
const templateHandlers = store => createCollectionHandlers(store, {
  sanitize: require('../services/profiles').sanitizeTemplate,
  summarize: d => d,
  max: 50, noun: 'template'
});

module.exports = { createCollectionHandlers, schoolHandlers, templateHandlers };
