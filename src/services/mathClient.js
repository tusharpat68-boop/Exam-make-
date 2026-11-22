'use strict';

const UNAVAILABLE = {
  status: 'VERIFICATION_UNAVAILABLE',
  kind: 'unknown',
  message: 'The math verification service is not reachable. Treat this answer as unverified.',
  details: {}
};

// Calls the local Python/SymPy service. Never throws: if the service is down the answer is
// reported as VERIFICATION_UNAVAILABLE, never as verified.
async function verify(spec) {
  const base = process.env.MATH_SERVICE_URL || 'http://127.0.0.1:5001';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(base + '/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Math-Token': process.env.MATH_SERVICE_TOKEN || '' },
      body: JSON.stringify(spec),
      signal: ctrl.signal
    });
    if (!r.ok) return { ...UNAVAILABLE, message: `Math service returned an error (${r.status}). Treat this answer as unverified.` };
    const out = await r.json();
    if (!out || typeof out.status !== 'string') return UNAVAILABLE;
    return out;
  } catch (e) {
    return UNAVAILABLE;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { verify };
