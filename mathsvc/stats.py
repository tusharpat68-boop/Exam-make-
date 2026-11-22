"""Exact statistics with fractions (no SymPy needed)."""
import math
from collections import Counter
from fractions import Fraction

from . import numcompare
from .status import (VERIFIED_CORRECT, INCORRECT, PARTIALLY_VERIFIED,
                     NEEDS_MANUAL_REVIEW, result)

MAX_DATA = 1000
OPS = {'mean', 'median', 'mode', 'range', 'variance', 'stdev'}


def _num(raw):
    s = str(raw).strip()
    if not s or len(s) > 30:
        raise ValueError('bad number')
    try:
        return Fraction(s)
    except (ValueError, ZeroDivisionError):
        raise ValueError(f'not a number: {s[:20]}')


def _exact_sqrt(fr):
    n, d = fr.numerator, fr.denominator
    rn, rd = math.isqrt(n), math.isqrt(d)
    if rn * rn == n and rd * rd == d:
        return Fraction(rn, rd)
    return None


def compute(op, data, sample=False):
    """Returns (value, exact). value is a Fraction/float, or a list of Fractions for mode."""
    n = len(data)
    if n == 0:
        raise ValueError('no data')
    if op == 'mean':
        return sum(data) / n, True
    if op == 'median':
        s = sorted(data)
        mid = n // 2
        return (s[mid] if n % 2 else (s[mid - 1] + s[mid]) / 2), True
    if op == 'range':
        return max(data) - min(data), True
    if op == 'mode':
        counts = Counter(data)
        top = max(counts.values())
        if top == 1 and n > 1:
            return [], True
        return sorted(v for v, c in counts.items() if c == top), True
    if op in ('variance', 'stdev'):
        if sample and n < 2:
            raise ValueError('sample statistics need at least 2 values')
        m = sum(data) / n
        ss = sum((x - m) ** 2 for x in data)
        var = ss / (n - 1 if sample else n)
        if op == 'variance':
            return var, True
        root = _exact_sqrt(var)
        if root is not None:
            return root, True
        return math.sqrt(var), False
    raise ValueError('unsupported statistic')


def _fmt(v):
    if isinstance(v, list):
        return [str(x) for x in v]
    if isinstance(v, Fraction):
        return str(v) if v.denominator == 1 else f'{v} (= {float(v):.6g})'
    return f'{v:.10g}'


def verify_stat(req):
    kind = 'statistics'
    op = str(req.get('op', '')).lower()
    if op not in OPS:
        return result(NEEDS_MANUAL_REVIEW, kind, 'Unsupported statistic. Use: ' + ', '.join(sorted(OPS)))
    raw_data = req.get('data')
    if not isinstance(raw_data, list) or not raw_data or len(raw_data) > MAX_DATA:
        return result(NEEDS_MANUAL_REVIEW, kind, 'data must be a list of 1-1000 numbers')
    if 'proposed' not in req:
        return result(NEEDS_MANUAL_REVIEW, kind, 'missing field: proposed')
    try:
        data = [_num(x) for x in raw_data]
        value, exact = compute(op, data, bool(req.get('sample', False)))
    except ValueError as e:
        return result(NEEDS_MANUAL_REVIEW, kind, str(e))

    proposed = req['proposed']
    note = 'sample' if req.get('sample') else 'population'
    details = {'expected': _fmt(value), 'basis': note if op in ('variance', 'stdev') else None}

    if op == 'mode':
        items = proposed if isinstance(proposed, list) else [proposed]
        items = [x for x in items if str(x).strip().lower() not in ('', 'none', 'no mode')]
        try:
            got = sorted(_num(x) for x in items)
        except ValueError as e:
            return result(NEEDS_MANUAL_REVIEW, kind, str(e), **details)
        if got == value:
            return result(VERIFIED_CORRECT, kind, 'Mode matches the independently computed value.', **details)
        return result(INCORRECT, kind, 'Mode does not match.', **details)

    raw = str(proposed).strip()
    try:
        prop = _num(raw)
    except ValueError as e:
        return result(NEEDS_MANUAL_REVIEW, kind, str(e), **details)
    if exact and prop == value:
        return result(VERIFIED_CORRECT, kind, 'Matches the independently computed value.', **details)
    if numcompare.matches_rounded(float(value), raw):
        return result(PARTIALLY_VERIFIED, kind,
                      'Correct after rounding to the number of decimals given. Exact value shown in details.', **details)
    return result(INCORRECT, kind, 'Does not match the independently computed value.', **details)
