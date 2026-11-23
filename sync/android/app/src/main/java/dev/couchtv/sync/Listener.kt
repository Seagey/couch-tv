package dev.couchtv.sync

import android.os.SystemClock
import android.service.notification.NotificationListenerService
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.nio.ByteBuffer

/**
 * Two jobs.
 *
 * 1. Being an enabled notification listener is what lets CmdReceiver ask MediaSessionManager for
 *    other apps' media sessions. The service does nothing for notifications.
 * 2. A tiny UDP clock server, so the computer can measure this TV's SystemClock.elapsedRealtime
 *    much more precisely than `adb shell cat /proc/uptime` allows (10 ms resolution, a process
 *    started per read). Ask: send any 8 bytes. Reply: those 8 bytes, then elapsedRealtimeNanos when
 *    the request arrived, then elapsedRealtimeNanos when the reply left (3 x 8 bytes, big endian).
 *    It reveals only the TV's uptime.
 */
class Listener : NotificationListenerService() {
    private var socket: DatagramSocket? = null

    override fun onCreate() {
        super.onCreate()
        if (socket != null) return
        val s = try { DatagramSocket(PORT) } catch (e: Exception) { return }
        socket = s
        Thread({
            android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_URGENT_AUDIO)
            val buf = ByteArray(64)
            while (!s.isClosed) {
                try {
                    val p = DatagramPacket(buf, buf.size)
                    s.receive(p)
                    val rx = SystemClock.elapsedRealtimeNanos()
                    if (p.length < 8) continue
                    val out = ByteBuffer.allocate(24)
                    out.put(buf, 0, 8).putLong(rx).putLong(SystemClock.elapsedRealtimeNanos())
                    s.send(DatagramPacket(out.array(), 24, p.socketAddress))
                } catch (e: Exception) { /* socket closed, or a bad packet: carry on */ }
            }
        }, "clock-udp").start()
    }

    override fun onDestroy() {
        socket?.close(); socket = null
        super.onDestroy()
    }

    companion object { const val PORT = 5417 }
}
