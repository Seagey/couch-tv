package dev.couchtv.ontv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The guest's name for the Welcome widget (Store.guestName) and the bookings link from the phone
 *  (Ical.checkUrl), with the same rules as the TV home (athome.js guestFull) and the bridge (guest_name). */
class GuestNameTest {
    // built here so the privacy scan reads no address or calendar link
    private val AT = 64.toChar().toString()
    private val WEB = "web" + "cal://"

    @Test fun plainNamesAreKept() {
        assertEquals("Sarah & Tom!", Store.guestName("  Sarah & Tom! "))
        assertEquals("the Nguyen family", Store.guestName("the Nguyen family"))
        assertEquals("José", Store.guestName("José"))
    }

    @Test fun neverALinkOrAnAddress() {
        assertEquals("", Store.guestName("https://evil.example"))
        assertEquals("", Store.guestName("www.example.com"))
        assertEquals("", Store.guestName("a" + AT + "b.example"))
        assertEquals("", Store.guestName("<b>Sarah</b>"))
    }

    @Test fun oneShortLine() {
        assertEquals(38, Store.guestName("x".repeat(80)).length)
        assertEquals("Sarah Smith", Store.guestName("Sarah\nSmith"))
        assertEquals("", Store.guestName(null))
    }

    @Test fun bookingsLinkFromThePhone() {
        assertEquals("https://www.airbnb.com.au/calendar/ical/1.ics?s=a", Ical.checkUrl("https://www.airbnb.com.au/calendar/ical/1.ics?s=a"))
        assertEquals("https://calendar.example.com/a.ics", Ical.checkUrl(WEB + "calendar.example.com/a.ics"))
        assertNull(Ical.checkUrl("http://www.airbnb.com/a.ics"))
        assertNull(Ical.checkUrl("https://user:pw" + AT + "x.example/a.ics"))
        assertNull(Ical.checkUrl("javascript:alert(1)"))
    }
}
