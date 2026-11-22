"""Comparing a proposed decimal answer with an exact value. Pure Python."""
from decimal import Decimal, InvalidOperation


def decimal_places(raw):
    s = str(raw).strip()
    if '/' in s or '.' not in s:
        return None
    try:
        Decimal(s)
    except InvalidOperation:
        return None
    frac = s.split('.')[1]
    return len(frac) if frac.isdigit() else None


def matches_rounded(expected, raw):
    """True if `raw` equals `expected` rounded to the number of decimals written in `raw`."""
    p = decimal_places(raw)
    if p is None:
        return False
    try:
        return abs(float(expected) - float(Decimal(str(raw).strip()))) <= 0.5 * 10 ** (-p) + 1e-12
    except (InvalidOperation, ValueError, OverflowError):
        return False
