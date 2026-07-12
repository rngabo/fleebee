package com.salvi.fleebeemanagement.sync

import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

object GatewayApi {

    private const val CONNECT_TIMEOUT_MS = 5_000
    private const val READ_TIMEOUT_MS = 8_000

    fun sendHeartbeat(): GatewayBundleCheckDirective? {
        val response = requestJson(
            path = "/api/phone/heartbeat",
            method = "POST",
            body = JSONObject()
                .put("deviceId", GatewayConfig.DEVICE_ID)
                .put("network", GatewayConfig.NETWORK_LABEL)
                .put("fixedLocation", GatewayConfig.FIXED_LOCATION)
        )

        val bundleCheck = response.optJSONObject("bundleCheck") ?: return null
        return GatewayBundleCheckDirective(
            shouldRun = bundleCheck.optBoolean("shouldRun", false),
            reason = bundleCheck.optString("reason", "fresh"),
            ussdCode = bundleCheck.optString("ussdCode", "*131#"),
            refreshIntervalMs = bundleCheck.optLong("refreshIntervalMs", 0L)
        )
    }

    fun claimNextJob(): GatewayJob? {
        val response = requestJson(
            path = "/api/gateway/jobs/claim",
            method = "POST",
            body = JSONObject().put("deviceId", GatewayConfig.DEVICE_ID)
        )

        if (response.isNull("item")) {
            return null
        }

        val item = response.getJSONObject("item")
        return GatewayJob(
            id = item.getString("id"),
            bikerName = item.optString("bikerName"),
            category = item.optString("category"),
            body = item.getString("body"),
            targetNumber = item.optString("targetNumber", "0788690545")
        )
    }

    fun reportJobResult(jobId: String, status: String, note: String) {
        requestJson(
            path = "/api/gateway/jobs/$jobId/result",
            method = "POST",
            body = JSONObject()
                .put("status", status)
                .put("note", note)
        )
    }

    fun reportBundleCheck(
        status: String,
        ussdCode: String,
        summary: String = "",
        details: String = "",
        error: String = ""
    ) {
        requestJson(
            path = "/api/phone/bundle/report",
            method = "POST",
            body = JSONObject()
                .put("status", status)
                .put("ussdCode", ussdCode)
                .put("summary", summary)
                .put("details", details)
                .put("error", error)
        )
    }

    private fun requestJson(
        path: String,
        method: String,
        body: JSONObject? = null
    ): JSONObject {
        val connection = openConnection(path, method)

        return try {
            if (body != null) {
                OutputStreamWriter(connection.outputStream).use { writer ->
                    writer.write(body.toString())
                }
            }

            val stream = if (connection.responseCode in 200..299) {
                connection.inputStream
            } else {
                connection.errorStream
            }

            val payload = BufferedReader(InputStreamReader(stream)).use { reader ->
                buildString {
                    reader.forEachLine { line ->
                        append(line)
                    }
                }
            }

            if (connection.responseCode !in 200..299) {
                throw IllegalStateException(payload.ifBlank { "Backend request failed." })
            }

            JSONObject(payload.ifBlank { "{}" })
        } finally {
            connection.disconnect()
        }
    }

    private fun openConnection(path: String, method: String): HttpURLConnection {
        val url = URL("${GatewayConfig.BACKEND_BASE_URL}$path")
        return (url.openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = CONNECT_TIMEOUT_MS
            readTimeout = READ_TIMEOUT_MS
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
            setRequestProperty("Accept", "application/json")
            doInput = true
            doOutput = method != "GET"
        }
    }
}
