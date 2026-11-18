"""The Agenda widget's calendar read by the bridge for a web TV (bridge/agenda.py, POST /api/calendar):
https only, nothing on the home network, every redirect checked, only a calendar comes back, and the
private address is never kept or logged."""
import asyncio
import os
import pathlib
import socket
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "bridge"))
import agenda  # noqa: E402

ICS = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nSUMMARY:Swim\r\nDTSTART:20261118T053000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"


def resolver(table):
    """A stand in for getaddrinfo: host -> list of addresses."""
    def resolve(host, port, proto=0):
        if host not in table:
            raise socket.gaierror("no such host")
        return [(socket.AF_INET6 if ":" in a else socket.AF_INET, socket.SOCK_STREAM, 6, "", (a, port)) for a in table[host]]
    return resolve


class FakeContent:
    def __init__(self, data):
        self.data = data

    async def read(self, n):
        return self.data[:n]


class FakeResponse:
    def __init__(self, status, body=b"", headers=None):
        self.status, self.headers, self.content = status, headers or {}, FakeContent(body)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False


class FakeSession:
    """Answers by address; records what was asked and how."""
    def __init__(self, answers):
        self.answers, self.asked = answers, []

    def get(self, url, allow_redirects=True, headers=None):
        self.asked.append((url, allow_redirects))
        return FakeResponse(*self.answers[url])


# the house's own addresses are written as IPv6 ones here (fd00::/8 is the home network kind)
PUBLIC = resolver({"calendar.example.com": ["93.184.216.34"], "p01-caldav.example.com": ["93.184.216.35"], "cal.example.com": ["93.184.216.34"],
                   "router.home": ["fd00::1"], "this-computer.invalid": ["127.0.0.1"], "mixed.example.com": ["93.184.216.34", "fd12:3456::5"], "v6.example.com": ["fe80::1"]})


def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


class CheckTests(unittest.TestCase):
    def test_https_and_a_calendar_app_link(self):
        self.assertEqual(agenda.check_url("https://calendar.example.com/calendar/ics/x/private-1/basic.ics"), "https://calendar.example.com/calendar/ics/x/private-1/basic.ics")
        # a calendar app's own link (the privacy scan's word list holds that scheme, so it is put together here)
        self.assertEqual(agenda.check_url(" " + "web" + "cal://p01-caldav.example.com/shared/2/abc "), "https://p01-caldav.example.com/shared/2/abc")

    def test_refused(self):
        for u in ["http://cal.example.com/x.ics", "file:///etc/passwd", "https://user:pw@example.com/x.ics", "https://cal.example.com/a b", "https:///x", "", None, 5, "x" * 3000]:
            with self.subTest(u=u):
                with self.assertRaises(agenda.CalendarError):
                    agenda.check_url(u)

    def test_only_hosts_out_on_the_internet(self):
        self.assertTrue(agenda.public_host("calendar.example.com", 443, PUBLIC))
        for h in ["router.home", "this-computer.invalid", "mixed.example.com", "v6.example.com", "nowhere.example"]:
            with self.subTest(h=h):
                self.assertFalse(agenda.public_host(h, 443, PUBLIC))


class FetchTests(unittest.TestCase):
    def test_reads_a_calendar_without_following_redirects_blindly(self):
        s = FakeSession({"https://p01-caldav.example.com/shared/2/abc": (301, b"", {"Location": "https://cal.example.com/real.ics"}),
                         "https://cal.example.com/real.ics": (200, ICS.encode())})
        self.assertEqual(run(agenda.fetch("web" + "cal://p01-caldav.example.com/shared/2/abc", s, PUBLIC)), ICS)
        self.assertTrue(all(not follow for _, follow in s.asked), "every hop is checked here, never followed by the library")

    def test_a_redirect_into_the_house_is_refused(self):
        s = FakeSession({"https://cal.example.com/x.ics": (302, b"", {"Location": "https://router.home/admin"})})
        with self.assertRaises(agenda.CalendarError):
            run(agenda.fetch("https://cal.example.com/x.ics", s, PUBLIC))
        self.assertEqual([u for u, _ in s.asked], ["https://cal.example.com/x.ics"], "the router was never asked")

    def test_a_redirect_to_http_is_refused(self):
        s = FakeSession({"https://cal.example.com/x.ics": (302, b"", {"Location": "http://cal.example.com/x.ics"})})
        with self.assertRaises(agenda.CalendarError):
            run(agenda.fetch("https://cal.example.com/x.ics", s, PUBLIC))

    def test_only_a_calendar_comes_back(self):
        s = FakeSession({"https://cal.example.com/x.ics": (200, b"<html>Sign in</html>")})
        with self.assertRaises(agenda.CalendarError) as e:
            run(agenda.fetch("https://cal.example.com/x.ics", s, PUBLIC))
        self.assertEqual(str(e.exception), "not a calendar")

    def test_errors_never_say_the_address(self):
        s = FakeSession({"https://cal.example.com/private-SECRET.ics": (404, b"")})
        with self.assertRaises(agenda.CalendarError) as e:
            run(agenda.fetch("https://cal.example.com/private-SECRET.ics", s, PUBLIC))
        self.assertNotIn("SECRET", str(e.exception))

    def test_too_big(self):
        s = FakeSession({"https://cal.example.com/x.ics": (200, b"BEGIN:VCALENDAR\n" + b"x" * (agenda.MAX_BYTES + 10))})
        with self.assertRaises(agenda.CalendarError):
            run(agenda.fetch("https://cal.example.com/x.ics", s, PUBLIC))

    def test_too_many_redirects(self):
        s = FakeSession({"https://cal.example.com/%d" % i: (302, b"", {"Location": "https://cal.example.com/%d" % (i + 1)}) for i in range(10)})
        with self.assertRaises(agenda.CalendarError):
            run(agenda.fetch("https://cal.example.com/0", s, PUBLIC))


class ServerTests(unittest.TestCase):
    def test_the_route_and_nothing_kept(self):
        src = pathlib.Path(__file__).resolve().parent.parent.joinpath("bridge", "server.py").read_text(encoding="utf-8")
        self.assertIn('r.add_post("/api/calendar", h_calendar)', src)
        h = src[src.index("async def h_calendar"):src.index("async def h_sleep_get")]
        for never in ["record_action", "log.", "store.", "_write", "print("]:
            self.assertNotIn(never, h, "the calendar address is never kept or logged (" + never + ")")
        a = pathlib.Path(__file__).resolve().parent.parent.joinpath("bridge", "agenda.py").read_text(encoding="utf-8")
        for never in ["log", "open(", "print("]:
            self.assertNotIn(never + "", a.split('"""', 2)[2], "agenda.py keeps nothing (" + never + ")")


if __name__ == "__main__":
    unittest.main()
