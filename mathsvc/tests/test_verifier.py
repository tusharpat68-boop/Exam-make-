import unittest

from mathsvc import verifier
from mathsvc.status import (VERIFIED_CORRECT, INCORRECT, PARTIALLY_VERIFIED,
                            VERIFICATION_UNAVAILABLE, NEEDS_MANUAL_REVIEW)


def run(**req):
    return verifier.verify(req)


@unittest.skipIf(verifier.sp is None, 'SymPy not installed (pip install sympy)')
class SymPyTests(unittest.TestCase):
    def status(self, **req):
        return run(**req)['status']

    # arithmetic
    def test_arithmetic(self):
        self.assertEqual(self.status(kind='evaluate', expression='3/4 + 1/4', proposed='1'), VERIFIED_CORRECT)
        self.assertEqual(self.status(kind='evaluate', expression='3/4 + 1/4', proposed='2'), INCORRECT)
        self.assertEqual(self.status(kind='evaluate', expression='0.1 + 0.2', proposed='0.3'), VERIFIED_CORRECT)
        self.assertEqual(self.status(kind='evaluate', expression='1/3', proposed='0.33'), PARTIALLY_VERIFIED)
        self.assertEqual(self.status(kind='evaluate', expression='1/3', proposed='0.34'), INCORRECT)
        self.assertEqual(self.status(kind='evaluate', expression='sqrt(2)*sqrt(8)', proposed='4'), VERIFIED_CORRECT)
        self.assertEqual(self.status(kind='evaluate', expression='15% of 80', proposed='12'), NEEDS_MANUAL_REVIEW)
        self.assertEqual(self.status(kind='evaluate', expression='15/100*80', proposed='12'), VERIFIED_CORRECT)

    # algebra
    def test_equivalence_and_factor(self):
        self.assertEqual(self.status(kind='equivalent', expression='(a+b)^2', proposed='a^2+2ab+b^2'), VERIFIED_CORRECT)
        self.assertEqual(self.status(kind='equivalent', expression='(a+b)^2', proposed='a^2+b^2'), INCORRECT)
        self.assertEqual(self.status(kind='factor', expression='x^2-5x+6', proposed='(x-2)(x-3)'), VERIFIED_CORRECT)
        self.assertEqual(self.status(kind='factor', expression='x^2-1', proposed='(x-1)(x+1)'), VERIFIED_CORRECT)
        self.assertEqual(self.status(kind='factor', expression='x^4-1', proposed='(x^2-1)(x^2+1)'), PARTIALLY_VERIFIED)
        self.assertEqual(self.status(kind='factor', expression='x^2-5x+6', proposed='(x-2)(x+3)'), INCORRECT)

    def test_trig_identity(self):
        self.assertEqual(self.status(kind='equivalent', expression='sin(x)^2 + cos(x)^2', proposed='1'), VERIFIED_CORRECT)
        self.assertEqual(self.status(kind='equivalent', expression='sin(x)^2', proposed='cos(x)^2'), INCORRECT)
        self.assertEqual(self.status(kind='evaluate', expression='sind(30)', proposed='1/2'), VERIFIED_CORRECT)

    # equations
    def test_quadratic(self):
        self.assertEqual(self.status(kind='solve_equation', equation='x^2-5x+6=0', proposed=['2', '3']), VERIFIED_CORRECT)
        self.assertEqual(self.status(kind='solve_equation', equation='x^2-5x+6=0', proposed=['2']), INCORRECT)
        self.assertEqual(self.status(kind='solve_equation', equation='x^2-5x+6=0', proposed=['2', '3', '4']), INCORRECT)
        self.assertEqual(self.status(kind='solve_equation', equation='x^2-2=0', proposed=['1.41', '-1.41']), PARTIALLY_VERIFIED)
        self.assertEqual(self.status(kind='solve_equation', equation='x^2+1=0', proposed=[]), VERIFIED_CORRECT)

    def test_extraneous_root(self):
        # sqrt(x+2) = x has the single real solution x = 2; x = -1 is extraneous
        out = run(kind='solve_equation', equation='sqrt(x+2)=x', proposed=['2', '-1'])
        self.assertEqual(out['status'], INCORRECT)
        self.assertEqual(out['details']['extraneous'], ['-1'])

    def test_linear_and_system(self):
        self.assertEqual(self.status(kind='solve_equation', equation='2x+3=11', proposed=['4']), VERIFIED_CORRECT)
        self.assertEqual(self.status(kind='solve_equation', equations=['x+y=5', 'x-y=1'], variables=['x', 'y'],
                                     proposed=[{'x': '3', 'y': '2'}]), VERIFIED_CORRECT)
        self.assertEqual(self.status(kind='solve_equation', equations=['x+y=5', 'x-y=1'], variables=['x', 'y'],
                                     proposed=[{'x': '2', 'y': '3'}]), INCORRECT)

    # calculus
    def test_calculus(self):
        self.assertEqual(self.status(kind='derivative', expression='x^3', variable='x', proposed='3x^2'), VERIFIED_CORRECT)
        self.assertEqual(self.status(kind='derivative', expression='x^3', variable='x', proposed='2x^2'), INCORRECT)
        self.assertEqual(self.status(kind='integral', expression='2x', variable='x', proposed='x^2 + C'), VERIFIED_CORRECT)
        self.assertEqual(self.status(kind='integral', expression='2x', variable='x', proposed='x^3'), INCORRECT)
        self.assertEqual(self.status(kind='integral', expression='2x', variable='x', limits=['0', '3'], proposed='9'), VERIFIED_CORRECT)

    # geometry
    def test_geometry(self):
        self.assertEqual(self.status(kind='geometry', shape='rectangle', quantity='area',
                                     params={'l': '5', 'w': '3'}, proposed='15'), VERIFIED_CORRECT)
        self.assertEqual(self.status(kind='geometry', shape='circle', quantity='area',
                                     params={'r': '7'}, pi='22/7', proposed='154'), VERIFIED_CORRECT)
        self.assertEqual(self.status(kind='geometry', shape='circle', quantity='area',
                                     params={'r': '5'}, proposed='78.54'), PARTIALLY_VERIFIED)
        self.assertEqual(self.status(kind='geometry', shape='triangle_sss', quantity='area',
                                     params={'a': '3', 'b': '4', 'c': '5'}, proposed='6'), VERIFIED_CORRECT)
        self.assertEqual(self.status(kind='geometry', shape='triangle_sss', quantity='area',
                                     params={'a': '1', 'b': '2', 'c': '9'}, proposed='1'), NEEDS_MANUAL_REVIEW)
        self.assertEqual(self.status(kind='geometry', shape='dodecahedron', quantity='volume',
                                     params={'s': '1'}, proposed='1'), VERIFICATION_UNAVAILABLE)

    # probability
    def test_probability(self):
        self.assertEqual(self.status(kind='probability', expression='binomial(5,2)/binomial(10,2)',
                                     proposed='2/9'), VERIFIED_CORRECT)
        self.assertEqual(self.status(kind='probability', expression='1/6', proposed='1.5'), INCORRECT)
        self.assertEqual(self.status(kind='probability', expression='7/6', proposed='1'), NEEDS_MANUAL_REVIEW)

    # safety through the dispatcher
    def test_malicious_input_is_rejected(self):
        self.assertEqual(self.status(kind='evaluate', expression='__import__("os").system("id")', proposed='0'),
                         NEEDS_MANUAL_REVIEW)
        self.assertEqual(self.status(kind='evaluate', expression='9**9**9', proposed='0'), NEEDS_MANUAL_REVIEW)


if __name__ == '__main__':
    unittest.main()
