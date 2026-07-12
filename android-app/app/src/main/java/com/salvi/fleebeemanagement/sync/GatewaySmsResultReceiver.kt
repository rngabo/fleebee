package com.salvi.fleebeemanagement.sync

import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.telephony.SmsManager
import kotlin.concurrent.thread

class GatewaySmsResultReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val jobId = intent.getStringExtra(EXTRA_JOB_ID)?.trim().orEmpty()
        if (jobId.isEmpty()) {
            return
        }

        val targetNumber = intent.getStringExtra(EXTRA_TARGET_NUMBER)?.trim().orEmpty()
        val pendingResult = goAsync()

        thread(name = "gateway-sms-result") {
            try {
                val action = intent.action.orEmpty()
                val report = if (action == ACTION_SMS_DELIVERED) {
                    deliveryReport(resultCode, targetNumber)
                } else {
                    sentReport(resultCode, targetNumber, intent.getIntExtra("errorCode", -1))
                }

                GatewayApi.reportJobResult(jobId, report.status, report.note)
            } catch (_: Exception) {
                // Best effort: the regular gateway poll will continue even if this callback cannot reach the backend.
            } finally {
                pendingResult.finish()
            }
        }
    }

    private fun sentReport(resultCode: Int, targetNumber: String, errorCode: Int): GatewayReport {
        if (resultCode == Activity.RESULT_OK) {
            return GatewayReport(
                status = "submitted",
                note = "Submitted to the mobile carrier for ${targetNumber.ifBlank { "the target number" }}. Waiting for delivery confirmation."
            )
        }

        val failure = when (resultCode) {
            SmsManager.RESULT_ERROR_GENERIC_FAILURE -> {
                if (errorCode >= 0) {
                    "Generic carrier failure (error code $errorCode)."
                } else {
                    "Generic carrier failure."
                }
            }
            SmsManager.RESULT_ERROR_NO_SERVICE -> "No mobile service is available."
            SmsManager.RESULT_ERROR_NULL_PDU -> "Android rejected the SMS request."
            SmsManager.RESULT_ERROR_RADIO_OFF -> "The phone radio is off."
            SmsManager.RESULT_CANCELLED -> "Android cancelled the SMS request."
            else -> "Android returned SMS send result code $resultCode."
        }

        return GatewayReport(
            status = "failed",
            note = "Could not submit the SMS to ${targetNumber.ifBlank { "the target number" }}. $failure"
        )
    }

    private fun deliveryReport(resultCode: Int, targetNumber: String): GatewayReport {
        if (resultCode == Activity.RESULT_OK) {
            return GatewayReport(
                status = "sent",
                note = "Delivered successfully to ${targetNumber.ifBlank { "the target number" }}."
            )
        }

        val followUp = if (resultCode == Activity.RESULT_CANCELED) {
            "The carrier did not provide a delivery receipt."
        } else {
            "Android returned delivery result code $resultCode instead of a delivery receipt."
        }

        return GatewayReport(
            status = "submitted",
            note = "Submitted to ${targetNumber.ifBlank { "the target number" }}. $followUp Delivery may still have succeeded."
        )
    }

    private data class GatewayReport(
        val status: String,
        val note: String
    )

    companion object {
        private const val ACTION_SMS_SENT = "com.salvi.fleebeemanagement.sync.SMS_SENT"
        private const val ACTION_SMS_DELIVERED = "com.salvi.fleebeemanagement.sync.SMS_DELIVERED"
        private const val EXTRA_JOB_ID = "jobId"
        private const val EXTRA_TARGET_NUMBER = "targetNumber"

        fun sentPendingIntent(context: Context, job: GatewayJob): PendingIntent {
            val intent = Intent(context, GatewaySmsResultReceiver::class.java).apply {
                action = ACTION_SMS_SENT
                putExtra(EXTRA_JOB_ID, job.id)
                putExtra(EXTRA_TARGET_NUMBER, job.targetNumber)
            }

            return PendingIntent.getBroadcast(
                context,
                job.id.hashCode(),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }

        fun deliveryPendingIntent(context: Context, job: GatewayJob): PendingIntent {
            val intent = Intent(context, GatewaySmsResultReceiver::class.java).apply {
                action = ACTION_SMS_DELIVERED
                putExtra(EXTRA_JOB_ID, job.id)
                putExtra(EXTRA_TARGET_NUMBER, job.targetNumber)
            }

            return PendingIntent.getBroadcast(
                context,
                job.id.hashCode() xor 0x5F3759DF.toInt(),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }
    }
}
