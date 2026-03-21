"""
Session class using contextvars to isolate session state per WebSocket connection.
"""
from contextvars import ContextVar

_session_data: ContextVar[dict] = ContextVar("_session_data", default={})

class Session:

    @classmethod
    def set(cls, **kwargs):
        current = _session_data.get().copy()
        current.update(kwargs)
        _session_data.set(current)

    @classmethod
    def get(cls, key):
        return _session_data.get().get(key)

    @classmethod
    def delete(cls, key):
        current = _session_data.get().copy()
        current.pop(key, None)
        _session_data.set(current)

    @classmethod
    def clear(cls):
        _session_data.set({})
