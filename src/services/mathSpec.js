'use strict';
// Shared by the math solver and the answer-sheet generator.

const KINDS = new Set(['evaluate', 'equivalent', 'factor', 'solve_equation', 'derivative',
  'integral', 'statistics', 'probability', 'geometry']);

// Only plain JSON data of limited size/depth is forwarded to the math service.
function cleanSpec(spec, depth = 0) {
  if (depth > 3) throw new Error('too deeply nested');
  if (spec === null || typeof spec === 'boolean') return spec;
  if (typeof spec === 'number') { if (!Number.isFinite(spec)) throw new Error('bad number'); return spec; }
  if (typeof spec === 'string') { if (spec.length > 300) throw new Error('string too long'); return spec; }
  if (Array.isArray(spec)) {
    if (spec.length > 1000) throw new Error('list too long');
    return spec.map(x => cleanSpec(x, depth + 1));
  }
  if (typeof spec === 'object') {
    const out = {};
    const keys = Object.keys(spec);
    if (keys.length > 20) throw new Error('too many fields');
    for (const k of keys) {
      if (!/^[a-z_0-9]{1,30}$/i.test(k)) throw new Error('bad field name');
      out[k] = cleanSpec(spec[k], depth + 1);
    }
    return out;
  }
  throw new Error('unsupported value');
}

function validSpec(spec) {
  try {
    const c = cleanSpec(spec);
    if (!c || typeof c !== 'object' || Array.isArray(c) || !KINDS.has(c.kind)) return null;
    return c;
  } catch (e) { return null; }
}

const SPEC_HELP = `"check" must be null or ONE of these JSON objects (all values are strings unless shown):
{"kind":"evaluate","expression":"3/4+1/4","proposed":"1"}
{"kind":"equivalent","expression":"(a+b)^2","proposed":"a^2+2*a*b+b^2"}
{"kind":"factor","expression":"x^2-5*x+6","proposed":"(x-2)*(x-3)"}
{"kind":"solve_equation","equation":"x^2-5*x+6=0","variable":"x","proposed":["2","3"]}
{"kind":"solve_equation","equations":["x+y=5","x-y=1"],"variables":["x","y"],"proposed":[{"x":"3","y":"2"}]}
{"kind":"derivative","expression":"x^3","variable":"x","proposed":"3*x^2"}
{"kind":"integral","expression":"2*x","variable":"x","proposed":"x^2+C"}  (definite: add "limits":["0","3"] and proposed is a number)
{"kind":"statistics","op":"mean|median|mode|range|variance|stdev","data":["2","4","6"],"proposed":"4"}
{"kind":"probability","expression":"binomial(5,2)/binomial(10,2)","proposed":"2/9"}
{"kind":"geometry","shape":"rectangle|square|triangle|triangle_sss|right_triangle|circle|trapezium|parallelogram|rhombus|cube|cuboid|cylinder|cone|sphere","quantity":"area|perimeter|volume|...","params":{"l":"5","w":"3"},"proposed":"15"}
Syntax inside check: use ^ for powers, write * between factors, sqrt(), sind()/cosd()/tand() for degrees, pi, no % signs, no LaTeX, no words.
The "check" MUST restate the student's ORIGINAL problem exactly (same numbers and equation) and "proposed" must be your final answer. Use null if no kind fits.`;

module.exports = { KINDS, cleanSpec, validSpec, SPEC_HELP };
