package dev.couchtv.ontv.matter

import android.os.Handler
import android.os.Looper
import android.util.Log
import chip.platform.ChipMdnsCallback
import chip.platform.ServiceResolver
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Finds a device's address for the controller (DNS-SD "resolve"). It asks [delegate] first (Android's
 * NsdManager, or the IPv6 fallback from the discovery module, see [Matter.resolverFactory]); if that
 * has not answered after [graceMs], or answers with nothing, it answers with the address the device
 * last answered on ([lastKnown], kept in nodes.json). Android 11's NsdManager often returns nothing for
 * a device it saw a minute ago, and a device on Thread keeps its address, so the last address is
 * usually right; if it is not, the connection fails and the controller asks again.
 *
 * The controller's callback is answered exactly once per resolve.
 */
class MatterResolver(
    private val delegate: ServiceResolver,
    private val lastKnown: (instanceName: String) -> Pair<String, Int>?,
    private val graceMs: Long = 4000,
) : ServiceResolver {
    private val main = Handler(Looper.getMainLooper())

    override fun resolve(instanceName: String, serviceType: String, callbackHandle: Long, contextHandle: Long, chipMdnsCallback: ChipMdnsCallback) {
        val done = AtomicBoolean(false)
        val cached = if (serviceType.startsWith("_matter._tcp")) lastKnown(instanceName) else null
        fun fromCache(why: String): Boolean {
            if (cached == null || !done.compareAndSet(false, true)) return false
            Log.i(TAG, "resolve $instanceName: $why, using the last address ${cached.first}")
            // the library copies the host name and reads the text entries: neither may be null
            chipMdnsCallback.handleServiceResolve(instanceName, serviceType, cached.first, cached.first, cached.second, HashMap(), callbackHandle, contextHandle)
            return true
        }
        val wrapped = object : ChipMdnsCallback {
            override fun handleServiceResolve(name: String?, type: String?, host: String?, address: String?, port: Int, txt: MutableMap<String, ByteArray>?, cb: Long, ctx: Long) {
                if (address == null && fromCache("not found on the network")) return
                // with an address the library copies the host name and reads the text entries: never null then
                if (done.compareAndSet(false, true)) chipMdnsCallback.handleServiceResolve(name, type,
                    if (address != null) host ?: address else host, address, port, if (address != null) txt ?: HashMap() else txt, cb, ctx)
            }
            override fun handleServiceBrowse(names: Array<out String>?, type: String?, cb: Long, ctx: Long) =
                chipMdnsCallback.handleServiceBrowse(names, type, cb, ctx)
        }
        if (cached != null) main.postDelayed({ fromCache("no answer in ${graceMs / 1000} s") }, graceMs)
        delegate.resolve(instanceName, serviceType, callbackHandle, contextHandle, wrapped)
    }

    override fun publish(serviceName: String?, hostName: String?, type: String?, port: Int, keys: Array<out String>?, datas: Array<out ByteArray>?, subTypes: Array<out String>?) =
        delegate.publish(serviceName, hostName, type, port, keys, datas, subTypes)

    override fun removeServices() = delegate.removeServices()

    companion object { private const val TAG = "couchtv.matter" }
}
