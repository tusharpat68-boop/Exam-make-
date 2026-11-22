'use strict';
const { getAuth } = require('../services/firebase');

function fail(res, status, code, message) {
  return res.status(status).json({ ok: false, error: { code, message } });
}

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return fail(res, 401, 'UNAUTHENTICATED', 'Please log in');
  try {
    req.user = await getAuth().verifyIdToken(token);
    next();
  } catch (e) {
    return fail(res, 401, 'UNAUTHENTICATED', 'Session expired, please log in again');
  }
}

// Admin check is done on the server against ADMIN_UIDS, never from a client flag.
function requireAdmin(req, res, next) {
  const ids = (process.env.ADMIN_UIDS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!req.user || !ids.includes(req.user.uid)) return fail(res, 403, 'FORBIDDEN', 'Admin only');
  next();
}

module.exports = { requireAuth, requireAdmin, fail };
