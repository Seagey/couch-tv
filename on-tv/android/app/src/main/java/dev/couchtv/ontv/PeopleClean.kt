package dev.couchtv.ontv

import org.json.JSONArray
import org.json.JSONObject

/**
 * The people list as the home hands it over (POST /api/people), kept tidy: up to 12, each with an id and a
 * name (40 characters at most). Beside those only what the home's own People list uses survives: a colour
 * (#rrggbb), the kid and guest flags, and src "account" for a person sent from a Couch TV Studio account
 * (Your home, tv-home/web/design-code.js mergeHome). Without the mark and the kid flag a round trip through
 * here made an account person look like one added on the TV. Photos never come here: they stay in the
 * home's own page storage (tvhome.home.account), so this store and the phone page never hold them.
 */
object PeopleClean {
    const val MAX = 12
    private val COLOUR = Regex("^#[0-9a-fA-F]{6}$")

    fun clean(list: JSONArray): JSONArray {
        val out = JSONArray()
        for (i in 0 until minOf(list.length(), MAX)) {
            val p = list.optJSONObject(i) ?: continue
            val name = p.optString("name").trim().take(40)
            if (name.isEmpty()) continue
            val o = JSONObject().put("id", p.optString("id").ifEmpty { "person${i + 1}" }.take(32)).put("name", name)
            val colour = p.optString("colour")
            if (COLOUR.matches(colour)) o.put("colour", colour)
            if (p.optBoolean("kid", false)) o.put("kid", true)
            if (p.optBoolean("guest", false)) o.put("guest", true)
            if (p.optString("src") == "account") o.put("src", "account")
            out.put(o)
        }
        return out
    }
}
