package dev.couchtv.ontv.matter

/**
 * A small DNS / mDNS message reader and writer (RFC 1035, RFC 6762, RFC 6763), with no Android
 * calls, so DiscoveryDnsTest checks it on a computer against packets captured on the home network.
 *
 * Why it exists: on Android 11 to 13, NsdManager hands back one IPv4 address per Matter service, and
 * Thread devices (behind a border router) only have IPv6 addresses. Reading the mDNS answers
 * ourselves gives every AAAA record, so the controller can reach Thread devices.
 *
 * Names are kept as label lists. [DnsName.key] is the lower case form used for lookups (DNS names
 * compare without case). Labels may hold dots or spaces (border routers use names like
 * "eero_thread #0000 (10233)"), so a label is never split on a dot after it is read.
 */
object DiscoveryDns {
    const val TYPE_A = 1
    const val TYPE_PTR = 12
    const val TYPE_TXT = 16
    const val TYPE_AAAA = 28
    const val TYPE_SRV = 33
    const val TYPE_NSEC = 47
    const val TYPE_ANY = 255
    const val CLASS_IN = 1

    class FormatException(message: String) : Exception(message)

    data class DnsName(val labels: List<String>) {
        val key: String get() = labels.joinToString(".") { it.lowercase().replace("\\", "\\\\").replace(".", "\\.") }
        override fun toString(): String = labels.joinToString(".")
        fun endsWith(suffix: DnsName): Boolean {
            if (suffix.labels.size > labels.size) return false
            val off = labels.size - suffix.labels.size
            return suffix.labels.indices.all { labels[off + it].equals(suffix.labels[it], ignoreCase = true) }
        }
        /** The first label (the instance name of a service instance). */
        val first: String get() = labels.firstOrNull() ?: ""
        fun drop(n: Int) = DnsName(labels.drop(n))

        companion object {
            /** The mDNS domain. */
            const val LOCAL = "local"
            /** [labels] then "local": mdns("_matter", "_tcp") is the Matter service type. */
            fun mdns(vararg labels: String) = DnsName(labels.toList() + LOCAL)
            /** Splits a plain dotted name ("_matter._tcp" then "local"). Use the constructor for labels holding dots. */
            fun of(dotted: String) = DnsName(dotted.trim('.').split('.').filter { it.isNotEmpty() })
        }
    }

    data class Question(val name: DnsName, val type: Int, val unicastResponse: Boolean)

    sealed class RData {
        data class Ptr(val target: DnsName) : RData()
        data class Srv(val priority: Int, val weight: Int, val port: Int, val target: DnsName) : RData()
        /** The raw strings of a TXT record, as bytes (Matter values can hold binary, like meshcop xp=). */
        class Txt(val strings: List<ByteArray>) : RData() {
            /** key=value pairs; a key with no '=' maps to an empty array. Keys are case-insensitive (RFC 6763 6.4): kept as written. */
            fun pairs(): Map<String, ByteArray> {
                val out = LinkedHashMap<String, ByteArray>()
                for (s in strings) {
                    if (s.isEmpty()) continue
                    val eq = s.indexOf('='.code.toByte())
                    val k = String(if (eq < 0) s else s.copyOfRange(0, eq), Charsets.UTF_8)
                    if (k.isEmpty() || out.keys.any { it.equals(k, ignoreCase = true) }) continue  // first one wins (RFC 6763 6.4)
                    out[k] = if (eq < 0) ByteArray(0) else s.copyOfRange(eq + 1, s.size)
                }
                return out
            }
            override fun equals(other: Any?) = other is Txt && other.strings.size == strings.size &&
                strings.indices.all { strings[it].contentEquals(other.strings[it]) }
            override fun hashCode() = strings.fold(1) { h, s -> 31 * h + s.contentHashCode() }
            override fun toString() = "Txt(" + strings.joinToString { String(it, Charsets.UTF_8) } + ")"
        }
        class A(val address: ByteArray) : RData() {
            override fun equals(other: Any?) = other is A && other.address.contentEquals(address)
            override fun hashCode() = address.contentHashCode()
            override fun toString() = "A(" + DiscoveryAddr.format(address) + ")"
        }
        class Aaaa(val address: ByteArray) : RData() {
            override fun equals(other: Any?) = other is Aaaa && other.address.contentEquals(address)
            override fun hashCode() = address.contentHashCode()
            override fun toString() = "AAAA(" + DiscoveryAddr.format(address) + ")"
        }
        class Other(val bytes: ByteArray) : RData() {
            override fun equals(other: Any?) = other is Other && other.bytes.contentEquals(bytes)
            override fun hashCode() = bytes.contentHashCode()
        }
    }

    data class Record(val name: DnsName, val type: Int, val cacheFlush: Boolean, val ttl: Long, val data: RData)

    data class Message(
        val id: Int,
        val isResponse: Boolean,
        val questions: List<Question>,
        val answers: List<Record>,
        val authorities: List<Record>,
        val additionals: List<Record>,
    ) {
        /** Answers and additionals together: mDNS responders put useful records in both. */
        val records: List<Record> get() = answers + additionals
    }

    // ---------- reading ----------

    fun parse(buf: ByteArray, length: Int = buf.size): Message {
        if (length < 12 || length > buf.size) throw FormatException("too short")
        val r = Reader(buf, length)
        val id = r.u16()
        val flags = r.u16()
        val qd = r.u16(); val an = r.u16(); val ns = r.u16(); val ar = r.u16()
        val qs = ArrayList<Question>(minOf(qd, 64))
        repeat(qd) {
            val n = r.name()
            val t = r.u16(); val c = r.u16()
            qs += Question(n, t, c and 0x8000 != 0)
        }
        fun records(count: Int): List<Record> {
            val out = ArrayList<Record>(minOf(count, 128))
            repeat(count) { out += r.record() }
            return out
        }
        val answers = records(an)
        val auth = records(ns)
        // A truncated additional section still leaves useful answers: keep what parsed.
        val adds = ArrayList<Record>()
        try { repeat(ar) { adds += r.record() } } catch (e: FormatException) { if (answers.isEmpty()) throw e }
        return Message(id, flags and 0x8000 != 0, qs, answers, auth, adds)
    }

    private class Reader(val b: ByteArray, val len: Int) {
        var pos = 0
        fun need(n: Int) { if (pos + n > len) throw FormatException("ran past the end at $pos") }
        fun u8(): Int { need(1); return b[pos++].toInt() and 0xff }
        fun u16(): Int { need(2); val v = ((b[pos].toInt() and 0xff) shl 8) or (b[pos + 1].toInt() and 0xff); pos += 2; return v }
        fun u32(): Long { val hi = u16().toLong(); val lo = u16().toLong(); return (hi shl 16) or lo }
        fun bytes(n: Int): ByteArray { need(n); val out = b.copyOfRange(pos, pos + n); pos += n; return out }

        /** A name at the current position, following compression pointers; stops loops and over-long names. */
        fun name(): DnsName {
            val (n, end) = nameAt(pos)
            pos = end
            return n
        }

        fun nameAt(start: Int): Pair<DnsName, Int> {
            val labels = ArrayList<String>()
            var p = start
            var end = -1
            var jumps = 0
            var total = 0
            while (true) {
                if (p >= len) throw FormatException("name runs past the end")
                val l = b[p].toInt() and 0xff
                when {
                    l == 0 -> { p += 1; break }
                    l and 0xc0 == 0xc0 -> {
                        if (p + 1 >= len) throw FormatException("cut pointer")
                        if (++jumps > 64) throw FormatException("pointer loop")
                        if (end < 0) end = p + 2
                        val target = ((l and 0x3f) shl 8) or (b[p + 1].toInt() and 0xff)
                        if (target >= len) throw FormatException("pointer past the end")
                        p = target
                    }
                    l and 0xc0 != 0 -> throw FormatException("unknown label type")
                    else -> {
                        if (p + 1 + l > len) throw FormatException("label runs past the end")
                        total += l + 1
                        if (total > 255) throw FormatException("name too long")
                        labels += String(b, p + 1, l, Charsets.UTF_8)
                        p += 1 + l
                    }
                }
            }
            return DnsName(labels) to (if (end >= 0) end else p)
        }

        fun record(): Record {
            val n = name()
            val type = u16()
            val cls = u16()
            val ttl = u32()
            val rdlen = u16()
            need(rdlen)
            val start = pos
            val stop = start + rdlen
            val data: RData = when (type) {
                TYPE_PTR -> RData.Ptr(nameAt(start).first)
                TYPE_SRV -> {
                    if (rdlen < 7) throw FormatException("short SRV")
                    pos = start
                    val pr = u16(); val w = u16(); val port = u16()
                    RData.Srv(pr, w, port, nameAt(pos).first)
                }
                TYPE_TXT -> {
                    val strings = ArrayList<ByteArray>()
                    var p = start
                    while (p < stop) {
                        val l = b[p].toInt() and 0xff
                        if (p + 1 + l > stop) throw FormatException("TXT string runs past its record")
                        strings += b.copyOfRange(p + 1, p + 1 + l)
                        p += 1 + l
                    }
                    RData.Txt(strings)
                }
                TYPE_A -> if (rdlen == 4) RData.A(b.copyOfRange(start, stop)) else throw FormatException("bad A")
                TYPE_AAAA -> if (rdlen == 16) RData.Aaaa(b.copyOfRange(start, stop)) else throw FormatException("bad AAAA")
                else -> RData.Other(b.copyOfRange(start, stop))
            }
            pos = stop
            return Record(n, type, cls and 0x8000 != 0, ttl, data)
        }
    }

    // ---------- writing ----------

    /**
     * A query for [questions] (name, type). [unicastResponse] sets the QU bit (RFC 6762 5.4) so
     * responders may answer straight to us. Sent from a port other than 5353, every responder must
     * answer by unicast anyway (a "one-shot" query, RFC 6762 5.1).
     */
    fun query(questions: List<Pair<DnsName, Int>>, id: Int = 0, unicastResponse: Boolean = false): ByteArray {
        val w = Writer()
        w.u16(id); w.u16(0); w.u16(questions.size); w.u16(0); w.u16(0); w.u16(0)
        for ((n, t) in questions) { w.name(n); w.u16(t); w.u16(CLASS_IN or (if (unicastResponse) 0x8000 else 0)) }
        return w.out()
    }

    /** A response holding [answers] then [additionals], no compression. Used by tests and the fake responder. */
    fun response(answers: List<Record>, additionals: List<Record> = emptyList(), id: Int = 0): ByteArray {
        val w = Writer()
        w.u16(id); w.u16(0x8400); w.u16(0); w.u16(answers.size); w.u16(0); w.u16(additionals.size)
        for (r in answers + additionals) {
            w.name(r.name); w.u16(r.type); w.u16(CLASS_IN or (if (r.cacheFlush) 0x8000 else 0)); w.u32(r.ttl)
            val body = Writer()
            when (val d = r.data) {
                is RData.Ptr -> body.name(d.target)
                is RData.Srv -> { body.u16(d.priority); body.u16(d.weight); body.u16(d.port); body.name(d.target) }
                is RData.Txt -> for (s in d.strings) { body.u8(s.size); body.raw(s) }
                is RData.A -> body.raw(d.address)
                is RData.Aaaa -> body.raw(d.address)
                is RData.Other -> body.raw(d.bytes)
            }
            val bytes = body.out()
            w.u16(bytes.size); w.raw(bytes)
        }
        return w.out()
    }

    private class Writer {
        private val o = java.io.ByteArrayOutputStream()
        fun u8(v: Int) = o.write(v and 0xff)
        fun u16(v: Int) { o.write((v shr 8) and 0xff); o.write(v and 0xff) }
        fun u32(v: Long) { u16(((v shr 16) and 0xffff).toInt()); u16((v and 0xffff).toInt()) }
        fun raw(b: ByteArray) = o.write(b)
        fun name(n: DnsName) {
            for (l in n.labels) {
                val b = l.toByteArray(Charsets.UTF_8)
                require(b.size in 1..63) { "label length ${b.size}" }
                u8(b.size); raw(b)
            }
            u8(0)
        }
        fun out(): ByteArray = o.toByteArray()
    }
}

/** Address bytes to text and back, without a DNS lookup (InetAddress.getByAddress never looks anything up). */
object DiscoveryAddr {
    fun format(b: ByteArray): String = when (b.size) {
        4 -> b.joinToString(".") { (it.toInt() and 0xff).toString() }
        16 -> {
            val groups = IntArray(8) { ((b[it * 2].toInt() and 0xff) shl 8) or (b[it * 2 + 1].toInt() and 0xff) }
            // Longest run of zero groups (length 2 or more) becomes "::" (RFC 5952).
            var bestStart = -1; var bestLen = 0; var i = 0
            while (i < 8) {
                if (groups[i] == 0) {
                    var j = i; while (j < 8 && groups[j] == 0) j++
                    if (j - i > bestLen && j - i >= 2) { bestStart = i; bestLen = j - i }
                    i = j
                } else i++
            }
            val sb = StringBuilder()
            i = 0
            while (i < 8) {
                if (i == bestStart) { sb.append("::"); i += bestLen; continue }
                if (sb.isNotEmpty() && !sb.endsWith(":")) sb.append(':')
                sb.append(Integer.toHexString(groups[i])); i++
            }
            sb.toString()
        }
        else -> b.joinToString("") { "%02x".format(it) }
    }

    /** Parses "fd00::1", "fe80::1%wlan0" (the zone is dropped) or "192.0.2.2". Null when it is not an address. */
    fun parse(text: String): ByteArray? {
        val t = text.substringBefore('%').trim()
        if (t.contains(':')) return parse6(t)
        val parts = t.split('.')
        if (parts.size != 4) return null
        return ByteArray(4) { (parts[it].toIntOrNull()?.takeIf { v -> v in 0..255 } ?: return null).toByte() }
    }

    private fun parse6(t: String): ByteArray? {
        var s = t
        var tail4: ByteArray? = null
        // An embedded IPv4 tail ("::ffff:1.2.3.4").
        val lastColon = s.lastIndexOf(':')
        if (s.substring(lastColon + 1).contains('.')) {
            tail4 = parse(s.substring(lastColon + 1)) ?: return null
            s = s.substring(0, lastColon + 1) + "0:0"
        }
        val halves = s.split("::")
        if (halves.size > 2) return null
        fun groups(h: String) = if (h.isEmpty()) emptyList() else h.split(':')
        val head = groups(halves[0]); val back = if (halves.size == 2) groups(halves[1]) else emptyList()
        val fill = 8 - head.size - back.size
        if (halves.size == 1 && fill != 0) return null
        if (halves.size == 2 && fill < 1) return null
        val all = head + List(if (halves.size == 2) fill else 0) { "0" } + back
        if (all.size != 8) return null
        val out = ByteArray(16)
        for ((i, g) in all.withIndex()) {
            if (g.isEmpty() || g.length > 4) return null
            val v = g.toIntOrNull(16) ?: return null
            out[i * 2] = (v shr 8).toByte(); out[i * 2 + 1] = v.toByte()
        }
        if (tail4 != null) System.arraycopy(tail4, 0, out, 12, 4)
        return out
    }

    fun isLinkLocal6(b: ByteArray) = b.size == 16 && (b[0].toInt() and 0xff) == 0xfe && (b[1].toInt() and 0xc0) == 0x80
    fun isUla(b: ByteArray) = b.size == 16 && (b[0].toInt() and 0xfe) == 0xfc
    fun isGlobal6(b: ByteArray) = b.size == 16 && (b[0].toInt() and 0xe0) == 0x20

    /** True when [addr] is inside [prefix]/[prefixLen] (same family). */
    fun inPrefix(addr: ByteArray, prefix: ByteArray, prefixLen: Int): Boolean {
        if (addr.size != prefix.size || prefixLen < 0 || prefixLen > addr.size * 8) return false
        val full = prefixLen / 8
        for (i in 0 until full) if (addr[i] != prefix[i]) return false
        val rem = prefixLen % 8
        if (rem == 0) return true
        val mask = (0xff shl (8 - rem)) and 0xff
        return (addr[full].toInt() and mask) == (prefix[full].toInt() and mask)
    }
}
