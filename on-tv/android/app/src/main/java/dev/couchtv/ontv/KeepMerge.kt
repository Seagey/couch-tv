package dev.couchtv.ontv

/**
 * How Keep watching puts this TV's own history and Android's Watch Next rows into one row (#122).
 * Plain Kotlin with no Android in it, so the rules have unit tests (KeepMergeTest).
 *
 * - Watch Next rows follow the TV home app's rules (tv-home MainActivity.readWatchNext): newest
 *   first, never this app's own rows, none from a package in skip_watch_next, and at most
 *   watch_next_per_app from any one app.
 * - One card per show. When this TV's history and an app's Watch Next row name the same show, the
 *   newer one wins, as on the bridge (f1fd148): an app that moved on to a newer episode is not
 *   held back by an older line in couch-tv's own history, and a newer play couch-tv saw itself is
 *   not hidden by an old row.
 * - Newest first, up to max cards.
 */
object KeepMerge {
    /** A card in the making. show is the normalised title (Finder.norm), whenMs when it was last watched. */
    data class Card<T>(val show: String, val pkg: String, val whenMs: Long, val fromWatchNext: Boolean, val item: T)

    fun <T> watchNext(rows: List<Card<T>>, self: String, skip: Set<String>, perApp: Int): List<Card<T>> {
        val limit = perApp.coerceIn(1, 20)
        val perPkg = HashMap<String, Int>()
        val seen = HashSet<String>()
        val out = ArrayList<Card<T>>()
        for (r in rows.sortedByDescending { it.whenMs }) {
            if (r.pkg.isEmpty() || r.pkg == self || r.pkg in skip || r.show.isEmpty()) continue
            if (!seen.add(r.pkg + "|" + r.show)) continue          // an app can keep two rows for one show
            val n = (perPkg[r.pkg] ?: 0) + 1
            if (n > limit) continue
            perPkg[r.pkg] = n
            out.add(r)
        }
        return out
    }

    fun <T> merge(history: List<Card<T>>, watchNext: List<Card<T>>, max: Int): List<Card<T>> {
        val best = LinkedHashMap<String, Card<T>>()
        for (c in history + watchNext) {
            if (c.show.isEmpty()) continue
            val had = best[c.show]
            // newer wins; on a tie couch-tv's own line stays, so nothing moves without a reason
            if (had == null || c.whenMs > had.whenMs) best[c.show] = c
        }
        return best.values.sortedByDescending { it.whenMs }.take(max)
    }
}
