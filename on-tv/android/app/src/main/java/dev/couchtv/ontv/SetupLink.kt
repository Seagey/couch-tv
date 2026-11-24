package dev.couchtv.ontv

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * The account link from a computer over ADB (tv-home FromComputer.kt says why this is the only way in): behind
 * android.permission.DUMP, which ADB's shell holds and no TV app does. Answers "couchtv-link ok <first 16 of the
 * link's sha256>" only once the link is really kept.
 */
class SetupLink : BroadcastReceiver() {
    override fun onReceive(ctx: Context, i: Intent) {
        val kept = AccountLink.readExtras(ctx, i)
        val held = AccountLink.token(AccountLink.kv(ctx))
        val sent = AccountLink.cleanLink(i.getStringExtra("account_link")?.trim())
        if (kept) HomeActivity.setupDesign()
        if (!isOrderedBroadcast) return
        if (sent != null && held == sent) setResult(1, "couchtv-link ok " + AccountLink.proof(sent), null)
        else setResult(2, "couchtv-link no", null)
    }
}
