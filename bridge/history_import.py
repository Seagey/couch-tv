"""Import your own watch-history downloads from bridge/data/inbox/.

Run by hand:  .venv/bin/python bridge/history_import.py
The bridge also checks the inbox every hour and after POST /api/import. Files that were read
move to data/inbox/done/. Nothing is sent anywhere; nothing signs in to anything.
"""
import importlib.util
import io
import json
import os
import shutil
import sys
import zipfile

import config
import messages
import store

HERE = os.path.dirname(os.path.abspath(__file__))
INBOX = os.path.join(store.DATA, "inbox")
DONE = os.path.join(INBOX, "done")


def _load(name):
    spec = importlib.util.spec_from_file_location(f"importer_{name}",
                                                  os.path.join(HERE, "import", f"{name}.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


netflix = _load("netflix")
youtube = _load("youtube")

def _people_words():
    words = {"both": "both", "shared": "both", "together": "both"}
    for p in config.PEOPLE:   # read now: people can be added from the phone while the bridge runs
        words[p["id"].lower()] = p["id"]
        words[p["name"].lower()] = p["id"]
    return words


def person_from(*names):
    """A person id / both from a file name, folder name or Netflix profile name, else None."""
    words = _people_words()
    for name in names:
        low = (name or "").lower()
        for word, who in words.items():
            if word in low:
                return who
    return None


def _read_text(data):
    for enc in ("utf-8-sig", "utf-16", "latin-1"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", "replace")


def parse_file(name, data, file_person):
    """One file (or zip member) -> (source, items). source None when it is not a history file."""
    base = os.path.basename(name).lower()
    if base.endswith(".csv"):
        text = _read_text(data)
        # Full-account files name the profile per row; an unrecognised profile (Kids, a guest)
        # stays unassigned rather than borrowing the file's person.
        items = netflix.parse(text, lambda profile: person_from(profile) if profile else file_person)
        return ("netflix", items) if items or "netflix" in base or "viewingactivity" in base \
            else (None, [])
    if "watch-history" in base or "watch history" in base or "watch_history" in base:
        text = _read_text(data)
        if base.endswith(".json"):
            return "youtube", youtube.parse_json(text, file_person)
        if base.endswith(".html"):
            return "youtube", youtube.parse_html(text, file_person)
    return None, []


def run(inbox=INBOX, move=True):
    """Import every file in the inbox. Returns a list of {file, source, rows, new}."""
    os.makedirs(inbox, exist_ok=True)
    report = []
    for root, dirs, files in os.walk(inbox):
        dirs[:] = [d for d in dirs if os.path.join(root, d) != DONE]
        for fname in sorted(files):
            if fname.startswith("."):
                continue
            path = os.path.join(root, fname)
            rel = os.path.relpath(path, inbox)
            file_person = person_from(rel)
            found = []
            try:
                if fname.lower().endswith(".zip"):
                    with zipfile.ZipFile(path) as z:
                        for member in z.namelist():
                            src, items = parse_file(member, z.read(member), file_person)
                            if src:
                                found.append((f"{rel}:{member}", src, items))
                else:
                    with open(path, "rb") as f:
                        src, items = parse_file(fname, f.read(), file_person)
                    if src:
                        found.append((rel, src, items))
            except Exception as e:
                report.append({"file": rel, "error": f"{type(e).__name__}: {e}"[:200]})
                continue
            if not found:
                report.append({"file": rel, "source": None, "rows": 0, "new": 0,
                               "note": "not a Netflix or YouTube history file, left in place",
                               **messages.note_fields("note_import_unrecognized")})
                continue
            for label, src, items in found:
                new = store.add_imported(items)
                people = sorted({str(i.get("who")) for i in items})
                report.append({"file": label, "source": src, "rows": len(items), "new": new,
                               "people": people})
            if move:
                dest = os.path.join(DONE, rel)
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                shutil.move(path, dest)
    return report


if __name__ == "__main__":
    move = "--keep" not in sys.argv
    print(json.dumps(run(move=move), indent=1))
