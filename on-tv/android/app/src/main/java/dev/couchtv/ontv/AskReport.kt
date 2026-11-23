package dev.couchtv.ontv

import android.util.Log
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject

/**
 * Report this answer (the Play build, PlayRules.reportAnswers): Google Play's AI generated content policy wants
 * a way to flag an AI answer without leaving the app. The Ask sheet on the TV home (tv-home/web/ask.js) shows the
 * button under an answer when window.TVPLAY is there (HomeActivity adds it in the Play build only).
 *
 * Kept on this TV for now (ask-reports.json, the last 50, nothing else about the TV), and logged. Where reports go
 * from here (a form on couchtv.joshuaseage.com, or an email) is the owner's choice: GOOGLE-PLAY-BUILD.md, open questions.
 */
object AskReport {
    private const val FILE = "ask-reports.json"
    private const val KEEP = 50

    /** The kept list with this report added at the end, the oldest dropped past KEEP. Plain, for AskReportTest. */
    fun added(list: JSONArray?, question: String, answer: String, at: Long): JSONArray {
        val out = JSONArray()
        val old = list ?: JSONArray()
        val from = maxOf(0, old.length() + 1 - KEEP)
        for (i in from until old.length()) out.put(old.get(i))
        out.put(JSONObject().put("q", question.take(500)).put("a", answer.take(2000)).put("at", at))
        return out
    }

    fun report(question: String, answer: String): Boolean = runCatching {
        if (question.isBlank() || answer.isBlank()) return false
        Store.writeJson(FILE, added(Store.readJson(FILE) as? JSONArray, question, answer, System.currentTimeMillis()))
        Log.i("couchtv.ask", "an answer was reported")
        true
    }.getOrDefault(false)

    /** window.TVPLAY on the TV home, Play build only. */
    class Page {
        @JavascriptInterface fun report(question: String, answer: String): Boolean = AskReport.report(question, answer)
        @JavascriptInterface fun words(): String = JSONObject().put("report", PlayRules.REPORT).put("done", PlayRules.REPORT_DONE).toString()
    }
}
