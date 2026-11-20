package dev.couchtv.ontv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Photos from the phone's Home settings page: made screen size on the TV, never bigger (Photos.kt). */
class PhotosTest {
    @Test fun landscapeFitsInside1920By1080() {
        assertEquals(1440 to 1080, Photos.fit(4032, 3024))   // 4:3 is limited by the height
        assertEquals(1920 to 1080, Photos.fit(3840, 2160))   // 16:9 fills it
        assertEquals(1920 to 823, Photos.fit(7000, 3000))    // a panorama by the width
    }

    @Test fun portraitFitsTheScreenTurned() {
        assertEquals(1080 to 1440, Photos.fit(3024, 4032))
    }

    @Test fun smallPhotosAreNeverMadeBigger() {
        assertEquals(800 to 600, Photos.fit(800, 600))
        assertEquals(0 to 0, Photos.fit(0, 600))
    }

    @Test fun hugePicturesAreRefusedBeforeDecoding() {
        assertTrue(Photos.tooManyPixels(20000, 20000))          // 400 MP, a crafted file could claim this
        assertTrue(Photos.tooManyPixels(65535, 65535))          // no Int overflow
        assertTrue(!Photos.tooManyPixels(8064, 6048))           // a 48 MP phone photo is fine
        assertTrue(!Photos.tooManyPixels(10000, 10000))         // exactly 100 MP is allowed
    }

    @Test fun decodeStepKeepsAtLeastTheTargetSize() {
        assertEquals(2, Photos.sampleSize(4032, 3024, 1440, 1080))
        assertEquals(1, Photos.sampleSize(1920, 1080, 1920, 1080))
        assertEquals(4, Photos.sampleSize(8000, 6000, 1440, 1080))
        val n = Photos.sampleSize(12000, 9000, 1440, 1080)
        assertTrue(12000 / n >= 1440 && 9000 / n >= 1080)
    }
}
