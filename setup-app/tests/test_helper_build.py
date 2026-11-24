"""The helper's PyInstaller build can not see into bridge/ (it is added as data), so every standard library module
only the bridge imports must be a --hidden-import in .github/workflows/setup-app.yml. The first CI build of the helper
missed imaplib and the built app's bridge crashed at start. This keeps the list whole when the bridge changes."""
import ast
import re
import sys
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]


def imported(root):
    names = set()
    for f in Path(root).rglob("*.py"):
        try:
            tree = ast.parse(f.read_text(encoding="utf-8"))
        except (SyntaxError, UnicodeDecodeError):
            continue
        for n in ast.walk(tree):
            if isinstance(n, ast.Import):
                names.update(a.name for a in n.names)
            elif isinstance(n, ast.ImportFrom) and n.level == 0 and n.module:
                names.add(n.module)
    return {m for m in names if m.split(".")[0] in sys.stdlib_module_names}


class HelperBuild(unittest.TestCase):
    @unittest.skipUnless((REPO / "bridge").is_dir() and (REPO / ".github/workflows/setup-app.yml").is_file(), "not in the repo")
    def test_every_standard_module_only_the_bridge_uses_is_a_hidden_import(self):
        flow = (REPO / ".github/workflows/setup-app.yml").read_text(encoding="utf-8")
        listed = set(re.search(r"for m in (imaplib [^;]+); do HELPER=\"\$HELPER --hidden-import", flow).group(1).split())
        setup_uses = {m.split(".")[0] for m in imported(REPO / "setup-app/couchtv_setup")} | {m for m in imported(REPO / "setup-app/couchtv_setup")}
        missing = sorted(m for m in imported(REPO / "bridge")
                         if m not in listed and m not in setup_uses and m.split(".")[0] not in setup_uses)
        self.assertEqual(missing, [], "add these to the helper's --hidden-import list in setup-app.yml")


if __name__ == "__main__":
    unittest.main()
