"""Guest names from Airbnb booking emails (bridge/bookings.py, taken from guest-tv): the made-up emails in
tests/fixtures/bookings give Sarah and Priya, the cancelled booking is gone, the shop email is ignored,
and what the TV gets is first names, guest counts and arrival days only."""
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "bridge"))
import bookings  # noqa: E402


class BookingTest(unittest.TestCase):
    def setUp(self):
        self.inbox = bookings.INBOX
        bookings.INBOX = os.path.join(HERE, "fixtures", "bookings")

    def tearDown(self):
        bookings.INBOX = self.inbox

    def test_names_for_the_tv(self):
        found, errors = bookings.collect({}, {})
        self.assertEqual(errors, [])
        self.assertEqual(len(found), 4, "the shop email is not a booking")
        names = bookings.for_tv(found)
        self.assertEqual(names, [{"arrives": "11-02", "guest": "Sarah", "guests": 3}, {"arrives": "11-20", "guest": "Priya", "guests": 2}])
        for n in names:
            self.assertEqual(set(n), {"arrives", "guest", "guests"}, "no code, no surname, no email address")

    def test_reader_reads_at_most_every_fifteen_minutes(self):
        r = bookings.Reader({}, "")
        self.assertTrue(r.on(), "a saved email turns it on")
        first = r.read()
        bookings.INBOX = os.path.join(HERE, "no-such-folder")
        self.assertEqual(r.read(), first, "kept, not read again within 15 minutes")
        self.assertFalse(bookings.Reader({}, "").on(), "no emails and no mailbox: off")

    def test_cancel_by_code(self):
        a = {"kind": "confirmed", "guest": "Tom", "guests": 2, "code": "HMAAAA1111", "arrives": (12, 5), "date": ""}
        c = {"kind": "cancelled", "guest": "", "guests": 0, "code": "HMAAAA1111", "arrives": None, "date": ""}
        self.assertEqual(bookings.for_tv([a, c]), [])
        self.assertEqual(len(bookings.for_tv([a])), 1)


class MailboxTls(unittest.TestCase):
    def test_the_mail_servers_certificate_and_name_are_checked(self):
        import ssl
        from unittest.mock import patch
        seen = {}

        class Stop(Exception):
            pass

        def fake(host, port, **kw):
            seen.update(kw, host=host, port=port)
            raise Stop()
        with patch.object(bookings.imaplib, "IMAP4_SSL", fake):
            with self.assertRaises(Stop):
                bookings.from_imap({"host": "imap.example.com", "user": "u"}, "app-password")
        ctx = seen.get("ssl_context")
        self.assertIsInstance(ctx, ssl.SSLContext, "a context is always given (no unverified default)")
        self.assertTrue(ctx.check_hostname)
        self.assertEqual(ctx.verify_mode, ssl.CERT_REQUIRED)
        self.assertEqual((seen["host"], seen["port"]), ("imap.example.com", 993))


if __name__ == "__main__":
    unittest.main()
