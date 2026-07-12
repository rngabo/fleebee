package com.salvi.fleebeemanagement.sync

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.telephony.SmsManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.salvi.fleebeemanagement.R
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class GatewaySyncService : Service() {

    private val executor = Executors.newSingleThreadScheduledExecutor()
    private val bundleExecutor = Executors.newSingleThreadExecutor()
    private val syncRunning = AtomicBoolean(false)
    private val bundleCheckRunning = AtomicBoolean(false)
    private var schedulerStarted = false
    private var wakeLock: PowerManager.WakeLock? = null

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "Service created")
        createNotificationChannel()
        acquireWakeLock()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d(TAG, "onStartCommand action=${intent?.action} startId=$startId")
        if (intent?.action == ACTION_STOP) {
            Log.d(TAG, "Stopping foreground service on explicit stop request")
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }

        startForeground(
            NOTIFICATION_ID,
            buildNotification(
                title = getString(R.string.gateway_notification_title),
                text = getString(R.string.gateway_notification_waiting)
            )
        )
        acquireWakeLock()

        if (!schedulerStarted) {
            schedulerStarted = true
            Log.d(TAG, "Starting scheduled sync loop")
            executor.scheduleWithFixedDelay(
                { performSyncPass() },
                0L,
                3L,
                TimeUnit.SECONDS
            )
        }

        return START_STICKY
    }

    override fun onDestroy() {
        Log.d(TAG, "Service destroyed")
        executor.shutdownNow()
        bundleExecutor.shutdownNow()
        releaseWakeLock()
        schedulerStarted = false
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun performSyncPass() {
        if (!syncRunning.compareAndSet(false, true)) {
            return
        }

        try {
            val bundleCheck = GatewayApi.sendHeartbeat()
            val job = GatewayApi.claimNextJob()
            if (job == null) {
                val startedBundleCheck = maybeStartBundleCheck(bundleCheck)
                if (!startedBundleCheck) {
                    updateNotification(
                        getString(R.string.gateway_notification_title),
                        getString(R.string.gateway_notification_waiting)
                    )
                }
                return
            }

            Log.d(TAG, "Claimed job ${job.id} for ${job.targetNumber}")
            sendJobSms(job)
        } catch (error: Exception) {
            Log.e(TAG, "Gateway sync issue", error)
            updateNotification(
                getString(R.string.gateway_notification_title),
                getString(R.string.gateway_notification_error, error.message ?: "sync failed")
            )
        } finally {
            syncRunning.set(false)
        }
    }

    private fun maybeStartBundleCheck(directive: GatewayBundleCheckDirective?): Boolean {
        if (directive == null || !directive.shouldRun) {
            return false
        }
        if (!bundleCheckRunning.compareAndSet(false, true)) {
            return false
        }

        bundleExecutor.execute {
            runBundleCheck(directive)
        }
        return true
    }

    private fun runBundleCheck(directive: GatewayBundleCheckDirective) {
        try {
            GatewayApi.reportBundleCheck(
                status = "checking",
                ussdCode = directive.ussdCode
            )
            updateNotification(
                getString(R.string.gateway_notification_title),
                getString(R.string.gateway_notification_bundle_checking, directive.ussdCode)
            )

            val result = GatewayBundleMonitor.checkNow(this, directive.ussdCode)
            GatewayApi.reportBundleCheck(
                status = result.status,
                ussdCode = directive.ussdCode,
                summary = result.summary,
                details = result.details,
                error = result.error
            )

            val text = when (result.status) {
                "permission-missing" -> getString(R.string.gateway_notification_bundle_permission_missing)
                "error", "unsupported" -> getString(
                    R.string.gateway_notification_error,
                    result.summary.ifBlank { result.error.ifBlank { "bundle check failed" } }
                )
                else -> getString(R.string.gateway_notification_waiting)
            }

            updateNotification(
                getString(R.string.gateway_notification_title),
                text
            )
        } catch (error: Exception) {
            Log.e(TAG, "Bundle check failed", error)
            try {
                GatewayApi.reportBundleCheck(
                    status = "error",
                    ussdCode = directive.ussdCode,
                    error = error.message ?: "bundle check failed"
                )
            } catch (_: Exception) {
                // Best effort: bundle status can recover on the next requested or periodic check.
            }
            updateNotification(
                getString(R.string.gateway_notification_title),
                getString(R.string.gateway_notification_error, error.message ?: "bundle check failed")
            )
        } finally {
            bundleCheckRunning.set(false)
        }
    }

    private fun sendJobSms(job: GatewayJob) {
        if (!hasSmsPermission()) {
            GatewayApi.reportJobResult(job.id, "failed", "SEND_SMS permission missing")
            updateNotification(
                getString(R.string.gateway_notification_title),
                getString(R.string.gateway_notification_permission_missing)
            )
            return
        }

        try {
            val sentIntent = GatewaySmsResultReceiver.sentPendingIntent(this, job)
            val deliveryIntent = GatewaySmsResultReceiver.deliveryPendingIntent(this, job)

            @Suppress("DEPRECATION")
            SmsManager.getDefault().sendTextMessage(
                job.targetNumber,
                null,
                job.body,
                sentIntent,
                deliveryIntent
            )

            updateNotification(
                getString(R.string.gateway_notification_title),
                getString(
                    R.string.gateway_notification_submission_pending,
                    job.category,
                    job.targetNumber
                )
            )
        } catch (error: Exception) {
            Log.e(TAG, "SMS submission failed", error)
            GatewayApi.reportJobResult(
                job.id,
                "failed",
                error.message ?: "SMS submission failed"
            )
            updateNotification(
                getString(R.string.gateway_notification_title),
                getString(R.string.gateway_notification_error, error.message ?: "SMS failed")
            )
        }
    }

    private fun hasSmsPermission(): Boolean {
        return ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.SEND_SMS
        ) == PackageManager.PERMISSION_GRANTED
    }

    private fun updateNotification(title: String, text: String) {
        val notificationManager = getSystemService(NotificationManager::class.java)
        notificationManager.notify(NOTIFICATION_ID, buildNotification(title, text))
    }

    private fun buildNotification(title: String, text: String): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setOngoing(true)
            .setSilent(true)
            .build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return
        }

        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.gateway_channel_name),
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = getString(R.string.gateway_channel_description)
        }

        val notificationManager = getSystemService(NotificationManager::class.java)
        notificationManager.createNotificationChannel(channel)
    }

    private fun acquireWakeLock() {
        if (wakeLock?.isHeld == true) {
            return
        }

        val powerManager = getSystemService(PowerManager::class.java) ?: return
        wakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "$packageName:gateway-sync"
        ).apply {
            setReferenceCounted(false)
            acquire()
        }
        Log.d(TAG, "Acquired partial wake lock for gateway sync")
    }

    private fun releaseWakeLock() {
        val heldWakeLock = wakeLock ?: return
        wakeLock = null
        if (heldWakeLock.isHeld) {
            heldWakeLock.release()
            Log.d(TAG, "Released partial wake lock for gateway sync")
        }
    }

    companion object {
        private const val TAG = "FleebeeGatewaySync"
        private const val CHANNEL_ID = "fleebee_gateway_sync"
        private const val NOTIFICATION_ID = 4417
        private const val ACTION_START = "com.salvi.fleebeemanagement.sync.START"
        private const val ACTION_STOP = "com.salvi.fleebeemanagement.sync.STOP"

        fun start(context: Context) {
            Log.d(TAG, "Requesting foreground service start")
            val intent = Intent(context, GatewaySyncService::class.java).apply {
                action = ACTION_START
            }
            ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: Context) {
            val intent = Intent(context, GatewaySyncService::class.java).apply {
                action = ACTION_STOP
            }
            ContextCompat.startForegroundService(context, intent)
        }
    }
}
