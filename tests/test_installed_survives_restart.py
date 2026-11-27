"""The installed list survives a bridge restart. A bridge restarted while the TV was off (a power cut,
a deploy) could not ask the TV, so every catalogue app came back as "installed": null and the phone's
Watch tab showed all of them: Hulu, Peacock and Foxtel on a Samsung that had none (November 2026)."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

ROOT = Path(__file__).parents[1]
os.environ["COUCH_CONFIG"] = str(ROOT / "config.example.json")
os.environ["COUCH_DATA"] = tempfile.mkdtemp(prefix="couchtv-installed-")
sys.path.insert(0, str(ROOT / "bridge"))
import server  # noqa: E402

ON_THE_TV = {"com.netflix.ninja", "com.google.android.youtube.tv"}


class AfterARestart(unittest.IsolatedAsyncioTestCase):
    async def test_a_restart_with_the_tv_off_keeps_the_last_list(self):
        t = server.TVS[server.DEFAULT_TV]
        with patch.object(t, "installed_packages", AsyncMock(return_value=set(ON_THE_TV))):
            await server._refresh_installed()
        # A fresh bridge, as after a restart, whose TV does not answer.
        code = ("import json, server; t = server.TVS[server.DEFAULT_TV]; "
                "print(json.dumps(sorted(t.state['installed']['packages'] or [])))")
        # This module's data folder, as store has it: another test module imported first may have
        # set COUCH_DATA to its own folder before this one changed the variable.
        env = dict(os.environ, COUCH_DATA=server.store.DATA)
        out = subprocess.run([sys.executable, "-c", code], cwd=ROOT / "bridge", env=env,
                             capture_output=True, text=True, timeout=60, check=True).stdout
        self.assertEqual(json.loads(out.strip().splitlines()[-1]), sorted(ON_THE_TV))

    async def test_a_tv_that_cannot_be_asked_does_not_wipe_the_saved_list(self):
        t = server.TVS[server.DEFAULT_TV]
        with patch.object(t, "installed_packages", AsyncMock(return_value=set(ON_THE_TV))):
            await server._refresh_installed()
        with patch.object(t, "installed_packages", AsyncMock(return_value=None)):
            await server._refresh_installed()
        self.assertEqual(server.store.installed_packages(server.DEFAULT_TV), ON_THE_TV)


if __name__ == "__main__":
    unittest.main()
