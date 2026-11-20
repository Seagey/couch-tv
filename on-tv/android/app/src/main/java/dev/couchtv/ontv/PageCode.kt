package dev.couchtv.ontv

import org.json.JSONObject

/** Words and data the app hands to the home page with evaluateJavascript (HomeActivity), quoted so they are only ever data. */
object PageCode {
    /** A JavaScript string: JSON quoting, plus the two line breaks JSON allows in a string and older JavaScript does not (U+2028, U+2029). */
    fun string(t: String): String = JSONObject.quote(t).replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")

    /** JSON for the page, parsed there (JSON.parse), never run as code. */
    fun json(json: String): String = "JSON.parse(" + string(json) + ")"
}
