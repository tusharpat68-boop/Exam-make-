import unittest

from mathsvc import verifier
from mathsvc.stats import verify_stat
from mathsvc.status import (VERIFIED_CORRECT, INCORRECT, PARTIALLY_VERIFIED,
                            VERIFICATION_UNAVAILABLE, NEEDS_MANUAL_REVIEW)


def stat(op, data, proposed, **kw):
    return verify_stat({'kind': 'statistics', 'op': op, 'data': data, 'proposed': proposed, **kw})['status']


class StatsTests(unittest.TestCase):
    def test_mean(self):
        self.assertEqual(stat('mean', [2, 4, 6, 8], '5'), VERIFIED_CORRECT)
        self.assertEqual(stat('mean', [2, 4, 6, 9], '5'), INCORRECT)
        self.assertEqual(stat('mean', [1, 2, 2], '1.67'), PARTIALLY_VERIFIED)   # 5/3 rounded
        self.assertEqual(stat('mean', [1, 2, 2], '5/3'), VERIFIED_CORRECT)

    def test_median_even_and_odd(self):
        self.assertEqual(stat('median', [3, 1, 2], '2'), VERIFIED_CORRECT)
        self.assertEqual(stat('median', [4, 1, 3, 2], '2.5'), VERIFIED_CORRECT)

    def test_mode(self):
        self.assertEqual(stat('mode', [1, 2, 2, 3], ['2']), VERIFIED_CORRECT)
        self.assertEqual(stat('mode', [1, 2, 3], 'none'), VERIFIED_CORRECT)
        self.assertEqual(stat('mode', [1, 1, 2, 2], ['1', '2']), VERIFIED_CORRECT)
        self.assertEqual(stat('mode', [1, 1, 2], ['2']), INCORRECT)

    def test_variance_and_stdev(self):
        self.assertEqual(stat('variance', [2, 4, 4, 4, 5, 5, 7, 9], '4'), VERIFIED_CORRECT)
        self.assertEqual(stat('stdev', [2, 4, 4, 4, 5, 5, 7, 9], '2'), VERIFIED_CORRECT)
        self.assertEqual(stat('variance', [1, 2, 3, 4], '1.25'), VERIFIED_CORRECT)           # population
        self.assertEqual(stat('variance', [1, 2, 3, 4], '5/3', sample=True), VERIFIED_CORRECT)
        self.assertEqual(stat('stdev', [1, 2, 3, 4], '1.12'), PARTIALLY_VERIFIED)

    def test_bad_input(self):
        self.assertEqual(stat('mean', [], '1'), NEEDS_MANUAL_REVIEW)
        self.assertEqual(stat('mean', ['abc'], '1'), NEEDS_MANUAL_REVIEW)
        self.assertEqual(stat('median_x', [1], '1'), NEEDS_MANUAL_REVIEW)

    def test_dispatcher_without_sympy(self):
        if verifier.sp is None:
            out = verifier.verify({'kind': 'evaluate', 'expression': '1+1', 'proposed': '2'})
            self.assertEqual(out['status'], VERIFICATION_UNAVAILABLE)
        out = verifier.verify({'kind': 'nonsense'})
        self.assertEqual(out['status'], VERIFICATION_UNAVAILABLE)
        out = verifier.verify([1])
        self.assertEqual(out['status'], NEEDS_MANUAL_REVIEW)


if __name__ == '__main__':
    unittest.main()
