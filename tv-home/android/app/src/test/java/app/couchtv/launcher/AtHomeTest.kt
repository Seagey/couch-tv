package app.couchtv.launcher

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** couch-tv Studio's home widgets: the day a photo was taken, and which calendar links are ever read. */
class AtHomeTest {
    @Test fun aPhotosDayGoesInItsName() {
        assertEquals("-t20231118", AtHome.takenNote("2023:11:18 07:12:44"))
        assertEquals("", AtHome.takenNote(null))
        assertEquals("", AtHome.takenNote("0000:00:00 00:00:00"))
        assertEquals("", AtHome.takenNote("2023:13:01 00:00:00"))
        // the name still passes the photo folder's own rule (MainActivity.photoFile)
        assertTrue(Regex("[A-Za-z0-9_-]{1,64}\\.jpg").matches("pmhx3k2l-4521" + AtHome.takenNote("2019:11:18 10:00:00") + ".jpg"))
    }

    @Test fun onlyAPlainHttpsCalendarLinkIsRead() {
        assertTrue(AtHome.calendarUrlOk("https://calendar.example.com/calendar/ics/x%2Fgroup/private-abc/basic.ics"))
        assertFalse(AtHome.calendarUrlOk("http://calendar.example.com/x.ics"))
        assertFalse(AtHome.calendarUrlOk("https://user:pw@example.com/x.ics"))
        assertFalse(AtHome.calendarUrlOk("file:///data/data/app.couchtv.launcher/shared_prefs/ha.xml"))
        assertFalse(AtHome.calendarUrlOk("https://calendar.example.com/a b.ics"))
        assertFalse(AtHome.calendarUrlOk("not a link"))
    }
}
