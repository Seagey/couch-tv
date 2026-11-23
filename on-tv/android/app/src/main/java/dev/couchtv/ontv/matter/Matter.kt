package dev.couchtv.ontv.matter

import android.content.Context
import android.util.Log
import chip.devicecontroller.AttestationInfo
import chip.devicecontroller.AttestationTrustStoreDelegate
import chip.devicecontroller.ChipDeviceController
import chip.devicecontroller.CommissionParameters
import chip.devicecontroller.ControllerParams
import chip.devicecontroller.DeviceAttestation
import chip.devicecontroller.DeviceAttestationDelegate
import chip.devicecontroller.GetConnectedDeviceCallbackJni.GetConnectedDeviceCallback
import chip.devicecontroller.ICDDeviceInfo
import chip.devicecontroller.InvokeCallback
import chip.devicecontroller.ReportCallback
import chip.devicecontroller.ResubscriptionAttemptCallback
import chip.devicecontroller.SubscriptionEstablishedCallback
import chip.devicecontroller.UnpairDeviceCallback
import chip.devicecontroller.WriteAttributesCallback
import chip.devicecontroller.model.AttributeWriteRequest
import chip.devicecontroller.model.ChipAttributePath
import chip.devicecontroller.model.ChipEventPath
import chip.devicecontroller.model.ChipPathId
import chip.devicecontroller.model.InvokeElement
import chip.devicecontroller.model.NodeState
import chip.devicecontroller.model.Status
import chip.platform.AndroidBleManager
import chip.platform.AndroidChipPlatform
import chip.platform.AndroidNfcCommissioningManager
import chip.platform.ChipMdnsCallbackImpl
import chip.platform.DiagnosticDataProviderImpl
import chip.platform.NsdManagerServiceBrowser
import chip.platform.NsdManagerServiceResolver
import chip.platform.PreferencesConfigurationManager
import chip.platform.PreferencesKeyValueStoreManager
import chip.platform.ServiceResolver
import matter.onboardingpayload.OnboardingPayloadParser
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.Inet6Address
import java.net.InetAddress
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

/**
 * The Matter controller inside the on-TV app (matter-contract.md). The TV joins the person's
 * devices as one more Matter controller (multi-admin "share"): the home app they already use gives
 * a pairing code, the phone page sends it here, and the TV commissions the device onto its own
 * fabric. The device stays in Google Home, Apple Home, SmartThings or Alexa as well.
 *
 * The controller library (connectedhomeip, Apache 2.0) is loaded only when Matter is first used,
 * or at start when devices were added before, so a TV with no Matter devices never loads it.
 *
 * Keys: the fabric's root key and certificate live in the library's own key store (Android
 * preferences "chip.platform.KeyValueStore", app private), copied to files/matter/fabric.json after
 * every change and put back from there if the preferences are ever lost (see [restoreFabric]).
 */
object Matter {
    private const val TAG = "couchtv.matter"
    private const val VENDOR_ID = 0xFFF4           // the test vendor id; devices accept any vendor id for an extra admin
    private const val KV_PREFS = "chip.platform.KeyValueStore"
    // the contract wants an answer within 120 s; a code no device answers to never ends by itself
    // (discovery keeps looking), and a phone page gives up long before 4 minutes. One deadline for
    // every stage together (pairing, then the first report).
    private const val COMMISSION_TIMEOUT_S = 110L
    private const val COMMAND_TIMEOUT_S = 20L

    /** The discovery module (matter-discovery) can supply its own resolver (IPv6 fallback for Android 11). */
    @Volatile var resolverFactory: ((Context) -> ServiceResolver)? = null
    /** The discovery module's "is there a route to this Thread address" check; null means "assume yes". */
    @Volatile var threadRouteCheck: ((InetAddress) -> Boolean)? = null

    private lateinit var ctx: Context
    lateinit var store: MatterStore; private set
    private var controller: ChipDeviceController? = null
    @Volatile var ready = false; private set
    @Volatile var note: String? = null; private set
    /** Why Matter can never run on this TV (Android 6, or an Intel processor), decided at [init]; null = it can. */
    @Volatile var unsupported: String? = null; private set
    /** Why the controller did not start ("processor": the library would not load; "not_started"), else null. */
    @Volatile private var startFailed: String? = null
    private val io = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "matter").apply { isDaemon = true } }

    // live state
    private val nodes = ConcurrentHashMap<Long, MatterStore.Saved>()
    private val live = ConcurrentHashMap<Long, MutableMap<Int, MutableMap<Long, MutableMap<Long, Any?>>>>()
    private val reachable = ConcurrentHashMap<Long, Boolean>()
    private val retries = ConcurrentHashMap<Long, ScheduledFuture<*>>()
    private val version = AtomicLong(1)
    private val listeners = CopyOnWriteArraySet<(Long) -> Unit>()
    private var saveSoon: ScheduledFuture<*>? = null
    private var pushSoon: ScheduledFuture<*>? = null

    fun listen(fn: (Long) -> Unit) = listeners.add(fn)
    fun unlisten(fn: (Long) -> Unit) = listeners.remove(fn)
    fun version() = version.get()

    /** At app start: only if devices were added before (no library load otherwise). */
    fun init(c: Context) {
        ctx = c.applicationContext
        unsupported = MatterSupport.check(ctx)
        note = unsupported
        store = MatterStore(File(ctx.filesDir, "matter"))
        store.nodes().forEach { nodes[it.node] = it; live[it.node] = deepCopy(it.snapshot); reachable[it.node] = false }
        if (nodes.isNotEmpty()) io.execute { start() }
    }

    /** Loads the library and makes the controller, once. False (and [note] says why) if it can't. */
    @Synchronized fun start(): Boolean {
        if (controller != null) return true
        // Android 6 or an Intel TV: never load the library (on Android 6 it would fail to link)
        unsupported?.let { note = it; return false }
        try {
            ChipDeviceController.loadJni()
        } catch (e: Throwable) {
            Log.w(TAG, "no controller library", e)
            note = MatterSupport.NOTE_PROCESSOR; startFailed = "processor"
            return false
        }
        try {
            restoreFabric()
            val nsd = resolverFactory?.invoke(ctx) ?: NsdManagerServiceResolver(ctx, NsdManagerServiceResolver.NsdManagerResolverAvailState())
            AndroidChipPlatform(AndroidBleManager(ctx), AndroidNfcCommissioningManager(), PreferencesKeyValueStoreManager(ctx),
                PreferencesConfigurationManager(ctx), MatterResolver(nsd, ::lastAddress), NsdManagerServiceBrowser(ctx),
                ChipMdnsCallbackImpl(), DiagnosticDataProviderImpl(ctx))
            val c = ChipDeviceController(ControllerParams.newBuilder().setControllerVendorId(VENDOR_ID).setFabricId(1L)
                .setEnableServerInteractions(false).build())
            c.setCompletionListener(Completion)
            val paa = loadPaa()
            c.setAttestationTrustStoreDelegate(object : AttestationTrustStoreDelegate {
                override fun getProductAttestationAuthorityCert(skid: ByteArray): ByteArray? =
                    paa.firstOrNull { java.util.Arrays.equals(DeviceAttestation.extractSkidFromPaaCert(it), skid) }
            })
            // The device is already in the person's own home app, which checked it when it was first
            // added. A device whose maker is missing from the bundled list still joins; the log says so.
            c.setDeviceAttestationDelegate(600, DeviceAttestationDelegate { ptr, _: AttestationInfo?, err ->
                if (err != 0L) Log.w(TAG, "attestation not verified (0x${err.toString(16)}); continuing, the device is already in the person's home")
                // never from inside the callback: it runs on the Matter thread, which then waits forever
                io.execute { c.continueCommissioning(ptr, true) }
            })
            controller = c
            ready = true; note = null; startFailed = null
            backupFabric()
            nodes.keys.forEach { subscribe(it, 0) }
            Log.i(TAG, "controller ready, ${nodes.size} devices, ${paa.size} PAA roots")
            return true
        } catch (e: Throwable) {
            Log.w(TAG, "controller start failed", e)
            note = "Matter could not start on this TV."; startFailed = "not_started"
            return false
        }
    }

    private fun loadPaa(): List<ByteArray> = runCatching {
        ctx.assets.list("matter-paa").orEmpty().filter { it.endsWith(".der") }.map { n -> ctx.assets.open("matter-paa/$n").use { it.readBytes() } }
    }.getOrDefault(emptyList())

    // ---------------------------------------------------------------- fabric key store backup

    private fun kvPrefs() = ctx.getSharedPreferences(KV_PREFS, Context.MODE_PRIVATE)

    /** Copies the library's key store to files/matter/fabric.json (only when it changed). */
    fun backupFabric() {
        val kv = kvPrefs().all.mapNotNull { (k, v) -> (v as? String)?.let { k to it } }.toMap()
        if (kv.isNotEmpty() && kv != store.fabric()) store.saveFabric(kv)
    }

    /** The key store is empty but a copy exists (preferences lost or damaged): put it back before the library reads it. */
    private fun restoreFabric() {
        val p = kvPrefs()
        if (p.all.isNotEmpty()) return
        val saved = store.fabric()
        if (saved.isEmpty()) return
        p.edit().apply { saved.forEach { (k, v) -> putString(k, v) } }.commit()
        Log.w(TAG, "the Matter key store was empty; put back ${saved.size} entries from fabric.json")
    }

    // ---------------------------------------------------------------- the API (matter-contract.md)

    /** GET /api/matter/devices */
    fun devicesJson(): JSONObject {
        val list = JSONArray()
        nodes.values.sortedBy { it.added }.forEach { s ->
            MatterModel.devices(s.node, snapshot(s.node), reachable[s.node] == true, s.names).forEach { list.put(it) }
        }
        val o = JSONObject().put("devices", list).put("ready", MatterSupport.ready(unsupported, ready, nodes.isEmpty(), note)).put("version", version.get())
        val n = note ?: if (nodes.isNotEmpty() && !ready) "Starting Matter. Your devices show in a moment." else null
        if (n != null) o.put("note", n)
        reasonKey()?.let { o.put("reason", it) }
        return o
    }

    /** Why Matter is not ready, as a key the screens word in every language (contract change 14). */
    private fun reasonKey(): String? = MatterSupport.reason(unsupported) ?: startFailed
        ?: if (nodes.isNotEmpty() && !ready) "starting" else null

    private fun snapshot(node: Long): MatterNode = live[node]?.let { deepCopy(it) } ?: emptyMap()

    // ---- commissioning

    private val Completion = object : ChipDeviceController.CompletionListener {
        override fun onConnectDeviceComplete() {}
        override fun onStatusUpdate(status: Int) {}
        override fun onPairingComplete(errorCode: Long) { if (errorCode != 0L) pending?.fail("SecurePairing", errorCode) }
        override fun onPairingDeleted(errorCode: Long) {}
        override fun onCommissioningComplete(nodeId: Long, errorCode: Long) {
            val p = pending ?: return
            if (errorCode == 0L) p.succeed() else p.fail(p.stage, errorCode)
        }
        override fun onReadCommissioningInfo(vendorId: Int, productId: Int, wifiEndpointId: Int, threadEndpointId: Int) { pending?.thread = threadEndpointId in 0..0xFFFE && wifiEndpointId !in 0..0xFFFE }
        override fun onCommissioningStatusUpdate(nodeId: Long, stage: String?, errorCode: Long) { if (errorCode != 0L) pending?.lastErrorStage = stage }
        override fun onCommissioningStageStart(nodeId: Long, stage: String?) { pending?.stage = stage }
        override fun onNotifyChipConnectionClosed() {}
        override fun onCloseBleComplete() {}
        override fun onError(error: Throwable?) { Log.w(TAG, "controller error", error); pending?.fail(pending?.stage, MatterCode.ERR_TIMEOUT) }
        override fun onOpCSRGenerationComplete(csr: ByteArray?) {}
        override fun onICDRegistrationInfoRequired() {}
        override fun onICDRegistrationComplete(errorCode: Long, icdDeviceInfo: ICDDeviceInfo?) {}
    }

    private class Pending(val node: Long) {
        @Volatile var stage: String? = null
        @Volatile var lastErrorStage: String? = null
        @Volatile var thread = false
        @Volatile var error: Long? = null
        @Volatile var errorStage: String? = null
        val done = CountDownLatch(1)
        fun succeed() { error = 0L; done.countDown() }
        fun fail(stage: String?, code: Long) { if (error == null) { errorStage = lastErrorStage ?: stage; error = code }; done.countDown() }
    }
    @Volatile private var pending: Pending? = null
    private val primedWaits = ConcurrentHashMap<Long, CountDownLatch>()
    /** While commissioning with an address: (node, address) for [lastAddress]. */
    @Volatile private var hint: Pair<Long, Pair<String, Int>>? = null
    private val commissionLock = java.util.concurrent.locks.ReentrantLock()

    /**
     * POST /api/matter/commission { code, address? }. [address] ("host", "host:port" or "[v6]:port",
     * number addresses only) skips network discovery: for a device the TV can't find by itself, and for
     * tests on an emulator. One at a time: a second one while the first runs answers at once ("busy").
     * Every answer comes within [COMMISSION_TIMEOUT_S] seconds, all stages together.
     */
    fun commission(code: String?, address: String? = null): JSONObject {
        val parsed = MatterCode.parse(code)
        if (parsed is MatterCode.Parsed.Bad) return fail(parsed.key, parsed.note)
        val at = if (address.isNullOrBlank()) null else MatterCode.address(address)
        if (at?.reason != null) return fail("unreachable", at.note!!).put("reason", at.reason)
        if (!commissionLock.tryLock()) return fail("busy", "The TV is adding another device right now. Try again in a minute.").put("reason", "busy")
        try { return commissionLocked(parsed, at) } finally { commissionLock.unlock() }
    }

    private fun commissionLocked(parsed: MatterCode.Parsed, at: MatterCode.Address?): JSONObject {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(COMMISSION_TIMEOUT_S)
        fun left() = maxOf(0L, TimeUnit.NANOSECONDS.toMillis(deadline - System.nanoTime()))
        if (!start()) return (if (unsupported != null) "unsupported" else "unreachable").let { k ->
            JSONObject().put("ok", false).put("error", k).put("note", note).put("device_ids", JSONArray()).put("reason", reasonKey() ?: k) }
        val c = controller!!
        val text = when (parsed) { is MatterCode.Parsed.Manual -> parsed.digits; is MatterCode.Parsed.Qr -> parsed.text; else -> "" }
        val node = store.nextNodeId()
        val p = Pending(node); pending = p
        try {
            val params = CommissionParameters.Builder().build()
            try {
                if (at != null) {
                    val payload = runCatching {
                        if (parsed is MatterCode.Parsed.Qr) OnboardingPayloadParser().parseQrCode(text) else OnboardingPayloadParser().parseManualPairingCode(text)
                    }.getOrElse { return fail("wrong_code", MatterCode.NOTES["wrong_code"]!!) }
                    hint = node to (at.host to at.port)   // the device keeps this address once it joins: find it there too
                    val disc = if (payload.hasShortDiscriminator) payload.getShortDiscriminatorValue() else payload.getLongDiscriminatorValue()
                    c.pairDeviceWithAddress(node, at.host, at.port, disc, payload.setupPinCode, params)
                } else {
                    c.pairDeviceWithCode(node, text, false, true, params)
                }
            } catch (e: Exception) {
                // the controller refused to start pairing at all: plain words, never its own error text
                Log.w(TAG, "pairing node $node did not start", e)
                runCatching { c.stopDevicePairing(node) }
                return fail("unreachable", MatterCode.NOTES["unreachable"]!!)
            }
            if (!p.done.await(left(), TimeUnit.MILLISECONDS)) p.fail(p.stage, MatterCode.ERR_TIMEOUT)
            if (p.error != 0L) {
                runCatching { c.stopDevicePairing(node) }
                val addr = runCatching { c.getNetworkLocation(node)?.ipAddress }.getOrNull()
                val ip = addr?.let { runCatching { InetAddress.getByName(it.substringBefore('%')) }.getOrNull() }
                val thread = p.thread || (ip is Inet6Address && !ip.isLinkLocalAddress && ip.address[0].toInt() and 0xfe == 0xfc)
                val route = ip?.let { a -> threadRouteCheck?.invoke(a) } ?: true
                val (key, reason) = MatterCode.commissionFailure(MatterCode.failureKey(p.errorStage, p.error ?: MatterCode.ERR_TIMEOUT, thread, route), at != null)
                Log.w(TAG, "commission node $node failed at ${p.errorStage}: 0x${(p.error ?: 0).toString(16)} -> $key ($reason)")
                return MatterCode.failure(key, MatterCode.failureNote(key, reason), reason)
            }
            val loc = runCatching { c.getNetworkLocation(node) }.getOrNull()
            val saved = MatterStore.Saved(node, System.currentTimeMillis(), address = loc?.ipAddress?.takeIf { it.isNotEmpty() } ?: hint?.second?.first,
                port = loc?.port?.takeIf { it > 0 } ?: hint?.second?.second ?: 0)
            nodes[node] = saved; live[node] = HashMap(); reachable[node] = true
            persist()
            backupFabric()
            // the first report names the device and says what it is (a few seconds)
            // the subscription is set up once every value has been reported once (a few seconds)
            val first = CountDownLatch(1)
            primedWaits[node] = first
            subscribe(node, 0)
            first.await(minOf(30_000L, left()), TimeUnit.MILLISECONDS)
            primedWaits.remove(node)
            val ids = JSONArray()
            MatterModel.devices(node, snapshot(node), true, saved.names).forEach { ids.put(it.getString("id")) }
            Log.i(TAG, "commissioned node $node: $ids")
            if (ids.length() == 0 && snapshot(node).isNotEmpty()) {
                // a lock, an alarm or a garage door (or nothing the TV can show): the TV leaves it again
                leave(node)
                return fail("not_allowed", "That device is not something the TV shows (locks, alarms and garage doors never show), so the TV did not keep it.").put("reason", "blocked")
            }
            changed()
            return JSONObject().put("ok", true).put("device_ids", ids)
        } finally { pending = null; hint = null }
    }

    // every refusal carries a reason (the key itself unless the caller puts a more specific one after)
    private fun fail(key: String, note: String) = MatterCode.failure(key, note)

    // ---- subscriptions (live state)

    private fun subscribe(node: Long, attempt: Int) {
        val c = controller ?: return
        retries.remove(node)?.cancel(false)
        c.getConnectedDevicePointer(node, object : GetConnectedDeviceCallback {
            override fun onDeviceConnected(ptr: Long) {
                io.execute { subscribeOn(c, node, ptr, attempt) }
            }
            override fun onConnectionFailure(nodeId: Long, error: Exception) {
                Log.w(TAG, "node $node not reachable: ${error.message}")
                setReachable(node, false); retry(node, attempt + 1)
            }
        })
    }

    // off the Matter thread: calling the controller from its own callback waits forever
    private fun subscribeOn(c: ChipDeviceController, node: Long, ptr: Long, attempt: Int) {
        val paths = listOf(ChipAttributePath.newInstance(ChipPathId.forWildcard(), ChipPathId.forWildcard(), ChipPathId.forWildcard()))
        c.subscribeToPath(SubscriptionEstablishedCallback { id -> Log.i(TAG, "node $node subscribed ($id)"); setReachable(node, true); primed(node) },
            ResubscriptionAttemptCallback { cause, next -> Log.i(TAG, "node $node resubscribing in $next ms (0x${cause.toString(16)})"); setReachable(node, false) },
            object : ReportCallback {
                override fun onError(attributePath: ChipAttributePath?, eventPath: ChipEventPath?, e: Exception) {
                    if (attributePath == null && eventPath == null) { Log.w(TAG, "node $node subscription failed", e); setReachable(node, false); retry(node, attempt + 1) }
                }
                override fun onReport(nodeState: NodeState) { merge(node, nodeState) }
            }, ptr, paths, emptyList(), 1, 60, true, false, 0)
    }

    private val checked = ConcurrentHashMap.newKeySet<Long>()

    /**
     * Every value of a node has been reported once. While it is being added, the commission call
     * decides. Otherwise (the first report came after commission stopped waiting, or after a restart):
     * a node that shows nothing on the TV (a slow lock, alarm or garage door) is left at once.
     */
    private fun primed(node: Long) {
        primedWaits[node]?.let { it.countDown(); checked.add(node); return }
        if (!checked.add(node)) return
        val s = nodes[node] ?: return
        if (MatterModel.devices(node, snapshot(node), true, s.names).isEmpty()) {
            Log.w(TAG, "node $node shows nothing on the TV (a lock, an alarm, a garage door or an unknown kind): leaving it")
            io.execute { leave(node) }
        }
    }

    private fun retry(node: Long, attempt: Int) {
        if (!nodes.containsKey(node)) return
        val delay = minOf(300L, 15L shl minOf(attempt, 5))   // 30 s, 60 s ... up to 5 minutes
        retries[node] = io.schedule({ subscribe(node, attempt) }, delay, TimeUnit.SECONDS)
    }

    private fun setReachable(node: Long, r: Boolean) { if (reachable.put(node, r) != r) changed() }

    private fun merge(node: Long, ns: NodeState) {
        if (!nodes.containsKey(node)) return
        val snap = live.getOrPut(node) { HashMap() }
        var any = false
        synchronized(snap) {
            ns.endpointStates.forEach { (ep, es) ->
                es.clusterStates.forEach { (cl, cs) ->
                    val want = MatterModel.SUBSCRIBE[cl] ?: return@forEach
                    cs.attributeStates.forEach { (at, st) ->
                        if (at in want) { snap.getOrPut(ep) { HashMap() }.getOrPut(cl) { HashMap() }[at] = MatterModel.valueOf(st.json); any = true }
                    }
                }
            }
        }
        reachable[node] = true
        if (any) { changed(); saveLater() }
    }

    private fun changed() {
        version.incrementAndGet()
        if (pushSoon?.isDone == false) return
        pushSoon = io.schedule({ val v = version.get(); listeners.forEach { runCatching { it(v) } } }, 250, TimeUnit.MILLISECONDS)
    }

    private fun saveLater() {
        if (saveSoon?.isDone == false) return
        saveSoon = io.schedule({ persist() }, 30, TimeUnit.SECONDS)
    }

    @Synchronized private fun persist() {
        val list = nodes.values.sortedBy { it.added }.map { s ->
            controller?.let { c -> runCatching { c.getNetworkLocation(s.node) }.getOrNull()?.let { l -> if (!l.ipAddress.isNullOrEmpty()) { s.address = l.ipAddress; s.port = l.port } } }
            s.snapshot = snapshot(s.node); s
        }
        store.save(list)
    }

    /** For [MatterResolver]: "<fabric>-<node>" (hex) to the node's last address. */
    private fun lastAddress(instance: String): Pair<String, Int>? {
        val node = runCatching { java.lang.Long.parseUnsignedLong(instance.substringAfter('-'), 16) }.getOrNull() ?: return null
        hint?.let { (n, a) -> if (n == node) return a }
        val s = nodes[node] ?: return null
        val a = s.address?.takeIf { it.isNotEmpty() } ?: return null
        return a to (if (s.port > 0) s.port else 5540)
    }

    // ---- commands

    /** A refused call: HTTP [status], plain words, and a [reason] key the screens word in every language. */
    class Refused(val status: Int, msg: String, val reason: String = when (status) {
        404 -> "not_found"; 403 -> "not_allowed"; 400 -> "bad_request"; 503 -> "not_ready"; 504 -> "not_answering"; 502 -> "device_refused"; else -> "failed"
    }) : Exception(msg)

    /** POST /api/matter/command { id, action, value? } */
    fun command(id: String, action: String, value: Any?): JSONObject {
        val (node, ep) = MatterModel.parseId(id) ?: throw Refused(404, "No Matter device with that id.")
        val saved = nodes[node] ?: throw Refused(404, "No Matter device with that id.")
        val epData = snapshot(node)[ep] ?: throw Refused(404, "No Matter device with that id.")
        val snap = snapshot(node)
        val domain = MatterModel.domainOf(epData, MatterModel.nameOf(snap, ep, null), MatterModel.nameOf(snap, ep, saved.names[id]))
            ?: throw Refused(403, "That device can't be controlled from the TV.")
        val steps = try { MatterModel.plan(domain, action, value, epData) } catch (e: MatterModel.BadCommand) { throw Refused(400, e.message ?: "bad command") }
        if (!start()) throw Refused(503, note ?: "Matter is not ready.", reasonKey() ?: "not_ready")
        val c = controller!!
        val ptr = connect(c, node)
        for (s in steps) {
            val latch = CountDownLatch(1); var err: Exception? = null
            when (s) {
                is MatterModel.Step.Invoke -> c.invoke(object : InvokeCallback {
                    override fun onError(e: Exception) { err = e; latch.countDown() }
                    override fun onResponse(el: InvokeElement?, successCode: Long) { latch.countDown() }
                }, ptr, InvokeElement.newInstance(ep, s.cluster, s.command, null, s.body), if (s.timed) 5000 else 0, 0)
                is MatterModel.Step.Write -> c.write(object : WriteAttributesCallback {
                    override fun onError(attributePath: ChipAttributePath?, e: Exception) { err = e; latch.countDown() }
                    override fun onResponse(attributePath: ChipAttributePath, status: Status) {
                        if (status.status != Status.Code.Success) err = Exception("status ${status.status}")
                        latch.countDown()
                    }
                }, ptr, listOf(AttributeWriteRequest.newInstance(ep, s.cluster, s.attribute, s.body)), 0, 0)
            }
            if (!latch.await(COMMAND_TIMEOUT_S, TimeUnit.SECONDS)) throw Refused(504, "The device did not answer. Check it is switched on.")
            err?.let { Log.w(TAG, "command $action on $id", it); throw Refused(502, "The device said no to that.") }
        }
        // read back what changed, so the answer carries the new state (the subscription follows anyway)
        readBack(c, ptr, node, ep, steps.map { when (it) { is MatterModel.Step.Invoke -> it.cluster; is MatterModel.Step.Write -> it.cluster } }.toSet())
        val dev = MatterModel.devices(node, snapshot(node), true, saved.names).firstOrNull { it.optString("id") == id }
        return JSONObject().put("ok", true).put("state", dev?.optString("state") ?: "unknown").put("device", dev ?: JSONObject.NULL)
    }

    private fun connect(c: ChipDeviceController, node: Long): Long {
        val latch = CountDownLatch(1); var ptr = 0L; var err: Exception? = null
        c.getConnectedDevicePointer(node, object : GetConnectedDeviceCallback {
            override fun onDeviceConnected(p: Long) { ptr = p; latch.countDown() }
            override fun onConnectionFailure(nodeId: Long, error: Exception) { err = error; latch.countDown() }
        })
        if (!latch.await(COMMAND_TIMEOUT_S, TimeUnit.SECONDS) || err != null || ptr == 0L) {
            setReachable(node, false)
            throw Refused(504, "The TV can't reach that device. Check it is switched on.")
        }
        return ptr
    }

    private fun readBack(c: ChipDeviceController, ptr: Long, node: Long, ep: Int, clusters: Set<Long>) {
        val paths = clusters.flatMap { cl -> listOf(cl) + (if (cl == MatterModel.LEVEL || cl == MatterModel.COLOR) listOf(MatterModel.ON_OFF) else emptyList()) }
            .distinct().map { ChipAttributePath.newInstance(ChipPathId.forId(ep.toLong()), ChipPathId.forId(it), ChipPathId.forWildcard()) }
        val latch = CountDownLatch(1)
        c.readPath(object : ReportCallback {
            override fun onError(attributePath: ChipAttributePath?, eventPath: ChipEventPath?, e: Exception) { if (attributePath == null) latch.countDown() }
            override fun onReport(nodeState: NodeState) { merge(node, nodeState) }
            override fun onDone() { latch.countDown() }
        }, ptr, paths, emptyList(), false, 0)
        latch.await(5, TimeUnit.SECONDS)
    }

    // ---- rename and remove

    /**
     * POST /api/matter/rename { id, name }: 1 to 40 characters, kept here. Only an id the TV shows;
     * never a name that would hide the device (a garage door, gate, door or lock: reason opens_house),
     * so a rename can neither bring a hidden device back nor make one vanish by mistake.
     */
    @Synchronized fun rename(id: String, name: String?): JSONObject {
        val (node, ep) = MatterModel.parseId(id) ?: throw Refused(404, "No Matter device with that id.")
        val s = nodes[node] ?: throw Refused(404, "No Matter device with that id.")
        val snap = snapshot(node)
        if (MatterModel.devices(node, snap, true, s.names).none { it.optString("id") == id }) throw Refused(404, "No Matter device with that id.")
        val n = MatterModel.cleanName(name)
        if (n.isEmpty() || n.length > 40) throw Refused(400, "A name is 1 to 40 characters.", "bad_name")
        val epData = snap[ep] ?: throw Refused(404, "No Matter device with that id.")
        val domain = MatterModel.domainOf(epData, MatterModel.nameOf(snap, ep, null))
        if (MatterModel.hiddenByName(domain, epData, n))
            throw Refused(400, "Couch TV never shows a garage door, gate, door or lock, so that name would hide this device. Pick another name.", "opens_house")
        s.names[id] = n
        persist(); changed()
        return JSONObject().put("ok", true).put("name", n)
    }

    /**
     * POST /api/matter/remove { id }: the TV leaves the device (it stays in the person's own home app).
     * A Matter device is one node, so every id of that node goes. If the device does not answer, the
     * TV forgets it anyway and says so.
     */
    fun remove(id: String): JSONObject {
        val (node, _) = MatterModel.parseId(id) ?: throw Refused(404, "No Matter device with that id.")
        if (!nodes.containsKey(node)) throw Refused(404, "No Matter device with that id.")
        val ids = JSONArray(); MatterModel.devices(node, snapshot(node), true, nodes[node]!!.names).forEach { ids.put(it.getString("id")) }
        val wasReachable = reachable[node] == true
        val left = leave(node)
        return JSONObject().put("ok", true).put("removed", ids).apply {
            if (!left) put("note", "The device did not answer, so the TV forgot it. It may still list the TV as a connected service; you can remove that in your home app.")
                .put("reason", if (wasReachable) "not_answering" else "offline")
        }
    }

    /** Takes the TV off the device's fabric and forgets it. True if the device confirmed. */
    private fun leave(node: Long): Boolean {
        var left = false
        // whatever the controller does (an exception included), the TV forgets the device below
        runCatching {
            if (start()) {
                val latch = CountDownLatch(1)
                controller!!.unpairDeviceCallback(node, object : UnpairDeviceCallback {
                    override fun onError(status: Int, remoteDeviceId: Long) { latch.countDown() }
                    override fun onSuccess(remoteDeviceId: Long) { left = true; latch.countDown() }
                })
                latch.await(COMMAND_TIMEOUT_S, TimeUnit.SECONDS)
            }
        }.onFailure { Log.w(TAG, "leaving node $node", it) }
        runCatching { controller?.let { it.shutdownSubscriptions(it.fabricIndex, node) } }
        retries.remove(node)?.cancel(false)
        nodes.remove(node); live.remove(node); reachable.remove(node)
        persist(); backupFabric(); changed()
        return left
    }

    @Suppress("UNCHECKED_CAST")
    private fun deepCopy(n: Map<Int, Map<Long, Map<Long, Any?>>>): MutableMap<Int, MutableMap<Long, MutableMap<Long, Any?>>> =
        synchronized(n) { n.mapValuesTo(HashMap()) { (_, c) -> c.mapValuesTo(HashMap()) { (_, a) -> HashMap(a) } } }
}
