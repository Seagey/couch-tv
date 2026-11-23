package dev.couchtv.ontv

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/** Weather for the home screen. Open-Meteo: free, no account, no key. At most every 30 minutes. */
object Weather {
    private val WMO = mapOf(0 to "Clear", 1 to "Mostly clear", 2 to "Partly cloudy", 3 to "Cloudy", 45 to "Fog", 48 to "Fog",
        51 to "Drizzle", 53 to "Drizzle", 55 to "Drizzle", 56 to "Drizzle", 57 to "Drizzle", 61 to "Light rain", 63 to "Rain",
        65 to "Heavy rain", 66 to "Rain", 67 to "Rain", 80 to "Showers", 81 to "Showers", 82 to "Heavy showers",
        95 to "Storms", 96 to "Storms", 99 to "Storms")
    @Volatile private var at = 0L
    @Volatile private var data: JSONObject? = null

    fun clear() { at = 0; data = null }

    @Synchronized fun get(): JSONObject? {
        if (data != null && System.currentTimeMillis() - at < 30 * 60_000) return JSONObject(data.toString())
        val w = Store.weather() ?: return null   // no town set yet: the home asks for one
        try {
            val url = "https://api.open-meteo.com/v1/forecast?latitude=${w.getDouble("lat")}&longitude=${w.getDouble("lon")}" +
                "&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min" +
                "&timezone=${URLEncoder.encode(w.optString("timezone", "UTC"), "UTF-8")}&forecast_days=1"
            val c = URL(url).openConnection() as HttpURLConnection
            c.connectTimeout = 6000; c.readTimeout = 8000
            val j = JSONObject(c.inputStream.bufferedReader().readText()); c.disconnect()
            val cur = j.getJSONObject("current"); val day = j.optJSONObject("daily")
            val code = cur.optInt("weather_code", -1)
            data = JSONObject().put("place", w.optString("place")).put("temp", Math.round(cur.getDouble("temperature_2m")))
                .put("code", code).put("text", WMO[code] ?: "").put("is_day", cur.optInt("is_day") == 1)
                .put("high", day?.optJSONArray("temperature_2m_max")?.optDouble(0)?.let { Math.round(it) } ?: JSONObject.NULL)
                .put("low", day?.optJSONArray("temperature_2m_min")?.optDouble(0)?.let { Math.round(it) } ?: JSONObject.NULL)
            at = System.currentTimeMillis()
        } catch (e: Exception) { android.util.Log.w("couchtv", "weather: ${e.message}") }
        return data?.let { JSONObject(it.toString()) }
    }
}
