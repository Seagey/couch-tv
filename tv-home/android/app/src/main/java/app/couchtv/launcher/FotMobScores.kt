package app.couchtv.launcher

import android.os.SystemClock
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executor

/** Read today's FotMob matches off the WebView thread, retaining the last good result. */
internal class FotMobScores(private val worker: Executor) {
    private var answer = """{"state":"loading"}"""
    private var busy = false
    private var nextAttempt = 0L

    @Synchronized
    fun current(): String {
        if (!busy && SystemClock.elapsedRealtime() >= nextAttempt) {
            busy = true
            worker.execute(::refresh)
        }
        return answer
    }

    private fun refresh() {
        var connection: HttpURLConnection? = null
        try {
            connection = URL("https://www.fotmob.com/api/data/matches").openConnection() as HttpURLConnection
            connection.connectTimeout = 8000
            connection.readTimeout = 10000
            connection.setRequestProperty("User-Agent", "Mozilla/5.0")
            check(connection.responseCode == 200)
            val text = connection.inputStream.bufferedReader().use { it.readText() }
            check(text.length <= 4_000_000)
            val json = JSONObject(text)
            check(json.optJSONArray("leagues") != null)
            synchronized(this) { answer = json.put("state", "ok").toString() }
        } catch (_: Exception) {
            synchronized(this) {
                if (answer.contains("\"loading\"")) answer = """{"state":"error"}"""
            }
        } finally {
            connection?.disconnect()
            synchronized(this) {
                nextAttempt = SystemClock.elapsedRealtime() + 60_000L
                busy = false
            }
        }
    }
}
