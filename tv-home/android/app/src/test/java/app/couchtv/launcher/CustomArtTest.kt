package app.couchtv.launcher

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/** Your own app icons and banners: which file is taken, and that nothing outside the folders is. */
class CustomArtTest {
    @get:Rule val tmp = TemporaryFolder()

    private fun put(kind: String, name: String): File =
        File(tmp.root, kind).apply { mkdirs() }.let { File(it, name).apply { writeText("x") } }

    @Test fun anIconNamedAfterThePackageIsTaken() {
        val f = put("icons", "com.netflix.ninja.png")
        assertEquals(f, CustomArt.find(tmp.root, "icons", "com.netflix.ninja"))
    }

    @Test fun pngComesBeforeJpegAndWebp() {
        put("icons", "com.stremio.one.webp")
        put("icons", "com.stremio.one.jpg")
        val png = put("icons", "com.stremio.one.png")
        assertEquals(png, CustomArt.find(tmp.root, "icons", "com.stremio.one"))
    }

    @Test fun jpegAndWebpAreTakenToo() {
        val jpg = put("banners", "tv.standard.nebula.jpg")
        val webp = put("icons", "tv.standard.nebula.webp")
        assertEquals(jpg, CustomArt.find(tmp.root, "banners", "tv.standard.nebula"))
        assertEquals(webp, CustomArt.find(tmp.root, "icons", "tv.standard.nebula"))
    }

    @Test fun iconsAndBannersAreKeptApart() {
        put("banners", "com.netflix.ninja.png")
        assertNull(CustomArt.find(tmp.root, "icons", "com.netflix.ninja"))
    }

    @Test fun noPictureMeansTheAppsOwn() {
        assertNull(CustomArt.find(tmp.root, "icons", "com.netflix.ninja"))
        assertNull(CustomArt.find(null, "icons", "com.netflix.ninja"))
    }

    @Test fun onlyPackageNamesAndTheTwoFoldersAreRead() {
        put("icons", "secret.png")
        File(tmp.root, "secret.com.png").writeText("x")
        assertNull(CustomArt.find(tmp.root, "icons", "secret"))                  // not a package name
        assertNull(CustomArt.find(tmp.root, "icons", "../secret.com"))
        assertNull(CustomArt.find(tmp.root, "icons", "com.example/../../secret"))
        assertNull(CustomArt.find(tmp.root, "..", "secret.com"))
        assertNull(CustomArt.find(tmp.root, "photos", "com.netflix.ninja"))
        assertNull(CustomArt.find(tmp.root, "icons", ""))
    }

    @Test fun eachTypeGetsItsOwnMime() {
        assertEquals("image/png", CustomArt.mime(File("a.b.png")))
        assertEquals("image/jpeg", CustomArt.mime(File("a.b.JPG")))
        assertEquals("image/webp", CustomArt.mime(File("a.b.webp")))
    }
}
