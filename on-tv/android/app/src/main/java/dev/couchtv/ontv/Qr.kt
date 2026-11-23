package dev.couchtv.ontv

/**
 * A QR code made right here on the TV (no library, nothing sent anywhere to draw it): byte mode, error
 * correction level M, versions 1 to 10. A line for line copy of tv-home/web/qr.js (TVQR.matrix), so
 * both draw the same code; QrTest checks it against that file's answers. The setup screen shows the
 * phone remote's address with it, so nobody has to type an address with a phone keyboard.
 */
object Qr {
    private val ECC_PER_BLOCK = intArrayOf(-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26)
    private val BLOCKS = intArrayOf(-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5)

    private fun rawModules(ver: Int): Int {
        var r = (16 * ver + 128) * ver + 64
        if (ver >= 2) { val n = ver / 7 + 2; r -= (25 * n - 10) * n - 55; if (ver >= 7) r -= 36 }
        return r
    }
    private fun dataCodewords(ver: Int) = rawModules(ver) / 8 - ECC_PER_BLOCK[ver] * BLOCKS[ver]
    private fun gfMul(x: Int, y: Int): Int {
        var z = 0
        for (i in 7 downTo 0) { z = (z shl 1) xor ((z ushr 7) * 0x11d); z = z xor (((y ushr i) and 1) * x) }
        return z and 0xff
    }
    private fun rsDivisor(deg: Int): IntArray {
        val r = IntArray(deg); r[deg - 1] = 1
        var root = 1
        for (i in 0 until deg) {
            for (j in r.indices) { r[j] = gfMul(r[j], root); if (j + 1 < r.size) r[j] = r[j] xor r[j + 1] }
            root = gfMul(root, 0x02)
        }
        return r
    }
    private fun rsRemainder(data: List<Int>, div: IntArray): List<Int> {
        val r = ArrayDeque(List(div.size) { 0 })
        for (b in data) {
            val f = b xor r.removeFirst(); r.addLast(0)
            for (i in div.indices) r[i] = r[i] xor gfMul(div[i], f)
        }
        return r.toList()
    }

    /** Rows of true (dark) and false. Throws when the text is too long for version 10. */
    fun matrix(text: String): Array<BooleanArray> {
        val bytes = text.toByteArray(Charsets.UTF_8).map { it.toInt() and 0xff }
        var ver = 1
        while (ver <= 10) { if (4 + (if (ver < 10) 8 else 16) + bytes.size * 8 <= dataCodewords(ver) * 8) break; ver++ }
        require(ver <= 10) { "Too long for a QR code here" }
        val size = ver * 4 + 17; val cap = dataCodewords(ver) * 8
        val bits = ArrayList<Int>()
        fun put(v: Int, n: Int) { for (i in n - 1 downTo 0) bits.add((v ushr i) and 1) }
        put(4, 4); put(bytes.size, if (ver < 10) 8 else 16); bytes.forEach { put(it, 8) }
        put(0, minOf(4, cap - bits.size))
        put(0, (8 - bits.size % 8) % 8)
        var pad = 0xec
        while (bits.size < cap) { put(pad, 8); pad = pad xor 0xec xor 0x11 }
        val data = ArrayList<Int>()
        var i = 0
        while (i < bits.size) { var b = 0; for (k in 0 until 8) b = (b shl 1) or bits[i + k]; data.add(b); i += 8 }
        val nb = BLOCKS[ver]; val el = ECC_PER_BLOCK[ver]; val raw = rawModules(ver) / 8
        val nShort = nb - raw % nb; val shortLen = raw / nb; val div = rsDivisor(el)
        val blocks = ArrayList<List<Int>>(); var at = 0
        for (bi in 0 until nb) {
            val d = ArrayList(data.subList(at, at + shortLen - el + (if (bi < nShort) 0 else 1))); at += d.size
            val ecc = rsRemainder(d, div)
            if (bi < nShort) d.add(0)
            blocks.add(d + ecc)
        }
        val words = ArrayList<Int>()
        for (k in blocks[0].indices) for (j in blocks.indices) if (k != shortLen - el || j >= nShort) words.add(blocks[j][k])

        val m = Array(size) { BooleanArray(size) }; val f = Array(size) { BooleanArray(size) }
        fun set(x: Int, y: Int, dark: Boolean) { m[y][x] = dark; f[y][x] = true }
        for (k in 0 until size) { set(6, k, k % 2 == 0); set(k, 6, k % 2 == 0) }
        for ((cx, cy) in listOf(3 to 3, size - 4 to 3, 3 to size - 4)) {
            for (dy in -4..4) for (dx in -4..4) {
                val dist = maxOf(Math.abs(dx), Math.abs(dy)); val xx = cx + dx; val yy = cy + dy
                if (xx in 0 until size && yy in 0 until size) set(xx, yy, dist != 2 && dist != 4)
            }
        }
        val al = ArrayList<Int>()
        if (ver > 1) {
            val na = ver / 7 + 2
            val step = Math.ceil((ver * 4 + 4).toDouble() / (na * 2 - 2)).toInt() * 2
            al.add(6)
            var pos = size - 7
            while (al.size < na) { al.add(1, pos); pos -= step }
        }
        val last = al.size - 1
        for ((ii, ay) in al.withIndex()) for ((jj, ax) in al.withIndex()) {
            if ((ii == 0 && jj == 0) || (ii == 0 && jj == last) || (ii == last && jj == 0)) continue
            for (dy in -2..2) for (dx in -2..2) set(ax + dx, ay + dy, maxOf(Math.abs(dx), Math.abs(dy)) != 1)
        }
        fun format(mask: Int) {
            val dd = mask; var rem = dd
            for (t in 0 until 10) rem = (rem shl 1) xor ((rem ushr 9) * 0x537)
            val fb = ((dd shl 10) or rem) xor 0x5412
            fun bit(n: Int) = ((fb ushr n) and 1) == 1
            for (q in 0..5) set(8, q, bit(q))
            set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8))
            for (q in 9 until 15) set(14 - q, 8, bit(q))
            for (q in 0 until 8) set(size - 1 - q, 8, bit(q))
            for (q in 8 until 15) set(8, size - 15 + q, bit(q))
            set(8, size - 8, true)
        }
        format(0)
        if (ver >= 7) {
            var rem = ver
            for (k in 0 until 12) rem = (rem shl 1) xor ((rem ushr 11) * 0x1f25)
            val vb = (ver shl 12) or rem
            for (k in 0 until 18) { val bt = ((vb ushr k) and 1) == 1; val a = size - 11 + k % 3; val c = k / 3; set(a, c, bt); set(c, a, bt) }
        }
        var n = 0
        var right = size - 1
        while (right >= 1) {
            if (right == 6) right = 5
            for (v in 0 until size) for (j in 0 until 2) {
                val x = right - j; val up = ((right + 1) and 2) == 0; val y = if (up) size - 1 - v else v
                if (!f[y][x] && n < words.size * 8) { m[y][x] = ((words[n ushr 3] ushr (7 - (n and 7))) and 1) == 1; n++ }
            }
            right -= 2
        }
        fun flip(mask: Int) {
            for (y in 0 until size) for (x in 0 until size) {
                if (f[y][x]) continue
                val inv = when (mask) {
                    0 -> (x + y) % 2 == 0
                    1 -> y % 2 == 0
                    2 -> x % 3 == 0
                    3 -> (x + y) % 3 == 0
                    4 -> (x / 3 + y / 2) % 2 == 0
                    5 -> (x * y) % 2 + (x * y) % 3 == 0
                    6 -> ((x * y) % 2 + (x * y) % 3) % 2 == 0
                    else -> ((x + y) % 2 + (x * y) % 3) % 2 == 0
                }
                if (inv) m[y][x] = !m[y][x]
            }
        }
        fun score(): Int {
            var s = 0; var dark = 0
            for (y in 0 until size) { var run = 1; for (x in 1..size) { if (x < size && m[y][x] == m[y][x - 1]) run++ else { if (run >= 5) s += run - 2; run = 1 } } }
            for (x in 0 until size) { var run = 1; for (y in 1..size) { if (y < size && m[y][x] == m[y - 1][x]) run++ else { if (run >= 5) s += run - 2; run = 1 } } }
            for (y in 0 until size - 1) for (x in 0 until size - 1) { val cc = m[y][x]; if (cc == m[y][x + 1] && cc == m[y + 1][x] && cc == m[y + 1][x + 1]) s += 3 }
            for (y in 0 until size) for (x in 0 until size) if (m[y][x]) dark++
            return s + (Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10
        }
        var best = 0; var bestScore = Int.MAX_VALUE
        for (mk in 0 until 8) { flip(mk); format(mk); val sc = score(); if (sc < bestScore) { bestScore = sc; best = mk }; flip(mk) }
        flip(best); format(best)
        return m
    }

    /** The code as rows of "1" and "0", for the tests. */
    fun rows(text: String): List<String> = matrix(text).map { r -> r.joinToString("") { if (it) "1" else "0" } }
}
