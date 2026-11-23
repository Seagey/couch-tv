package app.couchtv.ha

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import java.net.Inet4Address
import java.net.URL
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/**
 * Finds Home Assistant on the home network by itself: Home Assistant announces
 * _home-assistant._tcp over zeroconf (mDNS), with its name and addresses in the TXT record
 * (location_name, internal_url, base_url). Only listens; asks nothing of anything it finds.
 */
object HaFind {
    class Found(val name: String, val url: String)

    /**
     * The address the TV should use, from what the announcement says. A TV usually cannot look up
     * homeassistant.local by name, so a name is swapped for the number address the announcement
     * resolved to, keeping the scheme and port. An https address with a real name stays as it is
     * (its certificate is for that name). Pure, for tests.
     */
    internal fun urlFrom(txt: Map<String, String>, ip: String?, port: Int): String? {
        val said = listOf("internal_url", "base_url").mapNotNull { k -> txt[k]?.trim()?.takeIf { it.isNotEmpty() } }
            .firstNotNullOfOrNull { HomeAssistant.cleanBase(it) }
        val u = said?.let { try { URL(it) } catch (e: Exception) { null } }
        if (u != null) {
            val literal = u.host.matches(Regex("[0-9.]+")) || u.host.contains(':')
            if (literal) return said
            if (u.protocol == "https") return said
            if (ip != null) return "http://$ip:" + (if (u.port > 0) u.port else port)
            return said
        }
        return ip?.let { "http://$it:$port" }
    }

    /** Looks for up to [ms] milliseconds, then stops. Blocking: call it off the main thread. */
    fun scan(ctx: Context, ms: Long = 5000): List<Found> {
        val nsd = ctx.applicationContext.getSystemService(Context.NSD_SERVICE) as? NsdManager ?: return emptyList()
        val seen = LinkedBlockingQueue<NsdServiceInfo>()
        val listener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(type: String) {}
            override fun onDiscoveryStopped(type: String) {}
            override fun onStartDiscoveryFailed(type: String, code: Int) {}
            override fun onStopDiscoveryFailed(type: String, code: Int) {}
            override fun onServiceFound(info: NsdServiceInfo) { seen.add(info) }
            override fun onServiceLost(info: NsdServiceInfo) {}
        }
        try { nsd.discoverServices("_home-assistant._tcp", NsdManager.PROTOCOL_DNS_SD, listener) } catch (e: Exception) { return emptyList() }
        val out = mutableListOf<Found>()
        val names = mutableSetOf<String>()
        val end = System.currentTimeMillis() + ms
        try {
            while (true) {
                val left = end - System.currentTimeMillis()
                if (left <= 0) break
                val info = seen.poll(left, TimeUnit.MILLISECONDS) ?: break
                if (!names.add(info.serviceName)) continue
                // one resolve at a time: older Android refuses a second while one is running
                val done = CountDownLatch(1)
                var got: NsdServiceInfo? = null
                try {
                    @Suppress("DEPRECATION")
                    nsd.resolveService(info, object : NsdManager.ResolveListener {
                        override fun onResolveFailed(i: NsdServiceInfo, code: Int) { done.countDown() }
                        override fun onServiceResolved(i: NsdServiceInfo) { got = i; done.countDown() }
                    })
                } catch (e: Exception) { done.countDown() }
                done.await(3, TimeUnit.SECONDS)
                val r = got ?: continue
                val txt = try { r.attributes.mapValues { (_, v) -> v?.let { String(it, Charsets.UTF_8) } ?: "" } } catch (e: Exception) { emptyMap() }
                @Suppress("DEPRECATION")
                val ip = r.host?.takeIf { it is Inet4Address }?.hostAddress
                val url = urlFrom(txt, ip, r.port) ?: continue
                if (out.any { it.url == url }) continue
                out.add(Found(txt["location_name"]?.trim()?.take(40)?.ifEmpty { null } ?: r.serviceName.take(40), url))
            }
        } finally {
            try { nsd.stopServiceDiscovery(listener) } catch (e: Exception) {}
        }
        return out
    }
}
