"""POST /api/quit-app (the TV home's tile menu, Quit app, #214): force stops one app over ADB, and only that."""
import asyncio
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

os.environ["COUCH_DATA"] = tempfile.mkdtemp(prefix="couchtv-quit-")
sys.path.insert(0, str(Path(__file__).parents[1] / "bridge"))
import agentic  # noqa: E402
from tv import UnsafeInput  # noqa: E402


class ApiError(Exception):
    def __init__(self, status, message, key=None, vars=None):
        super().__init__(message)
        self.status, self.key = status, key


class FakeTV:
    def __init__(self):
        self.lines = []

    async def adb(self, *args, **kw):
        self.lines.append(" ".join(args))
        return ""


def stub(body):
    tv = FakeTV()
    netflix = {"id": "netflix", "name": "Netflix", "package": "com.netflix.ninja"}

    async def read_body(request):
        return body

    return tv, SimpleNamespace(
        body=read_body, tv=tv, ApiError=ApiError, ok=lambda **kw: {"ok": True, **kw},
        record_action=lambda *a, **k: None, finder=SimpleNamespace(COUNTRY="AU"),
        apps=SimpleNamespace(BY_PACKAGE={"com.netflix.ninja": netflix}, BY_ID={"netflix": netflix},
                             APPS=[netflix], HOME_PACKAGES={"com.google.android.tvlauncher"}))


def quit_app(body):
    tv, server = stub(body)
    before = agentic.S
    agentic.S = server
    try:
        return tv, asyncio.run(agentic.h_quit_app(None))
    finally:
        agentic.S = before


class QuitApp(unittest.TestCase):
    def test_force_stops_the_app_by_package_or_by_name(self):
        for body in ({"package": "com.netflix.ninja"}, {"name": "Netflix"}):
            tv, out = quit_app(body)
            self.assertEqual(tv.lines, ["shell am force-stop com.netflix.ninja"], body)
            self.assertEqual(out["quit"], "Netflix")

    def test_an_app_the_bridge_does_not_list_still_quits(self):
        tv, out = quit_app({"package": "org.smarttube.stable"})
        self.assertEqual(tv.lines, ["shell am force-stop org.smarttube.stable"])
        self.assertEqual(out["quit"], "org.smarttube.stable")

    def test_the_home_and_couch_tv_stay(self):
        for pkg in ("com.google.android.tvlauncher", "app.couchtv.launcher", "com.android.vending"):
            with self.assertRaises(ApiError) as cm:
                quit_app({"package": pkg})
            self.assertEqual(cm.exception.status, 403, pkg)

    def test_nothing_runs_for_an_unknown_name(self):
        with self.assertRaises(ApiError) as cm:
            quit_app({"name": "no such thing"})
        self.assertEqual(cm.exception.status, 404)

    def test_an_unsafe_package_name_never_reaches_the_shell(self):
        tv, server = stub({"package": "com.x.y; reboot"})
        before = agentic.S
        agentic.S = server
        try:
            with self.assertRaises((ApiError, UnsafeInput)):
                asyncio.run(agentic.h_quit_app(None))
        finally:
            agentic.S = before
        self.assertEqual(tv.lines, [])


if __name__ == "__main__":
    unittest.main()
