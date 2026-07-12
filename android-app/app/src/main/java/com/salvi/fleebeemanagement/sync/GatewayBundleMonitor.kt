package com.salvi.fleebeemanagement.sync

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.telephony.SubscriptionManager
import android.telephony.TelephonyManager
import androidx.core.content.ContextCompat
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

data class GatewayBundleCheckDirective(
    val shouldRun: Boolean,
    val reason: String,
    val ussdCode: String,
    val refreshIntervalMs: Long
)

data class GatewayBundleCheckResult(
    val status: String,
    val summary: String = "",
    val details: String = "",
    val error: String = ""
)

object GatewayBundleMonitor {

    private const val USSD_TIMEOUT_SECONDS = 30L

    fun checkNow(context: Context, ussdCode: String): GatewayBundleCheckResult {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return GatewayBundleCheckResult(
                status = "unsupported",
                error = "Automated USSD checks need Android 8 or newer."
            )
        }

        if (!hasCallPermission(context)) {
            return GatewayBundleCheckResult(
                status = "permission-missing",
                error = "CALL_PHONE permission missing."
            )
        }

        val telephonyManager = resolveTelephonyManager(context)
            ?: return GatewayBundleCheckResult(
                status = "error",
                error = "Telephony service is unavailable on the phone."
            )

        val latch = CountDownLatch(1)
        var result = GatewayBundleCheckResult(
            status = "error",
            error = "USSD request ended unexpectedly."
        )

        try {
            telephonyManager.sendUssdRequest(
                ussdCode,
                object : TelephonyManager.UssdResponseCallback() {
                    override fun onReceiveUssdResponse(
                        telephonyManager: TelephonyManager,
                        request: String,
                        response: CharSequence
                    ) {
                        val details = response.toString().trim()
                        result = GatewayBundleCheckResult(
                            status = "ok",
                            summary = summarize(details),
                            details = details
                        )
                        latch.countDown()
                    }

                    override fun onReceiveUssdResponseFailed(
                        telephonyManager: TelephonyManager,
                        request: String,
                        failureCode: Int
                    ) {
                        val error = "USSD request failed with code $failureCode."
                        result = GatewayBundleCheckResult(
                            status = "error",
                            summary = error,
                            error = error
                        )
                        latch.countDown()
                    }
                },
                Handler(Looper.getMainLooper())
            )
        } catch (error: SecurityException) {
            return GatewayBundleCheckResult(
                status = "permission-missing",
                error = error.message ?: "CALL_PHONE permission missing."
            )
        } catch (error: Exception) {
            return GatewayBundleCheckResult(
                status = "error",
                error = error.message ?: "Could not start the USSD request."
            )
        }

        if (!latch.await(USSD_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
            return GatewayBundleCheckResult(
                status = "error",
                error = "USSD check timed out."
            )
        }

        return result
    }

    private fun hasCallPermission(context: Context): Boolean {
        return ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.CALL_PHONE
        ) == PackageManager.PERMISSION_GRANTED
    }

    private fun resolveTelephonyManager(context: Context): TelephonyManager? {
        val telephonyManager = context.getSystemService(TelephonyManager::class.java) ?: return null
        val subscriptionId = SubscriptionManager.getDefaultSmsSubscriptionId()
        return if (subscriptionId != SubscriptionManager.INVALID_SUBSCRIPTION_ID) {
            telephonyManager.createForSubscriptionId(subscriptionId)
        } else {
            telephonyManager
        }
    }

    private fun summarize(details: String): String {
        val firstLine = details
            .lineSequence()
            .map { it.trim() }
            .firstOrNull { it.isNotEmpty() }

        return firstLine?.take(180) ?: "USSD response received."
    }
}
