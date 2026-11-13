import os
import sys
import unittest
from aiohttp import web
from aiohttp.test_utils import AioHTTPTestCase

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "bridge"))
import messages  # noqa: E402
import server  # noqa: E402
from tv import TVUnavailable  # noqa: E402


class BridgeMessageHelperTests(unittest.TestCase):
    def test_api_error_exposes_key_and_vars(self):
        err = server.ApiError(400, "unknown tv: foo", key="err_unknown_tv", vars={"tv": "foo"})
        self.assertEqual(err.status, 400)
        self.assertEqual(err.message, "unknown tv: foo")
        self.assertEqual(str(err), "unknown tv: foo")
        self.assertEqual(err.key, "err_unknown_tv")
        self.assertEqual(err.vars, {"tv": "foo"})

    def test_api_error_defaults_key_and_vars_to_none(self):
        err = server.ApiError(400, "bad request")
        self.assertIsNone(err.key)
        self.assertIsNone(err.vars)

    def test_tv_unavailable_exposes_key_and_vars(self):
        err = TVUnavailable("TV not connected", key="err_tv_not_connected")
        self.assertEqual(str(err), "TV not connected")
        self.assertEqual(err.key, "err_tv_not_connected")
        self.assertIsNone(err.vars)

        err_with_vars = TVUnavailable("not paired", key="err_not_paired", vars={"tv": "living"})
        self.assertEqual(err_with_vars.key, "err_not_paired")
        self.assertEqual(err_with_vars.vars, {"tv": "living"})

    def test_err_fields(self):
        err = server.ApiError(400, "unknown tv: foo", key="err_unknown_tv", vars={"tv": "foo"})
        self.assertEqual(
            messages.err_fields(err),
            {"error_key": "err_unknown_tv", "error_vars": {"tv": "foo"}},
        )

        err_no_vars = TVUnavailable("TV not connected", key="err_tv_not_connected")
        self.assertEqual(messages.err_fields(err_no_vars), {"error_key": "err_tv_not_connected"})

        err_empty_vars = server.ApiError(400, "x", key="err_x", vars={})
        self.assertEqual(messages.err_fields(err_empty_vars), {"error_key": "err_x"})

        plain = ValueError("plain error")
        self.assertEqual(messages.err_fields(plain), {})

    def test_note_fields(self):
        self.assertEqual(
            messages.note_fields("note_switched", {"mode": "cinema"}),
            {"note_key": "note_switched", "note_vars": {"mode": "cinema"}},
        )
        self.assertEqual(messages.note_fields("note_done"), {"note_key": "note_done"})
        self.assertEqual(messages.note_fields("note_done", {}), {"note_key": "note_done"})
        self.assertEqual(messages.note_fields(None), {})

    def test_with_key_attaches_key_and_vars(self):
        exc = messages.with_key(ValueError("bad input"), "err_bad_input", field="name")
        self.assertIsInstance(exc, ValueError)
        self.assertEqual(str(exc), "bad input")
        self.assertEqual(exc.key, "err_bad_input")
        self.assertEqual(exc.vars, {"field": "name"})

        exc_no_vars = messages.with_key(ValueError("missing"), "err_missing")
        self.assertEqual(exc_no_vars.key, "err_missing")
        self.assertIsNone(exc_no_vars.vars)


class MiddlewareMessageFieldsTests(AioHTTPTestCase):
    async def get_application(self):
        app = web.Application(middlewares=[server.middleware])

        async def api_err_with_key(_request):
            raise server.ApiError(400, "unknown tv: foo", key="err_unknown_tv", vars={"tv": "foo"})

        async def api_err_plain(_request):
            raise server.ApiError(400, "plain api error")

        async def tv_unavail(_request):
            raise TVUnavailable("TV not connected", key="err_tv_not_connected")

        async def value_err_with_key(_request):
            raise messages.with_key(ValueError("bad value"), "err_bad_value", field="x")

        async def value_err_plain(_request):
            raise ValueError("plain value error")

        app.router.add_get("/test/api-key", api_err_with_key)
        app.router.add_get("/test/api-plain", api_err_plain)
        app.router.add_get("/test/tv-unavail", tv_unavail)
        app.router.add_get("/test/val-key", value_err_with_key)
        app.router.add_get("/test/val-plain", value_err_plain)
        return app

    async def test_api_error_with_key_in_middleware(self):
        resp = await self.client.get("/test/api-key")
        self.assertEqual(resp.status, 400)
        data = await resp.json()
        self.assertEqual(
            data,
            {
                "ok": False,
                "error": "unknown tv: foo",
                "error_key": "err_unknown_tv",
                "error_vars": {"tv": "foo"},
            },
        )

    async def test_api_error_without_key_omits_error_key(self):
        resp = await self.client.get("/test/api-plain")
        self.assertEqual(resp.status, 400)
        data = await resp.json()
        self.assertEqual(data, {"ok": False, "error": "plain api error"})
        self.assertNotIn("error_key", data)
        self.assertNotIn("error_vars", data)

    async def test_tv_unavailable_with_key_in_middleware(self):
        resp = await self.client.get("/test/tv-unavail")
        self.assertEqual(resp.status, 503)
        data = await resp.json()
        self.assertEqual(
            data,
            {
                "ok": False,
                "error": "TV not connected",
                "error_key": "err_tv_not_connected",
            },
        )

    async def test_value_error_with_key_in_middleware(self):
        resp = await self.client.get("/test/val-key")
        self.assertEqual(resp.status, 400)
        data = await resp.json()
        self.assertEqual(
            data,
            {
                "ok": False,
                "error": "bad value",
                "error_key": "err_bad_value",
                "error_vars": {"field": "x"},
            },
        )

    async def test_value_error_without_key_omits_error_key(self):
        resp = await self.client.get("/test/val-plain")
        self.assertEqual(resp.status, 400)
        data = await resp.json()
        self.assertEqual(data, {"ok": False, "error": "plain value error"})


if __name__ == "__main__":
    unittest.main()
