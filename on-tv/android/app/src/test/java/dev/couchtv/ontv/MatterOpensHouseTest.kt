package dev.couchtv.ontv

import dev.couchtv.ontv.matter.MatterModel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The house opening rule: anything that may open the house never shows and is never switched. */
class MatterOpensHouseTest {
    private fun dt(vararg t: Long) = t.map { mapOf(0L to it, 1L to 1L) }
    private fun ep(types: List<Map<Long, Long>>, vararg clusters: Pair<Long, Map<Long, Any?>>): Map<Long, Map<Long, Any?>> {
        val m = LinkedHashMap<Long, Map<Long, Any?>>()
        m[MatterModel.DESCRIPTOR] = mapOf(0L to types, 1L to clusters.map { it.first })
        clusters.forEach { m[it.first] = it.second }
        return m
    }
    private fun root(name: String) = mapOf(MatterModel.DESCRIPTOR to mapOf<Long, Any?>(0L to listOf(mapOf(0L to 0x16L, 1L to 1L))),
        MatterModel.BASIC to mapOf<Long, Any?>(1L to "Acme", 3L to "Opener", 5L to name))
    private val plug = ep(dt(0x010A), MatterModel.ON_OFF to mapOf(0L to false))
    private val cover = ep(dt(0x0202), MatterModel.COVER to mapOf(0x0EL to 0L))
    private val onOffLight = ep(dt(0x0100), MatterModel.ON_OFF to mapOf(0L to false))
    private val dimmable = ep(dt(0x0101), MatterModel.ON_OFF to mapOf(0L to false), MatterModel.LEVEL to mapOf(0L to 100L))

    // The same names as the bridge's check (bridge/matter.py opens_house at nl-matter-bridge 50ac34c gives
    // exactly these answers: checked with python3 when this list was written).
    private val opens = listOf(
        "Garage door", "Front gate", "Back door", "Smart lock", "Garage",                    // en
        "Garagentor", "Haustür", "Hoftor", "Türschloss", "Tor",                             // de
        "Voordeur", "Garagepoort", "Tuinhek", "Slot",                                       // nl
        "Porte du garage", "Portail", "Serrure", "Barrière",                                // fr
        "Puerta del garaje", "Portón", "Cerradura", "Verja",                                // es
        "Cancello", "Porta del garage", "Serratura", "Basculante",                          // it
        "Portão", "Fechadura", "Garagem",                                                   // pt
        "Garaj kapısı", "Kapı", "Kilit",                                                    // tr
        "Garažna vrata", "Kapija", "Brava",                                                 // sr
        "Brama garażowa", "Drzwi", "Zamek",                                                 // pl
        "Garážová vrata", "Brána", "Dveře", "Zámek",                                        // cs
        "דלת המוסך", "שער",                                                                  // he
        "باب المرآب", "البوابة", "قفل",                                                      // ar
    )
    private val fine = listOf("Outdoor blind", "Margate blind", "Block out blind", "Lounge lamp", "Kitchen plug",
        "Doorway lamp", "Portable fan", "Gatehouse light", "Torch", "Locksmith radio", "Sportes")

    @Test fun everyLanguageTheHomeSpeaks() {
        opens.forEach { assertTrue(it, MatterModel.opensHouse(it)) }
        fine.forEach { assertFalse(it, MatterModel.opensHouse(it)) }
    }

    @Test fun joinedNamesCountToo() {
        listOf("GarageDoor", "Garage2", "MyGarage", "Gate_1", "Door1", "HausTür", "Front‎Gate").forEach { assertTrue(it, MatterModel.opensHouse(it)) }
        listOf("Outdoor blind", "OutdoorBlind", "Blind2", "Lamp_1").forEach { assertFalse(it, MatterModel.opensHouse(it)) }
        assertTrue(MatterModel.devices(5, mapOf(0 to root("GarageDoor"), 1 to plug), true).isEmpty())
    }

    @Test fun aPlugNamedGarageDoorNeverShows() {
        val node = mapOf(0 to root("Garage door"), 1 to plug)
        assertTrue(MatterModel.devices(5, node, true).isEmpty())
        assertNull(MatterModel.domainOf(plug, "Garage door"))
        assertEquals("switch", MatterModel.domainOf(plug, "Kitchen plug"))
    }

    @Test fun anOnOffLightNamedGateNeverShowsButADimmableLightCan() {
        assertTrue(MatterModel.devices(5, mapOf(0 to root("Gate"), 1 to onOffLight), true).isEmpty())
        // a light that dims is a light, whatever its name ("Door light" over the porch)
        assertEquals(1, MatterModel.devices(5, mapOf(0 to root("Front door light"), 1 to dimmable), true).size)
    }

    @Test fun aRenameCanNeverBringAGarageBack() {
        val node = mapOf(0 to root("Garage"), 1 to cover)
        assertTrue(MatterModel.devices(6, node, true, mapOf("matter:6:1" to "Kitchen blind")).isEmpty())
        // and a name typed for a blind that opens the house hides it too
        assertTrue(MatterModel.devices(6, mapOf(0 to root("Blind"), 1 to cover), true, mapOf("matter:6:1" to "Porte du garage")).isEmpty())
        assertTrue(MatterModel.hiddenByName("cover", cover, "Puerta del garaje"))
        assertTrue(MatterModel.hiddenByName("switch", plug, "Cancello"))
        assertFalse(MatterModel.hiddenByName("light", dimmable, "Cancello"))
        assertFalse(MatterModel.hiddenByName("cover", cover, "Outdoor blind"))
    }

    @Test fun namesAreTidied() {
        assertEquals("Garage", MatterModel.cleanName("Gar​age"))
        assertEquals("Garage door", MatterModel.cleanName(" Garage\ndoor\t"))
        assertTrue(MatterModel.opensHouse(MatterModel.cleanName("Gar​age\u0000door")))
        // a device that calls itself "Gar<zero width>age" is still caught
        assertTrue(MatterModel.devices(5, mapOf(0 to root("Gar​age"), 1 to plug), true).isEmpty())
    }
}
