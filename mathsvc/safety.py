"""Input safety for math expressions. Pure Python (no SymPy) so it can be tested anywhere.

Defence in depth: SymPy is never given text that has not passed this whitelist.
No eval/exec of user text happens outside SymPy's parser, and only names listed here can appear.
"""
import re


class UnsafeExpression(ValueError):
    pass


MAX_LEN = 200
MAX_DIGITS = 15
MAX_EXPONENT = 100
MAX_EXP_GROUP = 6      # characters allowed inside a parenthesised exponent
MAX_PARENS = 30

FUNCS = {
    'sqrt', 'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'asin', 'acos', 'atan',
    'sind', 'cosd', 'tand', 'log', 'ln', 'log10', 'exp', 'abs',
    'factorial', 'binomial', 'pi',
}

_ALLOWED_CHARS = re.compile(r'^[0-9A-Za-z_+\-*/^().,\s]*$')
_IDENT = re.compile(r'[A-Za-z_][A-Za-z0-9_]*')
_NUMBER = re.compile(r'\d+(?:\.\d+)?')


def _check_numbers(text):
    for m in _NUMBER.finditer(text):
        parts = m.group().split('.')
        if any(len(p) > MAX_DIGITS for p in parts):
            raise UnsafeExpression('number has too many digits')


def _check_exponents(s):
    """s uses '**'. Exponents must be small plain numbers, a single letter, or a short (...) group.
    Towers like 9**9**9 are rejected because they can freeze the service."""
    pos = 0
    while True:
        j = s.find('**', pos)
        if j == -1:
            return
        k = j + 2
        while k < len(s) and s[k] == ' ':
            k += 1
        if k < len(s) and s[k] in '+-':
            k += 1
            while k < len(s) and s[k] == ' ':
                k += 1
        if k >= len(s):
            raise UnsafeExpression('incomplete exponent')
        if s[k] == '(':
            depth, end = 0, None
            for idx in range(k, len(s)):
                if s[idx] == '(':
                    depth += 1
                elif s[idx] == ')':
                    depth -= 1
                    if depth == 0:
                        end = idx
                        break
            if end is None:
                raise UnsafeExpression('unbalanced parentheses')
            group = s[k + 1:end]
            if '**' in group or len(group) > MAX_EXP_GROUP:
                raise UnsafeExpression('exponent too complex')
            for n in _NUMBER.findall(group):
                if float(n) > MAX_EXPONENT:
                    raise UnsafeExpression('exponent too large')
            after = end + 1
        else:
            m = re.match(r'\d+(?:\.\d+)?', s[k:])
            if m:
                if float(m.group()) > MAX_EXPONENT:
                    raise UnsafeExpression('exponent too large')
                after = k + m.end()
            else:
                m = re.match(r'[A-Za-z](?![A-Za-z0-9_(])', s[k:])
                if not m:
                    raise UnsafeExpression('exponent must be a number, a letter, or a short (...) group')
                after = k + 1
        if s[after:].lstrip().startswith('**'):
            raise UnsafeExpression('stacked exponents are not allowed')
        pos = j + 2


def check_expression(text):
    """Validate and normalise (^ -> **). Raises UnsafeExpression."""
    if not isinstance(text, str):
        text = str(text)
    text = text.strip()
    if not text:
        raise UnsafeExpression('empty expression')
    if len(text) > MAX_LEN:
        raise UnsafeExpression('expression too long')
    if not _ALLOWED_CHARS.match(text):
        raise UnsafeExpression('expression contains characters that are not allowed')
    if '__' in text:
        raise UnsafeExpression('expression contains characters that are not allowed')
    if text.count('(') > MAX_PARENS:
        raise UnsafeExpression('expression too deeply nested')
    for name in _IDENT.findall(text):
        if name in FUNCS:
            continue
        if len(name) == 1 and name.isalpha():
            continue
        raise UnsafeExpression(f'unknown or unsupported name: {name[:20]}')
    _check_numbers(text)
    norm = text.replace('^', '**')
    _check_exponents(norm)
    return norm
