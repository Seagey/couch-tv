"""privacy-scan.sh: the git history pass skips pip hash lines in setup-app/requirements*.txt, as the working tree pass
does, so a full scan does not fail on a digest that happens to look like a phone number. Anything else still fails."""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).parents[1]
# built from pieces so this file itself holds no phone-like text: eight digits after 04 read as an Australian
# mobile number to the phone-au rule
DIGITS = "04" + "1234" + "5678"
HASH_LINE = "    --hash=sha256:" + DIGITS + "a" + "b" * 53 + " \\\n"


def git(repo, *args):
    subprocess.run(["git", "-C", str(repo), "-c", "user.name=t", "-c", "user.email=t@users.noreply.github.com", *args],
                   check=True, capture_output=True)


class HistoryScan(unittest.TestCase):
    def setUp(self):
        self.t = tempfile.TemporaryDirectory()
        self.r = Path(self.t.name)
        (self.r / "scripts").mkdir()
        shutil.copy(ROOT / "scripts/privacy-scan.sh", self.r / "scripts/privacy-scan.sh")
        (self.r / "setup-app").mkdir()
        git(self.r, "init", "-q")

    def tearDown(self):
        self.t.cleanup()

    def scan(self):
        env = dict(os.environ, PATH="/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin")
        p = subprocess.run(["bash", str(self.r / "scripts/privacy-scan.sh")], capture_output=True, text=True, env=env, timeout=120)
        return p.returncode, p.stdout + p.stderr

    def commit(self, path, text):
        (self.r / path).write_text(text)
        git(self.r, "add", "-A", "--", ".", ":!scripts")
        git(self.r, "commit", "-q", "-m", "c")

    def test_a_hash_line_in_the_requirements_history_is_not_a_finding(self):
        self.commit("setup-app/requirements.txt", "somepkg==1.0 \\\n" + HASH_LINE)
        self.commit("setup-app/requirements.txt", "somepkg==1.1 \\\n" + HASH_LINE.replace(DIGITS, "04" + "1234" + "5679"))
        rc, out = self.scan()
        self.assertNotIn("git history", out)
        self.assertIn("findings: 0", out, out)
        self.assertEqual(rc, 0, out)

    def test_the_same_digits_anywhere_else_in_the_history_still_fail(self):
        self.commit("notes.txt", HASH_LINE)
        rc, out = self.scan()
        self.assertIn("phone-au  git history", out)
        self.assertNotEqual(rc, 0)

    def test_a_real_finding_in_the_requirements_file_still_fails(self):
        self.commit("setup-app/requirements.txt", "somepkg==1.0 \\\n" + HASH_LINE + "# call " + DIGITS + "\n")
        rc, out = self.scan()
        self.assertIn("git history", out)
        self.assertNotEqual(rc, 0)


if __name__ == "__main__":
    unittest.main()
