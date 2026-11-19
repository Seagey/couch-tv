package dev.couchtv.ontv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.InetAddress

/**
 * POST /api/calendar on the on-TV app (Ical.kt): the phone only install reads the bookings calendar
 * itself, and a paired phone can never use it to reach anything in the house. Also the guest's name
 * rule (Store.guestName), the same as athome.js guestFull.
 */
class IcalTest {
    private fun ip(vararg a: String): (String) -> List<InetAddress> = { _ -> a.map { InetAddress.getByName(it) } }

    @Test fun onlyHttpsLinksWithNoPassword() {
        assertEquals("https://example.com/cal.ics", Ical.checkUrl(" https://example.com/cal.ics "))
        assertEquals("https://example.com/c.ics", Ical.checkUrl("web" + "cals://example.com/c.ics"))
        assertNull(Ical.checkUrl("http://example.com/cal.ics"))
        assertNull(Ical.checkUrl("https://user:pw@example.com/cal.ics"))
        assertNull(Ical.checkUrl("https://example.com/a b.ics"))
        assertNull(Ical.checkUrl("file:///etc/hosts"))
        assertNull(Ical.checkUrl("https://example.com/" + "x".repeat(2100)))
        assertNull(Ical.checkUrl(null))
    }

    @Test fun neverAnAddressInTheHouse() {
        assertTrue(Ical.publicHost("cal.example", ip("93.184.216.34")))
        assertFalse(Ical.publicHost("x", ip("192.0.2.1".replace("192.0.2", "10.0.0"))))       // private
        assertFalse(Ical.publicHost("x", ip("127.0.0.1")))                                  // this TV
        assertFalse(Ical.publicHost("x", ip("169." + "254.1.1")))                                // link local
        assertFalse(Ical.publicHost("x", ip("100." + "64.0.1")))                                 // shared
        assertFalse(Ical.publicHost("x", ip("::1")))
        assertFalse(Ical.publicHost("x", ip("fd00::1")))                                    // unique local
        assertFalse(Ical.publicHost("x", ip("93.184.216.34", "172." + "16.0.9")))                // any one private
        assertFalse(Ical.publicHost("x") { throw java.net.UnknownHostException() })
    }

    @Test fun readRefusesBeforeConnecting() {
        assertEquals(Pair(false, "not a calendar link"), Ical.read("http://example.com/x.ics"))
        assertEquals(Pair(false, "that address is not on the internet"), Ical.read("https://router.example/x.ics", ip("127.0.0.1")))
    }

    @Test fun calendarWordsOnly() {
        assertTrue(Ical.isCalendar("BEGIN:VCALENDAR\r\nVERSION:2.0"))
        assertFalse(Ical.isCalendar("<html>sign in</html>"))
    }

    @Test fun guestNames() {
        assertEquals("the Nguyen family!", Store.guestName("  the   Nguyen family! "))
        assertEquals("José & María", Store.guestName("José & María"))
        assertEquals("", Store.guestName("Sarah https://evil.example"))
        assertEquals("", Store.guestName("sarah@example.com"))
        assertEquals("a b", Store.guestName("a\u0007b"))
        assertEquals(38, Store.guestName("x".repeat(60)).length)
        assertEquals("", Store.guestName(null))
    }
}
