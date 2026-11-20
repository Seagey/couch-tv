package dev.couchtv.ontv

import org.json.JSONObject

/**
 * The home's whole Home settings copy against the server's, when the home's is older (its "seen" is not
 * the server's "updated"): the keys the phone's Home settings page changes are the server's, present or
 * not. So a town or photo the phone added stays, and one the phone took away does not come back.
 */
object SettingsMerge {
    /** Home settings keys the phone's page changes (the town; photos through /api/photos). */
    val PHONE_KEYS = listOf("place", "photos")

    fun keepServer(incoming: JSONObject, server: JSONObject?): JSONObject {
        if (server == null) return incoming
        for (k in PHONE_KEYS) if (server.has(k)) incoming.put(k, server.get(k)) else incoming.remove(k)
        return incoming
    }
}
