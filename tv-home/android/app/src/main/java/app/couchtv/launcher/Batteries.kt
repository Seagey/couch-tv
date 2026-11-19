package app.couchtv.launcher

import android.Manifest
import android.bluetooth.BluetoothClass
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject

/**
 * The Batteries widget (tv-home/web/widgets.js R.battery): the charge left in the remotes, game
 * controllers and headphones paired with this TV by Bluetooth. Android keeps the level each device
 * reports (the Bluetooth battery service, or the headset's own report) and hands it out through
 * BluetoothDevice.getBatteryLevel, which is public to apps as an SDK method on Android 8.1 and newer
 * (hidden from the SDK's stubs, so it is called by name; -1 means the device does not report one).
 *
 * Android 12 and newer ask for "Nearby devices" (BLUETOOTH_CONNECT) first: OK on the widget asks once
 * through Android's own question (or pm grant over ADB). Only the device's own name
 * and its level are read; nothing leaves the TV.
 */
object Batteries {
    data class Device(val name: String, val level: Int, val kind: String)

    /** "remote", "controller", "headphones", "keyboard" or "other", from the device's Bluetooth class. */
    fun kindOf(major: Int, device: Int, name: String): String {
        val n = name.lowercase()
        return when {
            n.contains("remote") -> "remote"
            n.contains("controller") || n.contains("gamepad") || n.contains("xbox") || n.contains("dualsense") || n.contains("dualshock") || n.contains("joy-con") -> "controller"
            major == BluetoothClass.Device.Major.AUDIO_VIDEO -> "headphones"
            major == BluetoothClass.Device.Major.PERIPHERAL && ((device shr 2) and 0x0F) in 1..2 -> "controller"   // joystick or gamepad
            major == BluetoothClass.Device.Major.PERIPHERAL && ((device shr 2) and 0x0F) == 3 -> "remote"           // remote control
            major == BluetoothClass.Device.Major.PERIPHERAL && (device and 0xC0) == 0x40 -> "keyboard"
            major == BluetoothClass.Device.Major.PERIPHERAL -> "remote"
            else -> "other"
        }
    }

    /** The answer the page reads: {"ok": true, "need": "" | "permission" | "bluetooth", "devices": [...]}, lowest charge first. */
    fun json(devices: List<Device>, need: String = ""): String {
        val arr = JSONArray()
        devices.filter { it.level in 0..100 }.sortedBy { it.level }.take(8).forEach {
            arr.put(JSONObject().put("name", it.name.take(32)).put("level", it.level).put("kind", it.kind))
        }
        return JSONObject().put("ok", need.isEmpty()).put("need", need).put("devices", arr).toString()
    }

    fun allowed(ctx: Context): Boolean = Build.VERSION.SDK_INT < 31 ||
        ctx.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED

    @Suppress("MissingPermission")
    fun read(ctx: Context): String {
        if (!allowed(ctx)) return json(emptyList(), "permission")
        val adapter = (ctx.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter ?: return json(emptyList(), "bluetooth")
        val bonded: Set<BluetoothDevice> = try { adapter.bondedDevices ?: emptySet() } catch (e: SecurityException) { return json(emptyList(), "permission") }
        val get = try { BluetoothDevice::class.java.getMethod("getBatteryLevel") } catch (e: Exception) { null }
        val out = bonded.mapNotNull { d ->
            val level = try { (get?.invoke(d) as? Int) ?: -1 } catch (e: Exception) { -1 }
            if (level !in 0..100) return@mapNotNull null
            val name = try { d.name ?: "" } catch (e: SecurityException) { "" }
            val cls = try { d.bluetoothClass } catch (e: Exception) { null }
            Device(name.ifEmpty { "Bluetooth device" }, level, kindOf(cls?.majorDeviceClass ?: 0, cls?.deviceClass ?: 0, name))
        }
        return json(out)
    }
}
