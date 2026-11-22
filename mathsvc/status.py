"""Shared status values and the timeout signal."""

VERIFIED_CORRECT = 'VERIFIED_CORRECT'
INCORRECT = 'INCORRECT'
PARTIALLY_VERIFIED = 'PARTIALLY_VERIFIED'
VERIFICATION_UNAVAILABLE = 'VERIFICATION_UNAVAILABLE'
NEEDS_MANUAL_REVIEW = 'NEEDS_MANUAL_REVIEW'


class ComputeTimeout(BaseException):
    """Raised by the server's alarm. BaseException so generic `except Exception` never swallows it."""


def result(status, kind, message, **details):
    return {'status': status, 'kind': kind, 'message': message, 'details': details}
