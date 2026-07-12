package com.salvi.fleebeemanagement.sync

import com.salvi.fleebeemanagement.BuildConfig

object GatewayConfig {
    const val DEVICE_ID = BuildConfig.GATEWAY_DEVICE_ID
    const val FIXED_LOCATION = BuildConfig.GATEWAY_FIXED_LOCATION
    const val NETWORK_LABEL = BuildConfig.GATEWAY_NETWORK_LABEL

    // Local USB testing can still use adb reverse with http://127.0.0.1:4100.
    const val BACKEND_BASE_URL = BuildConfig.GATEWAY_BACKEND_BASE_URL
}
