const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const { buildBrowserConfigScript } = require("./config/browser-config");
const { env } = require("./config/env");
const { sendJson, sendText, readJson, withCors } = require("./lib/http");
const { getContentType } = require("./server/mime-types");
const { createBiker, deleteBiker, listBikers, updateBiker } = require("./services/biker-service");
const { buildDashboardResponse } = require("./services/dashboard-service");
const {
  claimNextMessage,
  createMessageRecord,
  deletePendingMessage,
  normalizeGatewayResultStatus,
  listMessages,
  serializeMessage,
  updateMessageResult,
  updatePendingMessage
} = require("./services/message-service");
const {
  createScheduledMessage,
  deleteScheduledMessage,
  listScheduledMessages,
  updateScheduledMessage
} = require("./services/scheduled-message-service");
const {
  buildBundleCheckDirective,
  getPhoneState,
  requestBundleCheck,
  serializePhone,
  updateBundleCheck,
  updatePhoneHeartbeat
} = require("./services/phone-service");
const {
  clearDispatchPassword,
  hasValidStoredDispatchPassword,
  saveDispatchPassword
} = require("./services/setting-service");

function resolveDashboardFilePath(pathname) {
  const requestedPath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const normalizedPath = path.normalize(requestedPath);
  const resolvedPath = path.join(env.DASHBOARD_PUBLIC_DIR, normalizedPath);
  const safePrefix = `${env.DASHBOARD_PUBLIC_DIR}${path.sep}`;

  if (resolvedPath !== env.DASHBOARD_PUBLIC_DIR && !resolvedPath.startsWith(safePrefix)) {
    return null;
  }

  return resolvedPath;
}

function sendFile(res, filePath, fallbackPath) {
  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === "ENOENT" && fallbackPath && filePath !== fallbackPath) {
        sendFile(res, fallbackPath);
        return;
      }

      sendText(res, error.code === "ENOENT" ? 404 : 500, "Unexpected file server error.");
      return;
    }

    res.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": getContentType(filePath)
    });
    res.end(content);
  });
}

function sendBrowserConfig(res) {
  res.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Type": "application/javascript; charset=utf-8"
  });
  res.end(buildBrowserConfigScript());
}

function createAppServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (req.method === "OPTIONS") {
      withCors(res);
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      if (req.method === "GET" && url.pathname === "/health") {
        sendJson(res, 200, {
          status: "ok",
          service: "fleebee-app",
          storage: "sqlite"
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/app-config.js") {
        sendBrowserConfig(res);
        return;
      }

      if (url.pathname === "/api/settings/dispatch-password") {
        if (req.method === "GET") {
          sendJson(res, 200, {
            saved: await hasValidStoredDispatchPassword()
          });
          return;
        }

        if (req.method === "PUT") {
          const payload = await readJson(req);
          const response = await saveDispatchPassword(payload.password);
          sendJson(res, response.statusCode, response.body);
          return;
        }

        if (req.method === "DELETE") {
          await clearDispatchPassword();
          sendJson(res, 200, {
            saved: false
          });
          return;
        }
      }

      if (req.method === "GET" && url.pathname === "/api/dashboard") {
        sendJson(res, 200, await buildDashboardResponse());
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/bikers") {
        sendJson(res, 200, {
          items: await listBikers()
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/bikers") {
        const payload = await readJson(req);
        const response = await createBiker(payload);
        if (response.error) {
          sendJson(res, 400, response);
          return;
        }

        sendJson(res, 201, response);
        return;
      }

      if (req.method === "PUT" && /^\/api\/bikers\/[^/]+$/.test(url.pathname)) {
        const payload = await readJson(req);
        const bikerId = decodeURIComponent(url.pathname.split("/")[3] || "");
        const response = await updateBiker(bikerId, payload);
        sendJson(res, response.statusCode, response.body);
        return;
      }

      if (req.method === "DELETE" && /^\/api\/bikers\/[^/]+$/.test(url.pathname)) {
        const bikerId = decodeURIComponent(url.pathname.split("/")[3] || "");
        const response = await deleteBiker(bikerId);
        sendJson(res, response.statusCode, response.body);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/messages") {
        sendJson(res, 200, {
          items: await listMessages()
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/messages") {
        const payload = await readJson(req);
        const response = await createMessageRecord(payload);
        sendJson(res, response.statusCode, response.body);
        return;
      }

      if (req.method === "PUT" && /^\/api\/messages\/[^/]+$/.test(url.pathname)) {
        const payload = await readJson(req);
        const messageId = decodeURIComponent(url.pathname.split("/")[3] || "");
        const response = await updatePendingMessage(messageId, payload);
        sendJson(res, response.statusCode, response.body);
        return;
      }

      if (req.method === "DELETE" && /^\/api\/messages\/[^/]+$/.test(url.pathname)) {
        const messageId = decodeURIComponent(url.pathname.split("/")[3] || "");
        const response = await deletePendingMessage(messageId);
        sendJson(res, response.statusCode, response.body);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/schedules") {
        sendJson(res, 200, {
          items: await listScheduledMessages()
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/schedules") {
        const payload = await readJson(req);
        const response = await createScheduledMessage(payload);
        sendJson(res, response.statusCode, response.body);
        return;
      }

      if (req.method === "PUT" && /^\/api\/schedules\/[^/]+$/.test(url.pathname)) {
        const payload = await readJson(req);
        const scheduleId = decodeURIComponent(url.pathname.split("/")[3] || "");
        const response = await updateScheduledMessage(scheduleId, payload);
        sendJson(res, response.statusCode, response.body);
        return;
      }

      if (req.method === "DELETE" && /^\/api\/schedules\/[^/]+$/.test(url.pathname)) {
        const scheduleId = decodeURIComponent(url.pathname.split("/")[3] || "");
        const response = await deleteScheduledMessage(scheduleId);
        sendJson(res, response.statusCode, response.body);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/gateway/jobs/claim") {
        const payload = await readJson(req);
        const phone = await getPhoneState();
        const deviceId = String(payload.deviceId || phone.deviceId).trim() || phone.deviceId;
        const item = await claimNextMessage(deviceId);
        const updatedPhone = await updatePhoneHeartbeat({ deviceId });

        sendJson(res, 200, {
          item: item ? serializeMessage(item) : null,
          phone: serializePhone(updatedPhone)
        });
        return;
      }

      if (req.method === "POST" && /^\/api\/gateway\/jobs\/[^/]+\/result$/.test(url.pathname)) {
        const payload = await readJson(req);
        const messageId = url.pathname.split("/")[4];
        const status = normalizeGatewayResultStatus(payload.status);
        const message = await updateMessageResult(messageId, status, payload.note);

        if (!message) {
          sendJson(res, 404, {
            error: "Message not found."
          });
          return;
        }

        await updatePhoneHeartbeat({});
        sendJson(res, 200, {
          item: serializeMessage(message)
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/phone/bundle/request") {
        const phone = await requestBundleCheck();
        sendJson(res, 200, {
          ok: true,
          note: "Bundle check requested. The phone will run the USSD code on its next sync pass.",
          phone: serializePhone(phone)
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/phone/bundle/report") {
        const payload = await readJson(req);
        const phone = await updateBundleCheck(payload);
        sendJson(res, 200, {
          ok: true,
          phone: serializePhone(phone)
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/phone") {
        sendJson(res, 200, serializePhone(await getPhoneState()));
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/phone/heartbeat") {
        const payload = await readJson(req);
        const phone = await updatePhoneHeartbeat(payload);
        sendJson(res, 200, {
          ok: true,
          phone: serializePhone(phone),
          bundleCheck: buildBundleCheckDirective(phone)
        });
        return;
      }

      if (url.pathname.startsWith("/api/")) {
        sendJson(res, 404, {
          error: "API route not found."
        });
        return;
      }

      if (req.method === "GET") {
        const filePath = resolveDashboardFilePath(url.pathname);
        if (!filePath) {
          sendText(res, 403, "Forbidden");
          return;
        }

        const fallbackPath = path.extname(url.pathname) ? null : path.join(env.DASHBOARD_PUBLIC_DIR, "index.html");
        sendFile(res, filePath, fallbackPath);
        return;
      }

      sendText(res, 404, "Not found");
    } catch (error) {
      sendJson(res, 500, {
        error: "Unexpected server error.",
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  });
}

module.exports = {
  createAppServer
};
