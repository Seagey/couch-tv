"""couchtv://helper/on: the Couch TV account page's "Turn on extra features" link.

Studio side (documented here, Studio is not changed): the /account button is a plain link to
`couchtv://helper/on`. Mac and Windows register the couchtv:// scheme with this app already (Setup's
Info.plist and linkin.register_windows), so the link opens Couch TV Setup on its "Add extra features"
screen. Linux and any computer where the link does nothing: the page shows the steps and the same
"Add extra features" choice appears the next time Setup is opened.
"""
import urllib.parse

ACTIONS = ("on",)


def parse(url):
    """"on" for couchtv://helper/on (or couchtv-setup://helper/on), else None."""
    try:
        u = urllib.parse.urlsplit(str(url or "").strip())
    except ValueError:
        return None
    if u.scheme.lower() not in ("couchtv", "couchtv-setup") or u.netloc.lower() != "helper":
        return None
    action = u.path.strip("/").lower()
    return action if action in ACTIONS else None


def find(argv):
    for a in argv[1:]:
        if parse(a):
            return parse(a)
    return None
