package com.salvi.fleebeemanagement.sync

data class GatewayJob(
    val id: String,
    val bikerName: String,
    val category: String,
    val body: String,
    val targetNumber: String
)
