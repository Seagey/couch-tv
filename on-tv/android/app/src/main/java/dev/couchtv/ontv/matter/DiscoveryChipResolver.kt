package dev.couchtv.ontv.matter

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import chip.platform.ChipMdnsCallback
import chip.platform.NsdManagerServiceResolver
import chip.platform.ServiceResolver
import java.net.InetAddress
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/**
 * The Matter controller's resolver (chip.platform.ServiceResolver) with the IPv6 fallback: for each
 * resolve it runs Android's NsdManager (the library's own NsdManagerServiceResolver) and our own
 * mDNS reader ([MatterDiscovery.resolveInstance]) side by side, and answers once, with the first
 * address either finds. Ours picks the address with [DiscoveryModel.controllerOrder]: IPv4, then an
 * IPv6 address the TV has a route to, so a Thread device (IPv6 only) still gets an address on
 * Android 11 to 13, where NsdManager only gives IPv4. A failure from one side waits for the other.
 *
 * Needs the controller jars (on-tv/android/matter/libs, branch nl-matter-android). Hook it up once,
 * before the first Matter call (App.onCreate): `DiscoveryChipResolver.install(this)`.
 */
class DiscoveryChipResolver(
    context: Context,
    private val discovery: MatterDiscovery = MatterDiscovery(context) { Log.d(TAG, it) },
    private val nsd: ServiceResolver = NsdManagerServiceResolver(context, NsdManagerServiceResolver.NsdManagerResolverAvailState()),
    private val ourWaitMs: Long = 3000,
) : ServiceResolver {
    private val main = Handler(Looper.getMainLooper())
    private val pool = Executors.newCachedThreadPool { r -> Thread(r, "matter-resolve").apply { isDaemon = true } }

    private class Answer(val host: String?, val address: String?, val port: Int, val txt: Map<String, ByteArray>?)

    override fun resolve(instanceName: String, serviceType: String, callbackHandle: Long, contextHandle: Long, chipMdnsCallback: ChipMdnsCallback) {
        val done = AtomicBoolean(false)
        val nsdAnswer = AtomicReference<Answer?>(null)
        val oursFinished = AtomicBoolean(false)
        val nsdFinished = AtomicBoolean(false)

        fun answer(a: Answer?, from: String) {
            if (!done.compareAndSet(false, true)) return
            Log.i(TAG, "resolve $instanceName ($serviceType): ${a?.address ?: "nothing"} from $from")
            main.post {
                chipMdnsCallback.handleServiceResolve(instanceName, serviceType, a?.host, a?.address, a?.port ?: 0, a?.txt, callbackHandle, contextHandle)
            }
        }

        // The controller waits for exactly one answer: never leave it waiting if both sides go quiet.
        main.postDelayed({ answer(nsdAnswer.get()?.takeIf { it.address != null }, "timeout") }, ourWaitMs + 8000)

        nsd.resolve(instanceName, serviceType, callbackHandle, contextHandle, object : ChipMdnsCallback {
            override fun handleServiceResolve(name: String?, type: String?, host: String?, address: String?, port: Int, txt: MutableMap<String, ByteArray>?, cb: Long, ctx: Long) {
                val a = Answer(host, address, port, txt)
                nsdAnswer.set(a)
                nsdFinished.set(true)
                if (address != null) answer(a, "NsdManager")
                else if (oursFinished.get()) answer(null, "neither")
            }
            override fun handleServiceBrowse(names: Array<out String>?, type: String?, cb: Long, ctx: Long) =
                chipMdnsCallback.handleServiceBrowse(names, type, cb, ctx)
        })

        pool.execute {
            val node = try { discovery.resolveInstance(instanceName, serviceType, ourWaitMs) } catch (e: Exception) { Log.w(TAG, "mdns resolve", e); null }
            val best = node?.let { n -> DiscoveryModel.controllerOrder(n) { b -> discovery.canReach(InetAddress.getByAddress(b)) }.firstOrNull() }
            oursFinished.set(true)
            when {
                node != null && best != null -> answer(Answer(node.host, best, node.port ?: 0, node.txt), "mdns")
                nsdFinished.get() -> answer(nsdAnswer.get()?.takeIf { it.address != null }, "neither")
                // else: NsdManager is still working; its answer (or its own timeout) finishes it.
            }
        }
    }

    override fun publish(serviceName: String?, hostName: String?, type: String?, port: Int, keys: Array<out String>?, datas: Array<out ByteArray>?, subTypes: Array<out String>?) =
        nsd.publish(serviceName, hostName, type, port, keys, datas, subTypes)

    override fun removeServices() = nsd.removeServices()

    companion object {
        private const val TAG = "couchtv.matter"

        /** Sets Matter.resolverFactory and Matter.threadRouteCheck. Call once at app start. */
        fun install(context: Context) {
            val app = context.applicationContext
            val discovery = MatterDiscovery(app) { Log.d(TAG, it) }
            Matter.resolverFactory = { c -> DiscoveryChipResolver(c, discovery) }
            Matter.threadRouteCheck = { a -> discovery.canReach(a) }
        }
    }
}
