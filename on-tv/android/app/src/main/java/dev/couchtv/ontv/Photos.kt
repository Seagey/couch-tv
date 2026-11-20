package dev.couchtv.ontv

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.InputStream

/**
 * Your photos for the home's scenes, sent from a phone on the home Wi-Fi (the phone's Home settings
 * page, /setup). The phone sends the picture straight to this TV; it never goes to a couch-tv server
 * or anywhere else. Here it is turned the right way up, made no bigger than the screen (1920 by 1080),
 * saved as a JPEG in this app's own storage, and listed in Home settings' photos (ST.photos) as
 * {id, file}, the same shape the couch-tv home app's file picker uses. The home shows it from
 * http://tvos.invalid/photo/<file>, which HomeActivity answers from here.
 */
object Photos {
    const val MAX = 50                    // app.js MAX_PHOTOS
    const val MAX_UPLOAD = 25L * 1024 * 1024
    private const val W = 1920
    private const val H = 1080
    private val NAME = Regex("[a-z0-9]{6,40}\\.jpg")

    private fun dir(): File = File(Store.context().filesDir, "photos").apply { mkdirs() }

    /** The file for a name the page or the phone asks for, only ever inside the photos folder. */
    fun file(name: String): File? = name.takeIf { NAME.matches(it) }?.let { File(dir(), it) }?.takeIf { it.isFile }

    /** The width and height to scale (w, h) to so it fits inside the screen; never made bigger. */
    fun fit(w: Int, h: Int, maxW: Int = W, maxH: Int = H): Pair<Int, Int> {
        if (w <= 0 || h <= 0) return 0 to 0
        // a portrait photo fits the screen turned too, so it is not shrunk to 1080 wide
        val (mw, mh) = if (h > w) maxH to maxW else maxW to maxH
        val s = minOf(1.0, mw.toDouble() / w, mh.toDouble() / h)
        return maxOf(1, Math.round(w * s).toInt()) to maxOf(1, Math.round(h * s).toInt())
    }

    /** The decode step: the largest power of two that still leaves the picture at least the target size. */
    fun sampleSize(w: Int, h: Int, tw: Int, th: Int): Int {
        var n = 1
        while (w / (n * 2) >= tw && h / (n * 2) >= th) n *= 2
        return n
    }

    /**
     * Reads one picture from the phone (up to MAX_UPLOAD bytes), and keeps it. Returns {id, file},
     * or throws ApiError with words for the phone.
     */
    @Synchronized fun add(input: InputStream, length: Long): JSONObject {
        if (length <= 0) throw ApiError(400, "No photo came through. Try again.")
        if (length > MAX_UPLOAD) throw ApiError(413, "That photo is too big. Pick one under 25 MB.")
        if (count() >= MAX) throw ApiError(409, "The TV holds $MAX photos. Remove one first.")
        val tmp = File(dir(), "upload.tmp")
        try {
            tmp.outputStream().use { out ->
                val buf = ByteArray(64 * 1024); var left = length
                while (left > 0) {
                    val n = input.read(buf, 0, minOf(buf.size.toLong(), left).toInt())
                    if (n < 0) break
                    out.write(buf, 0, n); left -= n
                }
            }
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(tmp.path, bounds)
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw ApiError(415, "That is not a photo the TV can read. Send a JPEG or PNG.")
            // a picture far bigger than any camera's (a crafted PNG of a few KB can claim this) is refused before decoding
            if (tooManyPixels(bounds.outWidth, bounds.outHeight)) throw ApiError(413, "That photo is too big. Pick one under 100 megapixels.")
            val exif = runCatching { ExifInterface(tmp.path) }.getOrNull()
            val turn = when (exif?.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                ExifInterface.ORIENTATION_ROTATE_90 -> 90; ExifInterface.ORIENTATION_ROTATE_180 -> 180; ExifInterface.ORIENTATION_ROTATE_270 -> 270; else -> 0
            }
            val (sw, sh) = if (turn % 180 != 0) bounds.outHeight to bounds.outWidth else bounds.outWidth to bounds.outHeight
            val (tw, th) = fit(sw, sh)
            val opts = BitmapFactory.Options().apply {
                inSampleSize = if (turn % 180 != 0) sampleSize(bounds.outWidth, bounds.outHeight, th, tw) else sampleSize(bounds.outWidth, bounds.outHeight, tw, th)
                inPreferredConfig = Bitmap.Config.RGB_565   // a 1 GB TV: half the memory of ARGB
            }
            var bmp = BitmapFactory.decodeFile(tmp.path, opts) ?: throw ApiError(415, "That is not a photo the TV can read. Send a JPEG or PNG.")
            val m = Matrix()
            if (turn != 0) m.postRotate(turn.toFloat())
            val rw = if (turn % 180 != 0) bmp.height else bmp.width
            val rh = if (turn % 180 != 0) bmp.width else bmp.height
            m.postScale(tw.toFloat() / rw, th.toFloat() / rh)
            val out = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
            if (out !== bmp) bmp.recycle()
            bmp = out
            val id = java.lang.Long.toString(System.currentTimeMillis(), 36) + Integer.toString((Math.random() * 1296).toInt(), 36)
            val name = "phone$id.jpg"
            val f = File(dir(), name)
            f.outputStream().use { bmp.compress(Bitmap.CompressFormat.JPEG, 88, it) }
            bmp.recycle()
            // the day it was taken, for the On this day widget (athome.js exifDate reads it back)
            exif?.getAttribute(ExifInterface.TAG_DATETIME_ORIGINAL)?.let { taken ->
                runCatching { ExifInterface(f.path).apply { setAttribute(ExifInterface.TAG_DATETIME_ORIGINAL, taken); saveAttributes() } }
            }
            val p = JSONObject().put("id", id).put("file", name)
            try {
                Store.editHomeSettings { hs ->
                    val list = hs.optJSONArray("photos") ?: JSONArray()
                    if (list.length() >= MAX) throw ApiError(409, "The TV holds $MAX photos. Remove one first.")
                    hs.put("photos", list.put(p))
                }
            } catch (e: Exception) { f.delete(); throw e }
            return p
        } catch (e: OutOfMemoryError) {
            throw ApiError(413, "That photo is too big for this TV. Pick a smaller one.")
        } finally { tmp.delete(); dropStrays() }
    }

    /** Takes one photo off the home (by its id in ST.photos) and deletes the file if it came from a phone. */
    @Synchronized fun remove(id: String): Boolean {
        var gone: JSONObject? = null
        val list = (Store.readJson("home-settings.json") as? JSONObject)?.optJSONArray("photos") ?: return false
        if ((0 until list.length()).none { list.optJSONObject(it)?.optString("id") == id }) return false
        Store.editHomeSettings { hs ->
            val now = hs.optJSONArray("photos") ?: JSONArray()
            val keep = JSONArray()
            for (i in 0 until now.length()) { val p = now.optJSONObject(i) ?: continue; if (gone == null && p.optString("id") == id) gone = p else keep.put(p) }
            hs.put("photos", keep)
        }
        gone?.optString("file")?.takeIf { it.isNotEmpty() }?.let { delete(it) }
        return gone != null
    }

    /** More than 100 megapixels: refused. */
    fun tooManyPixels(w: Int, h: Int): Boolean = w.toLong() * h > 100_000_000L

    /**
     * Phone photos no longer in Home settings' list (taken off on the TV while its page had no way to
     * delete the file, or left by an upload that failed half way): deleted on each upload.
     */
    private fun dropStrays() = runCatching {
        // no settings file to read (gone, or half written): delete nothing
        val hs = Store.readJson("home-settings.json") as? JSONObject ?: return@runCatching
        val names = dir().listFiles()?.map { it.name }?.toSet() ?: return@runCatching
        val (delete, missing) = strays(hs.optJSONArray("photos") ?: JSONArray(), names)
        delete.forEach { File(dir(), it).delete() }
        // a phone photo listed with no file (a stale copy brought it back after it was removed) would
        // show as a blank scene: it comes off the list
        if (missing.isNotEmpty()) Store.editHomeSettings { s ->
            val now = s.optJSONArray("photos") ?: return@editHomeSettings
            val out = JSONArray()
            for (i in 0 until now.length()) { val p = now.optJSONObject(i) ?: continue; if (p.optString("id") !in missing) out.put(p) }
            s.put("photos", out)
        }
    }

    /**
     * From the photos list and the files in the photos folder: the phone photo files no entry lists (to
     * delete), and the ids of phone photo entries whose file is gone (to take off the list). Photos from
     * a web address or the home app's own picker (not "phone...jpg") are never touched.
     */
    fun strays(list: JSONArray, files: Set<String>): Pair<Set<String>, Set<String>> {
        val phone = { n: String -> n.startsWith("phone") && n.endsWith(".jpg") }
        val listed = HashSet<String>(); val missing = HashSet<String>()
        for (i in 0 until list.length()) {
            val p = list.optJSONObject(i) ?: continue
            val f = p.optString("file")
            if (f.isEmpty()) continue
            listed += f
            if (phone(f) && f !in files) missing += p.optString("id")
        }
        return files.filter { phone(it) && it !in listed }.toSet() to missing
    }

    /** Deletes a photo file the page has dropped (Home settings on the TV, Remove photo). */
    fun delete(name: String) { file(name)?.delete() }

    private fun count(): Int = (Store.readJson("home-settings.json") as? JSONObject)?.optJSONArray("photos")?.length() ?: 0
}
