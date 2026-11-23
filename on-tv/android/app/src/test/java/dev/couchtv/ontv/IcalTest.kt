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

    @Test fun connectsToTheAddressItCheckedAndLooksUpOnce() {
        // Fable review of 0.13.3: the name was checked, then looked up again on connect. A name that
        // answers an internet address first and an address in the house second must not reach the house.
        var lookups = 0
        val rebinding: (String) -> List<InetAddress> = { _ ->
            lookups++
            listOf(InetAddress.getByName(if (lookups == 1) "93.184.216.34" else "192.0.2.1".replace("192.0.2", "10.0.0")))
        }
        val dialled = mutableListOf<String>()
        val got = Ical.read("https://cal.example/x.ics", rebinding, Ical.Fetch { u, at ->
            dialled += "${u.host}@${at.hostAddress}"
            Ical.Answer(200, null, "BEGIN:VCALENDAR\r\nEND:VCALENDAR".toByteArray())
        })
        assertTrue(got.first)
        assertEquals(listOf("cal.example@93.184.216.34"), dialled)
        assertEquals(1, lookups)
    }

    @Test fun triesEachCheckedAddressInOrder() {
        // Fable review of 0.13.4: only the first address was dialled, so a dead first address (an IPv6
        // one on a TV with no IPv6) lost the calendar. Each checked address is tried in turn, no others.
        val dialled = mutableListOf<String>()
        val got = Ical.read("https://cal.example/x.ics", ip("2001:db8::1", "93.184.216.34", "93.184.216.35"), Ical.Fetch { _, at ->
            dialled += at.hostAddress!!
            if (at.hostAddress!!.contains(":")) throw java.net.ConnectException("no route")
            Ical.Answer(200, null, "BEGIN:VCALENDAR".toByteArray())
        })
        assertTrue(got.first)
        assertEquals(2, dialled.size)
        assertEquals("93.184.216.34", dialled[1])
        val none = Ical.read("https://cal.example/x.ics", ip("93.184.216.34", "93.184.216.35"), Ical.Fetch { _, _ -> throw java.io.IOException("down") })
        assertEquals(Pair(false, "unreachable"), none)
    }

    @Test fun aRedirectIsCheckedAndPinnedAgain() {
        val dns = mapOf("a.example" to "93.184.216.34", "b.example" to "93.184.216.35", "home.example" to ("172." + "16.0.9"))
        val resolve: (String) -> List<InetAddress> = { h -> listOf(InetAddress.getByName(dns.getValue(h))) }
        val dialled = mutableListOf<String>()
        val fetch = Ical.Fetch { u, at ->
            dialled += at.hostAddress!!
            when (u.host) {
                "a.example" -> Ical.Answer(302, "https://b.example/c.ics", null)
                else -> Ical.Answer(200, null, "BEGIN:VCALENDAR".toByteArray())
            }
        }
        assertTrue(Ical.read("https://a.example/x.ics", resolve, fetch).first)
        assertEquals(listOf("93.184.216.34", "93.184.216.35"), dialled)
        val toHouse = Ical.Fetch { _, _ -> Ical.Answer(302, "https://home.example/", null) }
        assertEquals(Pair(false, "that address is not on the internet"), Ical.read("https://a.example/x.ics", resolve, toHouse))
        val plainHttp = Ical.Fetch { _, _ -> Ical.Answer(301, "http://b.example/c.ics", null) }
        assertEquals(Pair(false, "not a calendar link"), Ical.read("https://a.example/x.ics", resolve, plainHttp))
    }

    @Test fun answersAreReadPlainOrChunkedAndCapped() {
        fun parse(s: String) = Ical.parseAnswer(s.toByteArray(Charsets.ISO_8859_1).inputStream())
        val plain = parse("HTTP/1.0 200 OK\r\nContent-Type: text/calendar\r\n\r\nBEGIN:VCALENDAR\r\n")
        assertEquals(200, plain.code)
        assertEquals("BEGIN:VCALENDAR\r\n", String(plain.body!!))
        val moved = parse("HTTP/1.1 302 Found\r\nLocation: https://b.example/c.ics\r\n\r\n")
        assertEquals(302, moved.code)
        assertEquals("https://b.example/c.ics", moved.location)
        val chunked = parse("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n6\r\nBEGIN:\r\n9\r\nVCALENDAR\r\n0\r\n\r\n")
        assertEquals("BEGIN:VCALENDAR", String(chunked.body!!))
        val big = Ical.parseAnswer(("HTTP/1.0 200 OK\r\n\r\n").toByteArray().inputStream().let { head ->
            java.io.SequenceInputStream(head, java.io.ByteArrayInputStream(ByteArray(5 * 1024 * 1024)))
        })
        assertNull(big.body)
        assertEquals(Pair(false, "too big"), Ical.read("https://a.example/x.ics", ip("93.184.216.34")) { _, _ -> big })
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
