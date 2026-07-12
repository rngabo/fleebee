package com.salvi.fleebeemanagement.data

import com.salvi.fleebeemanagement.model.Biker
import com.salvi.fleebeemanagement.model.MessageCategory

object FleetRepository {

    const val TEST_PHONE_NUMBER = "0788690545"

    private val bikers = listOf(
        Biker(
            id = "bkr-001",
            name = "Mugisha Eric",
            phoneNumber = "0788001111",
            bikePlate = "RAE 241M",
            bikeModel = "TVS HLX 125",
            status = "Active",
            reminderDue = true,
            urgentAlert = false
        ),
        Biker(
            id = "bkr-002",
            name = "Uwase Linda",
            phoneNumber = "0788002222",
            bikePlate = "RAD 558K",
            bikeModel = "Boxer BM 150",
            status = "Active",
            reminderDue = false,
            urgentAlert = true
        ),
        Biker(
            id = "bkr-003",
            name = "Habimana Claude",
            phoneNumber = "0788003333",
            bikePlate = "RAH 904P",
            bikeModel = "Bajaj Pulsar",
            status = "Active",
            reminderDue = true,
            urgentAlert = false
        ),
        Biker(
            id = "bkr-004",
            name = "Nyiraneza Alice",
            phoneNumber = "0788004444",
            bikePlate = "RAE 670T",
            bikeModel = "TVS Star City",
            status = "Inactive",
            reminderDue = false,
            urgentAlert = false
        )
    )

    fun allBikers(): List<Biker> = bikers

    fun findBiker(id: String): Biker? = bikers.firstOrNull { it.id == id }

    fun totalBikers(): Int = bikers.size

    fun pendingReminderCount(): Int = bikers.count { it.reminderDue }

    fun emergencyCount(): Int = bikers.count { it.urgentAlert }

    fun quickTarget(category: MessageCategory): Biker? {
        return when (category) {
            MessageCategory.REMINDER -> bikers.firstOrNull { it.reminderDue }
            MessageCategory.GENERAL -> bikers.firstOrNull { it.status == "Active" }
            MessageCategory.EMERGENCY -> bikers.firstOrNull { it.urgentAlert }
        }
    }
}
