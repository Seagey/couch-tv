package dev.couchtv.ontv.matter

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * A Matter sharing code from Couch TV Setup on the computer, over ADB (H2, lane B 28 Nov 2026), so nobody has to read the six digit
 * pairing code off the TV to reach POST /api/matter/commission. Behind android.permission.DUMP (the manifest), which ADB's shell holds
 * and no TV app does, the same door as SetupLink. It runs the same [Matter.commission] the phone page uses, so locks, alarms and garage
 * doors are refused the same way.
 *   am broadcast -n dev.couchtv.ontv/.matter.MatterFromComputer --es matter_code <code>   answers "couchtv-matter started" (or "busy")
 *   am broadcast -n dev.couchtv.ontv/.matter.MatterFromComputer --es matter_status 1     answers "couchtv-matter running", "ok <ids>" or "no <key>"
 * Adding a device takes up to about two minutes, longer than Android lets a broadcast wait, so it runs on its own and Setup asks again.
 */
class MatterFromComputer : BroadcastReceiver() {
    override fun onReceive(ctx: Context, i: Intent) {
        val code = i.getStringExtra("matter_code")?.trim()
        val answer = when {
            code != null -> start(code)
            i.hasExtra("matter_status") -> status()
            else -> "couchtv-matter no code"
        }
        if (isOrderedBroadcast) setResult(if (answer.startsWith("couchtv-matter no")) 2 else 1, answer, null)
    }

    companion object {
        @Volatile private var running = false
        @Volatile private var last: String = "couchtv-matter none"

        internal fun start(code: String): String {
            if (code.length !in 11..64) return "couchtv-matter no code"
            synchronized(this) {
                if (running) return "couchtv-matter busy"
                running = true
                last = "couchtv-matter running"
            }
            Thread {
                last = try {
                    val r = Matter.commission(code)
                    if (r.optBoolean("ok")) "couchtv-matter ok " + (r.optJSONArray("device_ids")?.join(",")?.replace("\"", "") ?: "")
                    else "couchtv-matter no " + r.optString("error").ifEmpty { "failed" }
                } catch (e: Exception) { "couchtv-matter no failed" }
                running = false
            }.start()
            return "couchtv-matter started"
        }

        internal fun status(): String = last
    }
}
