package com.salvi.fleebeemanagement.model

data class Biker(
    val id: String,
    val name: String,
    val phoneNumber: String,
    val bikePlate: String,
    val bikeModel: String,
    val status: String,
    val reminderDue: Boolean,
    val urgentAlert: Boolean
)
