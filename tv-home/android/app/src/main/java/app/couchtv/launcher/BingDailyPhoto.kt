package app.couchtv.launcher

import android.graphics.BitmapFactory
import android.os.SystemClock
import android.util.AtomicFile
import android.util.Log
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.Executor

/** Keeps the last complete Bing US homepage photo, including when the TV starts offline. */
internal class BingDailyPhoto(private val folder: File, private val worker: Executor) {
    private val datePattern = Regex("[0-9]{8}")
    private val imagePattern = Regex("/th\\?id=OHR\\.[A-Za-z0-9_.-]+_1920x1080\\.jpg")
    private val marketDate = SimpleDateFormat("yyyyMMdd", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("America/Los_Angeles")
    }
    private var date = folder.list()?.filter { datePattern.matches(it) }?.maxOrNull().orEmpty()
    private var busy = false
    private var retryAt = 0L

    @Synchronized
    fun current(): String {
        val today = marketDate.format(Date())
        val now = SystemClock.elapsedRealtime()
        if (date == today || busy || now < retryAt) return date
        busy = true
        worker.execute(::refresh)
        return date
    }

    @Synchronized
    fun open(version: String): InputStream? =
        if (version == date && date.isNotEmpty()) runCatching { File(folder, date).inputStream() }.getOrNull()
        else null

    private fun refresh() {
        try {
            val archive = request("/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=en-US", 64 * 1024)
            val item = JSONObject(String(archive, Charsets.UTF_8)).getJSONArray("images").getJSONObject(0)
            val candidate = item.getString("startdate")
            val image = item.getString("urlbase") + "_1920x1080.jpg"
            if (!datePattern.matches(candidate) || !imagePattern.matches(image)) return
            if (synchronized(this) { candidate <= date }) return
            val bytes = request(image, 5 * 1024 * 1024)
            val info = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, info)
            if (info.outMimeType != "image/jpeg" || info.outWidth != 1920 || info.outHeight != 1080) return
            val sample = BitmapFactory.Options().apply { inSampleSize = 8 }
            val preview = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, sample) ?: return
            preview.recycle()

            folder.mkdirs()
            val file = AtomicFile(File(folder, candidate))
            val stream = file.startWrite()
            try {
                stream.write(bytes)
                file.finishWrite(stream)
            } catch (e: Exception) {
                file.failWrite(stream)
                throw e
            }
            synchronized(this) {
                date = candidate
                folder.listFiles()?.filter { it.name != date && datePattern.matches(it.name) }?.forEach { it.delete() }
            }
            Log.i("BingDailyPhoto", "Downloaded Bing photo for $candidate")
        } catch (e: Exception) {
            // Retain the last valid image. The next check retries after a temporary outage.
            Log.w("BingDailyPhoto", "Could not refresh the Bing photo: ${e.javaClass.simpleName}")
        } finally {
            synchronized(this) {
                retryAt = SystemClock.elapsedRealtime() + 5 * 60_000L
                busy = false
            }
        }
    }

    private fun request(path: String, limit: Int): ByteArray {
        val connection = URL("https://www.bing.com$path").openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 6_000
            connection.readTimeout = 6_000
            connection.useCaches = false
            connection.instanceFollowRedirects = false
            val status = connection.responseCode
            check(status == HttpURLConnection.HTTP_OK) { "Bing returned HTTP $status" }
            return connection.inputStream.use { input ->
                val buffer = ByteArray(8_192)
                val result = ByteArrayOutputStream()
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    require(result.size() + read <= limit)
                    result.write(buffer, 0, read)
                }
                result.toByteArray()
            }
        } finally {
            connection.disconnect()
        }
    }
}
