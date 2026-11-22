"""Independent verification with SymPy. The AI proposes an answer; this module checks it.

Rules:
- Never return VERIFIED_CORRECT for something that was not actually proven.
- Unsupported kinds -> VERIFICATION_UNAVAILABLE. Unparseable/rejected input -> NEEDS_MANUAL_REVIEW.
- All text goes through safety.check_expression before SymPy sees it. No unrestricted eval/exec.
"""
import re

from . import numcompare, safety, stats
from .status import (VERIFIED_CORRECT, INCORRECT, PARTIALLY_VERIFIED,
                     VERIFICATION_UNAVAILABLE, NEEDS_MANUAL_REVIEW, result)

try:
    import sympy as sp
    from sympy.parsing.sympy_parser import (
        parse_expr, standard_transformations,
        implicit_multiplication_application, rationalize)
except ImportError:  # service still starts; SymPy-based kinds report "unavailable"
    sp = None


class ParseError(Exception):
    pass


# ---------------------------------------------------------------- parsing
if sp is not None:
    import string

    def _fact(n):
        n = sp.sympify(n)
        if not (n.is_Integer and 0 <= n <= 200):
            raise ValueError('factorial argument must be an integer from 0 to 200')
        return sp.factorial(n)

    def _binom(n, k):
        n, k = sp.sympify(n), sp.sympify(k)
        if not (n.is_Integer and k.is_Integer and 0 <= k <= n <= 200):
            raise ValueError('binomial arguments must be integers with 0 <= k <= n <= 200')
        return sp.binomial(n, k)

    _LOCAL = {c: sp.Symbol(c) for c in string.ascii_letters}
    _LOCAL.update({
        'E': sp.E, 'pi': sp.pi, 'sqrt': sp.sqrt,
        'sin': sp.sin, 'cos': sp.cos, 'tan': sp.tan, 'cot': sp.cot,
        'sec': sp.sec, 'csc': sp.csc,
        'asin': sp.asin, 'acos': sp.acos, 'atan': sp.atan,
        'sind': lambda x: sp.sin(x * sp.pi / 180),
        'cosd': lambda x: sp.cos(x * sp.pi / 180),
        'tand': lambda x: sp.tan(x * sp.pi / 180),
        'log': sp.log, 'ln': sp.log, 'log10': lambda x: sp.log(x, 10),
        'exp': sp.exp, 'abs': sp.Abs,
        'factorial': _fact, 'binomial': _binom,
    })
    _GLOBAL = {'Integer': sp.Integer, 'Float': sp.Float,
               'Rational': sp.Rational, 'Symbol': sp.Symbol}
    _TRANSFORMS = standard_transformations + (implicit_multiplication_application, rationalize)


def parse(text):
    norm = safety.check_expression(text)
    try:
        g = dict(_GLOBAL)
        g['__builtins__'] = {}
        return parse_expr(norm, local_dict=dict(_LOCAL), global_dict=g,
                          transformations=_TRANSFORMS, evaluate=True)
    except Exception:
        raise ParseError(f'could not read the expression: {str(text)[:40]}')


def _need(req, *names):
    for n in names:
        if n not in req or req[n] is None or req[n] == '':
            raise ParseError(f'missing field: {n}')


def _symbol(name):
    name = str(name)
    if not re.fullmatch(r'[A-Za-z]', name) or name == 'E':
        raise ParseError('variable must be a single letter (not E)')
    return sp.Symbol(name)


def _show(e):
    return {'text': sp.sstr(e), 'latex': sp.latex(e)}


# ---------------------------------------------------------------- comparison
if sp is not None:
    _POINTS = [sp.Rational(3, 2), sp.Rational(5, 7), sp.Integer(2), sp.Integer(3),
               sp.Rational(-7, 3), sp.Rational(11, 5), sp.Integer(5), sp.Rational(1, 3)]


def _sample(a, b, syms):
    """Compare at fixed test points, skipping points where either side is undefined."""
    good = 0
    for i in range(len(_POINTS)):
        sub = {s: _POINTS[(i + j * 3) % len(_POINTS)] for j, s in enumerate(syms)}
        try:
            va, vb = sp.N(a.subs(sub), 30), sp.N(b.subs(sub), 30)
        except Exception:
            continue
        bad = (sp.zoo, sp.nan, sp.oo, -sp.oo)
        if va.has(*bad) or vb.has(*bad):
            continue
        try:
            if abs(va - vb) > sp.Float('1e-20') * (1 + abs(va)):
                return 'different'
        except Exception:
            continue
        good += 1
    return 'equal' if good >= 3 else 'inconclusive'


def compare(a, b):
    """'proved' | 'numeric' (agrees at test points only) | 'different' | 'inconclusive'."""
    d = sp.simplify(a - b)
    if d == 0:
        return 'proved'
    syms = sorted(a.free_symbols | b.free_symbols, key=lambda s: s.name)
    if not syms:
        try:
            if abs(sp.N(d, 40)) < sp.Float('1e-30'):
                return 'numeric'
        except Exception:
            pass
        return 'different'
    try:
        z = d.equals(0)
    except Exception:
        z = None
    if z is True:
        return 'proved'
    s = _sample(a, b, syms)
    if s == 'different' or z is False:
        return 'different'
    return 'numeric' if s == 'equal' else 'inconclusive'


def _symbolic_outcome(kind, c, expected, extra_ok=''):
    if c == 'proved':
        return result(VERIFIED_CORRECT, kind, ('Proved equivalent. ' + extra_ok).strip(), expected=_show(expected))
    if c == 'numeric':
        return result(PARTIALLY_VERIFIED, kind,
                      'Agrees at all test points, but a full algebraic proof was not completed.',
                      expected=_show(expected))
    if c == 'different':
        return result(INCORRECT, kind, 'Not equivalent to the independently computed result.',
                      expected=_show(expected))
    return result(NEEDS_MANUAL_REVIEW, kind, 'Could not decide equivalence automatically.',
                  expected=_show(expected))


def _numeric_outcome(kind, exp, prop, raw):
    c = compare(exp, prop)
    if c == 'proved':
        return result(VERIFIED_CORRECT, kind, 'Matches the independently computed value.', expected=_show(exp))
    if c == 'numeric':
        return result(PARTIALLY_VERIFIED, kind, 'Equal to 30+ digits; exact proof not completed.',
                      expected=_show(exp))
    if '.' in str(raw):
        try:
            if numcompare.matches_rounded(float(sp.N(exp)), str(raw)):
                return result(PARTIALLY_VERIFIED, kind,
                              'Correct after rounding to the decimals given. Exact value is in details.',
                              expected=_show(exp))
        except (TypeError, ValueError):
            pass
    return result(INCORRECT, kind, 'Does not match the independently computed value.', expected=_show(exp))


# ---------------------------------------------------------------- handlers
def v_evaluate(req):
    _need(req, 'expression', 'proposed')
    exp = parse(req['expression'])
    if exp.free_symbols:
        return result(VERIFICATION_UNAVAILABLE, 'evaluate',
                      'Expression contains variables; use kind "equivalent" instead.')
    raw = str(req['proposed'])
    return _numeric_outcome('evaluate', exp, parse(raw), raw)


def v_probability(req):
    _need(req, 'expression', 'proposed')
    exp = parse(req['expression'])
    if exp.free_symbols:
        return result(VERIFICATION_UNAVAILABLE, 'probability', 'Probability expression must be a number.')
    if not (0 <= exp <= 1):
        return result(NEEDS_MANUAL_REVIEW, 'probability',
                      'The expression evaluates outside [0, 1], so it is not a valid probability.',
                      expected=_show(exp))
    raw = str(req['proposed'])
    prop = parse(raw)
    if prop.free_symbols or not (0 <= prop <= 1):
        return result(INCORRECT, 'probability', 'Proposed probability is outside [0, 1].', expected=_show(exp))
    return _numeric_outcome('probability', exp, prop, raw)


def v_equivalent(req):
    _need(req, 'expression', 'proposed')
    a, raw = parse(req['expression']), str(req['proposed'])
    b = parse(raw)
    if not (a.free_symbols or b.free_symbols):
        return _numeric_outcome('equivalent', a, b, raw)
    return _symbolic_outcome('equivalent', compare(a, b), a)


def _fully_factored(e):
    try:
        for f in sp.Mul.make_args(e):
            base, _ = f.as_base_exp()
            if base.is_number:
                continue
            facs = [(b, m) for b, m in sp.factor_list(base)[1] if not b.is_number]
            if len(facs) != 1 or facs[0][1] != 1:
                return False
        return True
    except Exception:
        return None


def v_factor(req):
    _need(req, 'expression', 'proposed')
    a, b = parse(req['expression']), parse(req['proposed'])
    c = compare(a, b)
    if c != 'proved':
        return _symbolic_outcome('factor', c, sp.factor(a))
    ff = _fully_factored(b)
    if ff is True:
        return result(VERIFIED_CORRECT, 'factor', 'Equivalent, and fully factored over the rationals.',
                      expected=_show(sp.factor(a)))
    if ff is False:
        return result(PARTIALLY_VERIFIED, 'factor',
                      'Equivalent to the original, but not fully factored.', expected=_show(sp.factor(a)))
    return result(PARTIALLY_VERIFIED, 'factor',
                  'Equivalent to the original; completeness of factoring could not be checked.',
                  expected=_show(sp.factor(a)))


def _split_eq(text):
    s = str(text)
    if s.count('=') != 1 or '==' in s:
        raise ParseError('an equation must contain exactly one "="')
    left, right = s.split('=')
    return parse(left), parse(right)


def _as_list(v):
    if isinstance(v, list):
        return v
    return [v]


def v_solve_equation(req):
    if 'equations' in req:
        return _v_system(req)
    _need(req, 'equation')
    if 'proposed' not in req:
        raise ParseError('missing field: proposed')
    left, right = _split_eq(req['equation'])
    f = left - right
    syms = sorted(f.free_symbols, key=lambda s: s.name)
    if req.get('variable'):
        var = _symbol(req['variable'])
    elif len(syms) == 1:
        var = syms[0]
    else:
        return result(VERIFICATION_UNAVAILABLE, 'solve_equation', 'Specify exactly one variable to solve for.')
    if var not in syms or [s for s in syms if s != var]:
        return result(VERIFICATION_UNAVAILABLE, 'solve_equation',
                      'Only equations in a single unknown are supported here (use "equations" for systems).')

    sol = sp.solveset(f, var, domain=sp.S.Reals)
    if sol == sp.S.EmptySet:
        roots = []
    elif isinstance(sol, sp.FiniteSet):
        roots = list(sol)
    else:
        return result(VERIFICATION_UNAVAILABLE, 'solve_equation',
                      'The solution set could not be computed as a finite set of real numbers.')

    proposed_raw = _as_list(req['proposed'])
    if len(proposed_raw) > 20:
        raise ParseError('too many proposed solutions')
    props = [parse(str(p)) for p in proposed_raw]

    used, extra = set(), []
    weak = False
    for raw, p in zip(proposed_raw, props):
        hit = None
        for i, root in enumerate(roots):
            if i in used:
                continue
            c = compare(root, p)
            if c == 'proved':
                hit = i
                break
            if c == 'numeric':
                hit, weak = i, True
                break
            if '.' in str(raw):
                try:
                    if numcompare.matches_rounded(float(sp.N(root)), str(raw)):
                        hit, weak = i, True
                        break
                except (TypeError, ValueError):
                    pass
        if hit is None:
            extra.append(p)
        else:
            used.add(hit)
    missing = [roots[i] for i in range(len(roots)) if i not in used]

    substitution = []
    for p in props:
        try:
            v = sp.simplify(f.subs(var, p))
            substitution.append({'value': sp.sstr(p), 'satisfies': bool(v == 0),
                                 'undefined': bool(v.has(sp.zoo, sp.nan))})
        except Exception:
            substitution.append({'value': sp.sstr(p), 'satisfies': False, 'undefined': True})

    details = dict(domain='real numbers',
                   expected=[_show(r) for r in roots],
                   missing=[sp.sstr(m) for m in missing],
                   extraneous=[sp.sstr(e) for e in extra],
                   substitution=substitution)
    if not missing and not extra:
        msg = 'The solution set matches.' if roots else 'Confirmed: no real solutions.'
        if weak:
            return result(PARTIALLY_VERIFIED, 'solve_equation',
                          msg + ' Some values match only after rounding.', **details)
        return result(VERIFIED_CORRECT, 'solve_equation', msg, **details)
    parts = []
    if missing:
        parts.append('missing solution(s)')
    if extra:
        parts.append('value(s) that are not solutions')
    return result(INCORRECT, 'solve_equation', 'Solution set differs: ' + ' and '.join(parts) + '.', **details)


def _v_system(req):
    eqs, names, proposed = req.get('equations'), req.get('variables'), req.get('proposed')
    if not (isinstance(eqs, list) and 2 <= len(eqs) <= 4):
        raise ParseError('equations must be a list of 2-4 equations')
    if not (isinstance(names, list) and len(names) == len(eqs)):
        raise ParseError('variables must list one name per equation')
    if not isinstance(proposed, list) or len(proposed) > 10:
        raise ParseError('proposed must be a list of solutions (objects)')
    symbols = [_symbol(n) for n in names]
    fs = []
    for e in eqs:
        left, right = _split_eq(e)
        fs.append(left - right)
    sols = sp.solve(fs, symbols, dict=True)
    if not isinstance(sols, list):
        return result(VERIFICATION_UNAVAILABLE, 'solve_equation', 'System could not be solved automatically.')
    for s in sols:
        if set(s.keys()) != set(symbols) or any(v.free_symbols for v in s.values()):
            return result(VERIFICATION_UNAVAILABLE, 'solve_equation',
                          'System has infinitely many solutions or is not fully determined.')
    sols = [s for s in sols if all(v.is_real is not False for v in s.values())]

    parsed = []
    for d in proposed:
        if not isinstance(d, dict) or set(d.keys()) != set(str(n) for n in names):
            raise ParseError('each proposed solution must give a value for every variable')
        parsed.append({sp.Symbol(k): parse(str(v)) for k, v in d.items()})

    used, extra = set(), 0
    for pd in parsed:
        hit = None
        for i, s in enumerate(sols):
            if i not in used and all(compare(s[k], pd[k]) == 'proved' for k in symbols):
                hit = i
                break
        if hit is None:
            extra += 1
        else:
            used.add(hit)
    missing = len(sols) - len(used)
    details = dict(domain='real numbers',
                   expected=[{str(k): _show(v) for k, v in s.items()} for s in sols])
    if not missing and not extra:
        return result(VERIFIED_CORRECT, 'solve_equation', 'The solution set of the system matches.', **details)
    return result(INCORRECT, 'solve_equation', 'The solution set of the system differs.',
                  missing=missing, extraneous=extra, **details)


def v_derivative(req):
    _need(req, 'expression', 'variable', 'proposed')
    var = _symbol(req['variable'])
    order = int(req.get('order', 1))
    if not 1 <= order <= 4:
        raise ParseError('order must be 1-4')
    exp = sp.diff(parse(req['expression']), var, order)
    return _symbolic_outcome('derivative', compare(exp, parse(req['proposed'])), exp)


def v_integral(req):
    _need(req, 'expression', 'variable', 'proposed')
    var = _symbol(req['variable'])
    f = parse(req['expression'])
    limits = req.get('limits')
    if limits:
        if not (isinstance(limits, list) and len(limits) == 2):
            raise ParseError('limits must be [lower, upper]')
        lo, hi = parse(limits[0]), parse(limits[1])
        value = sp.integrate(f, (var, lo, hi))
        if value.has(sp.Integral):
            return result(VERIFICATION_UNAVAILABLE, 'integral', 'The definite integral could not be evaluated.')
        raw = str(req['proposed'])
        return _numeric_outcome('integral', value, parse(raw), raw)
    F = parse(req['proposed'])
    d = sp.diff(F, var)
    return _symbolic_outcome('integral', compare(d, f), d,
                             'The derivative of the proposed antiderivative equals the integrand '
                             '(constant of integration is not checked).')


def _geometry_table():
    return {
        'rectangle': (('l', 'w'), {
            'area': lambda p: p['l'] * p['w'],
            'perimeter': lambda p: 2 * (p['l'] + p['w']),
            'diagonal': lambda p: sp.sqrt(p['l'] ** 2 + p['w'] ** 2)}),
        'square': (('s',), {
            'area': lambda p: p['s'] ** 2,
            'perimeter': lambda p: 4 * p['s'],
            'diagonal': lambda p: p['s'] * sp.sqrt(2)}),
        'triangle': (('b', 'h'), {'area': lambda p: p['b'] * p['h'] / 2}),
        'triangle_sss': (('a', 'b', 'c'), {
            'perimeter': lambda p: p['a'] + p['b'] + p['c'],
            'area': lambda p: sp.sqrt(((p['a'] + p['b'] + p['c']) / 2)
                                      * ((p['a'] + p['b'] + p['c']) / 2 - p['a'])
                                      * ((p['a'] + p['b'] + p['c']) / 2 - p['b'])
                                      * ((p['a'] + p['b'] + p['c']) / 2 - p['c']))}),
        'right_triangle': (('a', 'b'), {
            'hypotenuse': lambda p: sp.sqrt(p['a'] ** 2 + p['b'] ** 2),
            'area': lambda p: p['a'] * p['b'] / 2,
            'perimeter': lambda p: p['a'] + p['b'] + sp.sqrt(p['a'] ** 2 + p['b'] ** 2)}),
        'circle': (('r',), {
            'area': lambda p: sp.pi * p['r'] ** 2,
            'circumference': lambda p: 2 * sp.pi * p['r']}),
        'trapezium': (('a', 'b', 'h'), {'area': lambda p: (p['a'] + p['b']) * p['h'] / 2}),
        'parallelogram': (('b', 'h'), {'area': lambda p: p['b'] * p['h']}),
        'rhombus': (('d1', 'd2'), {'area': lambda p: p['d1'] * p['d2'] / 2}),
        'cube': (('s',), {
            'volume': lambda p: p['s'] ** 3,
            'surface_area': lambda p: 6 * p['s'] ** 2}),
        'cuboid': (('l', 'w', 'h'), {
            'volume': lambda p: p['l'] * p['w'] * p['h'],
            'surface_area': lambda p: 2 * (p['l'] * p['w'] + p['w'] * p['h'] + p['l'] * p['h'])}),
        'cylinder': (('r', 'h'), {
            'volume': lambda p: sp.pi * p['r'] ** 2 * p['h'],
            'curved_surface': lambda p: 2 * sp.pi * p['r'] * p['h'],
            'total_surface': lambda p: 2 * sp.pi * p['r'] * (p['r'] + p['h'])}),
        'cone': (('r', 'h'), {
            'volume': lambda p: sp.pi * p['r'] ** 2 * p['h'] / 3,
            'curved_surface': lambda p: sp.pi * p['r'] * sp.sqrt(p['r'] ** 2 + p['h'] ** 2),
            'total_surface': lambda p: sp.pi * p['r'] * (p['r'] + sp.sqrt(p['r'] ** 2 + p['h'] ** 2))}),
        'sphere': (('r',), {
            'volume': lambda p: sp.Rational(4, 3) * sp.pi * p['r'] ** 3,
            'surface_area': lambda p: 4 * sp.pi * p['r'] ** 2}),
    }


def v_geometry(req):
    _need(req, 'shape', 'quantity', 'params', 'proposed')
    table = _geometry_table()
    shape, quantity = str(req['shape']), str(req['quantity'])
    if shape not in table or quantity not in table[shape][1]:
        return result(VERIFICATION_UNAVAILABLE, 'geometry',
                      'This shape/quantity is not supported for automatic verification.')
    names, formulas = table[shape]
    raw_params = req['params']
    if not isinstance(raw_params, dict) or set(raw_params.keys()) != set(names):
        raise ParseError('params must be given for: ' + ', '.join(names))
    p = {}
    for n in names:
        v = parse(str(raw_params[n]))
        if not (v.is_number and v.is_positive):
            raise ParseError('geometry parameters must be positive numbers')
        p[n] = v
    if shape == 'triangle_sss':
        a, b, c = p['a'], p['b'], p['c']
        if a + b <= c or a + c <= b or b + c <= a:
            return result(NEEDS_MANUAL_REVIEW, 'geometry', 'These side lengths do not form a triangle.')
    exp = formulas[quantity](p)
    if req.get('pi'):
        pv = parse(str(req['pi']))
        if not pv.is_number:
            raise ParseError('pi must be a number such as 22/7 or 3.14')
        exp = exp.subs(sp.pi, pv)
    raw = str(req['proposed'])
    out = _numeric_outcome('geometry', sp.simplify(exp), parse(raw), raw)
    out['details'].update({'shape': shape, 'quantity': quantity})
    return out


def v_statistics(req):
    return stats.verify_stat(req)


HANDLERS = {
    'evaluate': v_evaluate, 'equivalent': v_equivalent, 'factor': v_factor,
    'solve_equation': v_solve_equation, 'derivative': v_derivative, 'integral': v_integral,
    'probability': v_probability, 'geometry': v_geometry, 'statistics': v_statistics,
}


def verify(req):
    if not isinstance(req, dict):
        return result(NEEDS_MANUAL_REVIEW, 'unknown', 'Request must be a JSON object.')
    kind = req.get('kind')
    if kind not in HANDLERS:
        return result(VERIFICATION_UNAVAILABLE, str(kind)[:30],
                      'This kind of problem is not supported for automatic verification. '
                      'Supported: ' + ', '.join(sorted(HANDLERS)))
    if kind != 'statistics' and sp is None:
        return result(VERIFICATION_UNAVAILABLE, kind, 'SymPy is not installed on the math service.')
    try:
        return HANDLERS[kind](req)
    except safety.UnsafeExpression as e:
        return result(NEEDS_MANUAL_REVIEW, kind, f'Expression rejected: {e}')
    except ParseError as e:
        return result(NEEDS_MANUAL_REVIEW, kind, str(e))
    except (RecursionError, MemoryError):
        return result(NEEDS_MANUAL_REVIEW, kind, 'Too complex to verify automatically.')
    except Exception:
        return result(NEEDS_MANUAL_REVIEW, kind, 'Could not verify automatically; please review manually.')
