package dev.couchtv.ontv.matter

import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Plain Kotlin file storage for the Matter controller, in the app's private files (never on shared
 * storage, never in Android's cloud backup: the manifest has allowBackup false).
 *
 *  - nodes.json: each device the TV added (node id, when, the person's own names, the last address it
 *    answered on, and the last values it reported, so the list shows at once after a restart)
 *  - fabric.json: a copy of the controller's own key store (the fabric's root key and certificate),
 *    written after every change, so a damaged preferences file never loses the devices ([saveFabric])
 *
 * Every write goes to a .tmp file first and replaces the old file in one rename, and the file before
 * it is kept as .bak, which [read] falls back to if the main file is unreadable.
 */
class MatterStore(val dir: File) {
    init { dir.mkdirs() }

    data class Saved(
        val node: Long,
        val added: Long,
        val names: MutableMap<String, String> = LinkedHashMap(),
        var address: String? = null,
        var port: Int = 0,
        var snapshot: MatterNode = emptyMap(),
    )

    private val nodesFile = File(dir, "nodes.json")
    private val fabricFile = File(dir, "fabric.json")

    @Synchronized fun nodes(): List<Saved> {
        val o = read(nodesFile) ?: return emptyList()
        val arr = o.optJSONArray("nodes") ?: return emptyList()
        return (0 until arr.length()).mapNotNull { i ->
            val n = arr.optJSONObject(i) ?: return@mapNotNull null
            val id = runCatching { java.lang.Long.parseUnsignedLong(n.optString("node")) }.getOrNull() ?: return@mapNotNull null
            val names = LinkedHashMap<String, String>()
            n.optJSONObject("names")?.let { m -> m.keys().forEach { k -> names[k] = m.optString(k) } }
            Saved(id, n.optLong("added"), names, n.optString("address").ifEmpty { null }, n.optInt("port"), snapshotFrom(n.optJSONObject("snapshot")))
        }
    }

    @Synchronized fun save(list: List<Saved>) {
        val arr = JSONArray()
        list.forEach { s ->
            arr.put(JSONObject().put("node", java.lang.Long.toUnsignedString(s.node)).put("added", s.added)
                .put("names", JSONObject(s.names as Map<*, *>)).put("address", s.address ?: "").put("port", s.port)
                .put("snapshot", snapshotTo(s.snapshot)))
        }
        val o = read(nodesFile) ?: JSONObject()
        write(nodesFile, o.put("version", 1).put("nodes", arr))
    }

    /** The next node id to give a new device (starts at 1, never reused). */
    @Synchronized fun nextNodeId(): Long {
        val o = read(nodesFile) ?: JSONObject()
        val used = nodes().maxOfOrNull { it.node } ?: 0L
        val next = maxOf(o.optLong("next_node", 1L), used + 1)
        write(nodesFile, o.put("next_node", next + 1).put("version", 1))
        return next
    }

    @Synchronized fun saveFabric(kv: Map<String, String>) {
        write(fabricFile, JSONObject().put("version", 1).put("saved", System.currentTimeMillis()).put("kv", JSONObject(kv as Map<*, *>)))
    }

    @Synchronized fun fabric(): Map<String, String> {
        val kv = read(fabricFile)?.optJSONObject("kv") ?: return emptyMap()
        return kv.keys().asSequence().associateWith { kv.optString(it) }
    }

    // ---------------------------------------------------------------- files

    private fun read(f: File): JSONObject? {
        for (c in listOf(f, File(f.path + ".bak"))) {
            if (!c.isFile) continue
            runCatching { return JSONObject(c.readText()) }
        }
        return null
    }

    private fun write(f: File, o: JSONObject) {
        val tmp = File(f.path + ".tmp")
        tmp.writeText(o.toString())
        if (f.isFile) f.copyTo(File(f.path + ".bak"), overwrite = true)
        if (!tmp.renameTo(f)) { f.delete(); tmp.renameTo(f) }
    }

    companion object {
        /** A node's reported values as JSON: maps with number keys become objects, lists arrays. */
        fun snapshotTo(n: MatterNode): JSONObject {
            val o = JSONObject()
            n.forEach { (ep, clusters) ->
                val c = JSONObject()
                clusters.forEach { (cl, attrs) ->
                    val a = JSONObject()
                    attrs.forEach { (at, v) -> a.put(at.toString(), toJson(v)) }
                    c.put(cl.toString(), a)
                }
                o.put(ep.toString(), c)
            }
            return o
        }

        fun snapshotFrom(o: JSONObject?): MatterNode {
            if (o == null) return emptyMap()
            val out = LinkedHashMap<Int, Map<Long, Map<Long, Any?>>>()
            o.keys().forEach { ep ->
                val c = o.optJSONObject(ep) ?: return@forEach
                val cls = LinkedHashMap<Long, Map<Long, Any?>>()
                c.keys().forEach { cl ->
                    val a = c.optJSONObject(cl) ?: return@forEach
                    cls[cl.toLong()] = a.keys().asSequence().associate { it.toLong() to fromJson(a.opt(it)) }
                }
                ep.toIntOrNull()?.let { out[it] = cls }
            }
            return out
        }

        private fun toJson(v: Any?): Any = when (v) {
            null -> JSONObject.NULL
            is Map<*, *> -> JSONObject().apply { v.forEach { (k, x) -> put(k.toString(), toJson(x)) } }
            is List<*> -> JSONArray().apply { v.forEach { put(toJson(it)) } }
            else -> v
        }

        private fun fromJson(v: Any?): Any? = when (v) {
            null, JSONObject.NULL -> null
            is JSONObject -> v.keys().asSequence().associate { (it.toLongOrNull() ?: 0L) to fromJson(v.opt(it)) }
            is JSONArray -> (0 until v.length()).map { fromJson(v.opt(it)) }
            is Int -> v.toLong()
            else -> v
        }
    }
}
