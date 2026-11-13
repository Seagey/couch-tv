"""Structured message keys and interpolation vars for localized UI replies."""


def _fields(prefix, key, vars=None):
    if not key:
        return {}
    out = {f"{prefix}_key": key}
    if vars:
        out[f"{prefix}_vars"] = vars
    return out


def err_fields(exc):
    """Return error_key / error_vars fields for an exception if it carries a key."""
    return _fields("error", getattr(exc, "key", None), getattr(exc, "vars", None))


def note_fields(key, vars=None):
    """Return note_key / note_vars fields for a localized note."""
    return _fields("note", key, vars)


def error_fields(key, vars=None):
    """Return error_key / error_vars fields for a localized error."""
    return _fields("error", key, vars)


def with_key(exc, key, /, **vars):
    """Attach .key and .vars to an exception and return it."""
    exc.key = key
    exc.vars = vars or None
    return exc
