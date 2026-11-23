package dev.couchtv.ontv

import dev.couchtv.ontv.matter.MatterSupport
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MatterSupportTest {
    @Test fun android6NeverLoads() {
        // the library imports getifaddrs/freeifaddrs (Android 7, API 24): Android 6 must not load it, even with the file there
        assertEquals("Matter needs Android 7 or newer on this TV.", MatterSupport.check(23, true))
        assertEquals("Matter needs Android 7 or newer on this TV.", MatterSupport.check(23, false))
        assertEquals(MatterSupport.NOTE_OLD_ANDROID, MatterSupport.check(21, true))
    }

    @Test fun intelTvHasNoLibrary() {
        assertEquals(MatterSupport.NOTE_PROCESSOR, MatterSupport.check(24, false))
        assertEquals(MatterSupport.NOTE_PROCESSOR, MatterSupport.check(34, false))
    }

    @Test fun armAndroid7AndNewerCanRun() {
        assertNull(MatterSupport.check(24, true))
        assertNull(MatterSupport.check(30, true))
        assertNull(MatterSupport.check(34, true))
    }

    @Test fun reasonKeyForTheScreens() {
        assertEquals("android_old", MatterSupport.reason(MatterSupport.check(23, true)))
        assertEquals("processor", MatterSupport.reason(MatterSupport.check(34, false)))
        assertNull(MatterSupport.reason(MatterSupport.check(34, true)))
    }

    @Test fun readyIsNeverTrueWhereMatterCannotRun() {
        // before: ready || (nodes.isEmpty() && note == null) said ready on an Intel or Android 6 TV with nothing added
        assertFalse(MatterSupport.ready(MatterSupport.NOTE_OLD_ANDROID, false, true, null))
        assertFalse(MatterSupport.ready(MatterSupport.NOTE_PROCESSOR, false, true, null))
        assertFalse(MatterSupport.ready(MatterSupport.NOTE_PROCESSOR, true, false, null))
        // where it can run: nothing added yet is ready, started is ready, a start failure is not
        assertTrue(MatterSupport.ready(null, false, true, null))
        assertTrue(MatterSupport.ready(null, true, false, null))
        assertFalse(MatterSupport.ready(null, false, true, "Matter could not start on this TV."))
        assertFalse(MatterSupport.ready(null, false, false, null))
    }
}
