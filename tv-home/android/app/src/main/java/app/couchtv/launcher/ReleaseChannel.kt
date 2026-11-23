package app.couchtv.launcher

/**
 * Which GitHub release a TV may update to (Updater.kt). Plain Kotlin, no Android, so the rules are
 * unit tested (ReleaseChannelTest).
 *
 * Two channels, fixed when the app is built (BuildConfig.UPDATE_CHANNEL, -PupdateChannel=beta):
 *   - "stable", every release build people download. It asks GitHub for /releases/latest, which never
 *     answers with a draft or a pre-release, and on top of that it takes nothing marked pre-release
 *     and nothing whose tag says it is one (v0.13-beta.1). So a beta can never reach these TVs, even
 *     one published by mistake without the pre-release tick.
 *   - "beta", only for test builds installed by hand. It looks through the recent releases, takes the
 *     newest version among them (pre-releases included, drafts never), so a beta TV also moves on
 *     to the next stable release once that is newer.
 *
 * Versions compare the way people read them: 0.10 is newer than 0.9, and 0.13-beta.1 comes before
 * 0.13 (a test build of a version is older than that version itself), so a beta TV updates to the
 * real release when it comes out.
 */
object ReleaseChannel {
    data class Release(val tag: String, val prerelease: Boolean, val draft: Boolean, val hasAsset: Boolean)

    /** True when version a is newer than b. */
    fun newer(a: String, b: String): Boolean = compare(a, b) > 0

    fun compare(a: String, b: String): Int {
        val (ca, pa) = split(a)
        val (cb, pb) = split(b)
        for (i in 0 until maxOf(ca.size, cb.size)) {
            val p = ca.getOrElse(i) { 0 }
            val q = cb.getOrElse(i) { 0 }
            if (p != q) return p.compareTo(q)
        }
        // the same numbers: a version with no pre-release part is the newer one
        if (pa.isEmpty() && pb.isEmpty()) return 0
        if (pa.isEmpty()) return 1
        if (pb.isEmpty()) return -1
        val xa = pa.split('.')
        val xb = pb.split('.')
        for (i in 0 until maxOf(xa.size, xb.size)) {
            val s = xa.getOrNull(i) ?: return -1
            val t = xb.getOrNull(i) ?: return 1
            val n = s.toIntOrNull()
            val m = t.toIntOrNull()
            val c = if (n != null && m != null) n.compareTo(m) else if (n != null) -1 else if (m != null) 1 else s.compareTo(t)
            if (c != 0) return c
        }
        return 0
    }

    /** "v0.13-beta.1+abc" -> ([0, 13], "beta.1"). */
    private fun split(v: String): Pair<List<Int>, String> {
        val s = v.trim().removePrefix("v").substringBefore('+')
        val core = s.substringBefore('-')
        val pre = if (s.contains('-')) s.substringAfter('-') else ""
        return Pair(core.split('.').map { p -> p.takeWhile { it.isDigit() }.toIntOrNull() ?: 0 }, pre)
    }

    /** A tag that says it is a test build: anything after a dash (0.13-beta.1, 0.13-rc1). */
    fun isPreTag(tag: String): Boolean = tag.trim().removePrefix("v").substringBefore('+').contains('-')

    /** May a stable TV take this release (the answer of /releases/latest)? */
    fun stableOk(r: Release): Boolean = !r.draft && !r.prerelease && !isPreTag(r.tag)

    /** The release a beta TV goes for, from a list of recent releases: the newest with the app in it. */
    fun pickBeta(list: List<Release>): Release? =
        list.filter { !it.draft && it.hasAsset && it.tag.isNotBlank() }
            .fold(null as Release?) { best, r -> if (best == null || compare(r.tag, best.tag) > 0) r else best }
}
