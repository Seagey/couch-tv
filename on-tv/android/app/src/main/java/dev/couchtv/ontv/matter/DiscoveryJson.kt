package dev.couchtv.ontv.matter

import org.json.JSONArray
import org.json.JSONObject

/**
 * Discovery results as JSON, for Server.kt (for example a GET /api/matter/discover the phone page or
 * a support screen can show). Field names are lower camel case like the rest of the on-TV API.
 */
object DiscoveryJson {
    fun node(n: DiscoveryModel.Node): JSONObject = JSONObject().apply {
        put("kind", if (n.kind == DiscoveryModel.Kind.COMMISSIONABLE) "commissionable" else "operational")
        put("instance", n.instance)
        n.name?.let { put("name", it) }
        n.discriminator?.let { put("discriminator", it) }
        n.vendorId?.let { put("vendorId", it) }
        n.productId?.let { put("productId", it) }
        n.deviceType?.let { put("deviceType", it) }
        n.commissioningMode?.let { put("commissioningMode", it) }
        n.compressedFabricId?.let { put("compressedFabricId", it) }
        n.nodeId?.let { put("nodeId", java.lang.Long.toUnsignedString(it)) }
        n.host?.let { put("host", it) }
        n.port?.let { put("port", it) }
        put("ipv4", JSONArray(n.ipv4))
        put("ipv6", JSONArray(n.ipv6))
        put("onThread", n.onThread)
        put("sources", JSONArray(n.sources.sorted()))
    }

    fun borderRouter(b: DiscoveryModel.BorderRouter): JSONObject = JSONObject().apply {
        put("name", b.label)
        b.vendor?.let { put("vendor", it) }
        b.model?.let { put("model", it) }
        b.networkName?.let { put("network", it) }
        b.extPanId?.let { put("extPanId", it) }
        b.threadPrefix?.let { put("threadPrefix", it) }
        put("ipv4", JSONArray(b.ipv4))
        put("ipv6", JSONArray(b.ipv6))
    }

    fun diagnosis(d: DiscoveryRoutes.Diagnosis): JSONObject = JSONObject().apply {
        put("code", d.code)
        put("ok", d.ok)
        put("words", d.words)
        put("borderRouters", JSONArray(d.borderRouters))
        put("threadPrefixes", JSONArray(d.threadPrefixes))
        put("reachablePrefixes", JSONArray(d.reachablePrefixes))
    }

    fun result(nodes: List<DiscoveryModel.Node>, routers: List<DiscoveryModel.BorderRouter>, diag: DiscoveryRoutes.Diagnosis): JSONObject =
        JSONObject().apply {
            put("devices", JSONArray(nodes.map(::node)))
            put("borderRouters", JSONArray(routers.map(::borderRouter)))
            put("thread", diagnosis(diag))
        }
}
