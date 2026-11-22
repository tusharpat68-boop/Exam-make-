import unittest

from mathsvc import safety


class SafetyTests(unittest.TestCase):
    def ok(self, s):
        return safety.check_expression(s)

    def bad(self, s):
        with self.assertRaises(safety.UnsafeExpression):
            safety.check_expression(s)

    def test_accepts_normal_math(self):
        self.assertEqual(self.ok('x^2 - 5x + 6'), 'x** 2 - 5x + 6'.replace('** 2', '**2'))
        self.ok('sqrt(2)*sqrt(8)')
        self.ok('(a+b)^2')
        self.ok('sin(30)')
        self.ok('binomial(10,2)/binomial(20,2)')
        self.ok('0.1 + 0.2')

    def test_blocks_code_injection(self):
        self.bad('__import__("os").system("ls")')
        self.bad('open("/etc/passwd")')
        self.bad('x.__class__')
        self.bad('lambda: 1')
        self.bad('exec("1")')
        self.bad('import os')
        self.bad('x; y')
        self.bad("x'")
        self.bad('[1,2]')

    def test_blocks_unknown_names(self):
        self.bad('foo(2)')
        self.bad('xy + 1')

    def test_blocks_resource_bombs(self):
        self.bad('9**9**9')
        self.bad('9^9^9')
        self.bad('2**1000')
        self.bad('x**(99*99*99)')
        self.bad('2**sin(x)')
        self.bad('1' * 40)
        self.bad('x' * 300)
        self.bad('(' * 40 + ')' * 40)

    def test_allows_small_exponents(self):
        self.ok('2**10')
        self.ok('x**(1/2)')
        self.ok('x^2')
        self.ok('x^-1')

    def test_rejects_empty_and_equals(self):
        self.bad('')
        self.bad('x = 2')


if __name__ == '__main__':
    unittest.main()
