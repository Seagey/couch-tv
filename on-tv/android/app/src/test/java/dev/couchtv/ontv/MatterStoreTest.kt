package dev.couchtv.ontv

import dev.couchtv.ontv.matter.MatterModel
import dev.couchtv.ontv.matter.MatterStore
import dev.couchtv.ontv.matter.MatterNode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class MatterStoreTest {
    @get:Rule val tmp = TemporaryFolder()

    private val snap: MatterNode = mapOf(
        0 to mapOf(MatterModel.BASIC to mapOf(3L to "Bulb")),
        1 to mapOf(MatterModel.DESCRIPTOR to mapOf(0L to listOf(mapOf(0L to 0x101L, 1L to 1L)), 1L to listOf(6L, 8L)),
            MatterModel.ON_OFF to mapOf(0L to true), MatterModel.LEVEL to mapOf(0L to 200L, 2L to null)))

    @Test fun nodesRoundTrip() {
        val s = MatterStore(tmp.newFolder("m"))
        assertEquals(1L, s.nextNodeId()); assertEquals(2L, s.nextNodeId())
        s.save(listOf(MatterStore.Saved(2, 1000, linkedMapOf("matter:2:1" to "Lounge lamp"), "fd00::1", 5540, snap)))
        val back = s.nodes().single()
        assertEquals(2L, back.node); assertEquals("Lounge lamp", back.names["matter:2:1"]); assertEquals("fd00::1", back.address); assertEquals(5540, back.port)
        assertEquals(snap, back.snapshot)
        // the restored snapshot gives the same device as the live one
        assertEquals(MatterModel.devices(2, snap, true).toString(), MatterModel.devices(2, back.snapshot, true).toString())
        // ids keep going up, never reused, also after the file is read again
        assertEquals(3L, MatterStore(s.dir).nextNodeId())
    }

    @Test fun bigNodeIdsAndBackupFile() {
        val dir = tmp.newFolder("m2")
        val s = MatterStore(dir)
        s.save(listOf(MatterStore.Saved(-2L, 1, address = null)))
        s.save(listOf(MatterStore.Saved(-2L, 1, address = "192.0.2.5"), MatterStore.Saved(7, 2)))
        // a damaged main file: the copy before it is used
        File(dir, "nodes.json").writeText("{not json")
        val back = MatterStore(dir).nodes()
        assertEquals(listOf(-2L), back.map { it.node })
        assertTrue(File(dir, "nodes.json.bak").isFile)
    }

    @Test fun fabricCopy() {
        val s = MatterStore(tmp.newFolder("m3"))
        assertTrue(s.fabric().isEmpty())
        val kv = mapOf("AndroidDeviceControllerKey" to "AAAA", "f/1/r" to "BBBB")
        s.saveFabric(kv)
        assertEquals(kv, MatterStore(s.dir).fabric())
    }
}
