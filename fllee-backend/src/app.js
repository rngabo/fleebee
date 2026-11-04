const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { timingSafeEqual } = require("node:crypto");

const { buildBrowserConfigScript } = require("./config/browser-config");
const { env } = require("./config/env");
const { sendJson, sendRedirect, sendText, readJson, withCors } = require("./lib/http");
const { getContentType } = require("./server/mime-types");
const { createBatch, deleteBatch, listBatches, updateBatch } = require("./services/batch-service");
const { createBiker, deleteBiker, listBikers, updateBiker } = require("./services/biker-service");
const {
  createBike,
  createBikeProgressUpdate,
  createFine,
  deleteBike,
  listBikes,
  listFines,
  updateBike
} = require("./services/bike-service");
const { buildDashboardResponse } = require("./services/dashboard-service");
const { getFleet } = require("./services/fleet-service");
const {
  applyDataSyncRun,
  createDataSyncRun,
  deleteDataPayment,
  failDataSyncRun,
  getDataDashboard,
  getDataPayments,
  getLatestSerializedRun,
  saveDataSyncIntervalDays
} = require("./services/data-sync-service");
const {
  getDataSyncRunnerState,
  startDataSyncProcess
} = require("./services/data-sync-runner-service");
const {
  attachSourceStatements,
  reopenUnmatchedRecorded,
  reopenSkippedEntries,
  auditStatementAgainstSheet,
  listAliases,
  removeAlias,
  saveAlias,
  discardBankStatement,
  getBankStatement,
  listCompletedStatements,
  saveBikerSelection,
  skipBankEntry,
  listBankStatements,
  listRegisteredBikers,
  reopenSyncedEntry,
  syncBankPayment,
  undoSkipEntry,
  verifyBankStatement,
  uploadBankStatement
} = require("./services/bank-statement-service");
const {
  completeFineCheckRun,
  createFineCheckRun,
  getContraventions,
  recordFineCheckTarget,
  saveFineMonitorFrequency
} = require("./services/fine-monitor-service");
const {
  getFineMonitorRunnerState,
  startFineMonitorProcess
} = require("./services/fine-monitor-runner-service");
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
  getSmsSettings,
  saveSmsSettings
} = require("./services/setting-service");
const {
  createSmsTemplate,
  deleteSmsTemplate,
  listSmsTemplates,
  updateSmsTemplate
} = require("./services/template-service");
const {
  clearSessionCookie,
  createSession,
  destroyBrowserSession,
  readBrowserSession,
  setSessionCookie,
  touchBrowserSession
} = require("./services/session-service");
const {
  WORKFLOW_CATEGORIES,
  WORKFLOW_STAGES,
  WORKFLOW_URGENCY_LEVELS
} = require("./services/workflow-support");

function resolveDashboardFilePath(pathname) {
  const requestedPath = pathname === "/"
    ? "index.html"
    : pathname === "/login" || pathname === "/login/"
      ? "login/index.html"
      : pathname.replace(/^\/+/, "");
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

function isLoginPagePath(pathname) {
  return pathname === "/login" || pathname === "/login/" || pathname === "/login/index.html";
}

function isPublicStaticPath(pathname) {
  return pathname === "/app-config.js" || pathname.startsWith("/assets/") || isLoginPagePath(pathname);
}

function isPublicApiPath(pathname) {
  return pathname === "/api/session/login"
    || pathname === "/api/session/logout"
    || pathname === "/api/gateway/jobs/claim"
    || /^\/api\/gateway\/jobs\/[^/]+\/result$/.test(pathname)
    || pathname === "/api/phone/heartbeat"
    || pathname === "/api/phone/bundle/report";
}

function normalizeRedirectTarget(target) {
  const value = String(target || "").trim();
  if (!value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }

  return isLoginPagePath(value) ? "/" : value;
}

function buildLoginLocation(url, reason) {
  const redirectTarget = normalizeRedirectTarget(`${url.pathname}${url.search || ""}`);
  const params = new URLSearchParams();

  if (redirectTarget !== "/") {
    params.set("redirect", redirectTarget);
  }
  if (reason) {
    params.set("reason", reason);
  }

  const query = params.toString();
  return query ? `/login/?${query}` : "/login/";
}

function sendApiAuthError(res, reason) {
  clearSessionCookie(res);
  sendJson(res, 401, {
    error: reason === "expired"
      ? "Your login session expired. Please sign in again."
      : "Sign in first to use the Fleebee dashboard.",
    reason
  });
}

function isFineMonitorAuthorized(req) {
  const expected = env.FINE_MONITOR_SERVICE_TOKEN;
  const authorization = String(req.headers.authorization || "");
  const supplied = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";

  if (!expected || !supplied) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length
    && timingSafeEqual(expectedBuffer, suppliedBuffer);
}

function isDataSyncAuthorized(req) {
  const expected = env.DATA_SYNC_SERVICE_TOKEN;
  const authorization = String(req.headers.authorization || "");
  const supplied = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";

  if (!expected || !supplied) return false;
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length
    && timingSafeEqual(expectedBuffer, suppliedBuffer);
}

function isFineMonitorApiPath(pathname) {
  return pathname.startsWith("/api/internal/fine-monitor/v1/");
}

function isDataSyncApiPath(pathname) {
  return pathname.startsWith("/api/internal/data-sync/v1/");
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

      if (req.method === "POST" && url.pathname === "/api/session/login") {
        const payload = await readJson(req);
        const password = String(payload.password || "");

        if (!password || password !== env.APP_LOGIN_PASSWORD) {
          clearSessionCookie(res);
          sendJson(res, 401, {
            error: "Login password is incorrect."
          });
          return;
        }

        const { sessionId, session } = createSession();
        setSessionCookie(res, sessionId);
        sendJson(res, 200, {
          authenticated: true,
          expiresAt: new Date(session.lastActivityAt + env.APP_SESSION_IDLE_TIMEOUT_MS).toISOString(),
          idleTimeoutMs: env.APP_SESSION_IDLE_TIMEOUT_MS
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/session/logout") {
        destroyBrowserSession(req, res);
        sendJson(res, 200, {
          loggedOut: true
        });
        return;
      }

      if (isFineMonitorApiPath(url.pathname)) {
        if (!env.FINE_MONITOR_SERVICE_TOKEN) {
          sendJson(res, 503, {
            error: "Fine monitor integration is not configured."
          });
          return;
        }

        if (!isFineMonitorAuthorized(req)) {
          sendJson(res, 401, {
            error: "Fine monitor service token is invalid."
          });
          return;
        }

        if (req.method === "POST" && url.pathname === "/api/internal/fine-monitor/v1/runs") {
          const response = await createFineCheckRun(await readJson(req));
          sendJson(res, response.statusCode, response.body);
          return;
        }

        if (
          req.method === "PUT"
          && /^\/api\/internal\/fine-monitor\/v1\/runs\/[^/]+\/targets\/[^/]+$/.test(url.pathname)
        ) {
          const parts = url.pathname.split("/");
          const runId = decodeURIComponent(parts[6] || "");
          const bikeId = decodeURIComponent(parts[8] || "");
          const response = await recordFineCheckTarget(runId, bikeId, await readJson(req));
          sendJson(res, response.statusCode, response.body);
          return;
        }

        if (
          req.method === "POST"
          && /^\/api\/internal\/fine-monitor\/v1\/runs\/[^/]+\/complete$/.test(url.pathname)
        ) {
          const runId = decodeURIComponent(url.pathname.split("/")[6] || "");
          const response = await completeFineCheckRun(runId, await readJson(req));
          sendJson(res, response.statusCode, response.body);
          return;
        }

        sendJson(res, 404, {
          error: "Fine monitor API route not found."
        });
        return;
      }

      if (isDataSyncApiPath(url.pathname)) {
        if (!env.DATA_SYNC_SERVICE_TOKEN) {
          sendJson(res, 503, { error: "Data sync integration is not configured." });
          return;
        }
        if (!isDataSyncAuthorized(req)) {
          sendJson(res, 401, { error: "Data sync service token is invalid." });
          return;
        }

        if (req.method === "POST" && url.pathname === "/api/internal/data-sync/v1/runs") {
          const response = await createDataSyncRun(await readJson(req));
          sendJson(res, response.statusCode, response.body);
          return;
        }
        if (
          req.method === "PUT"
          && /^\/api\/internal\/data-sync\/v1\/runs\/[^/]+\/data$/.test(url.pathname)
        ) {
          const runId = decodeURIComponent(url.pathname.split("/")[6] || "");
          const response = await applyDataSyncRun(runId, await readJson(req));
          sendJson(res, response.statusCode, response.body);
          return;
        }
        if (
          req.method === "POST"
          && /^\/api\/internal\/data-sync\/v1\/runs\/[^/]+\/fail$/.test(url.pathname)
        ) {
          const runId = decodeURIComponent(url.pathname.split("/")[6] || "");
          const response = await failDataSyncRun(runId, await readJson(req));
          sendJson(res, response.statusCode, response.body);
          return;
        }

        sendJson(res, 404, { error: "Data sync API route not found." });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/session/touch") {
        const sessionState = touchBrowserSession(req, res);
        if (!sessionState.authenticated) {
          sendApiAuthError(res, sessionState.reason);
          return;
        }

        sendJson(res, 200, sessionState.body);
        return;
      }

      const browserSession = readBrowserSession(req);
      const needsBrowserAuth = req.method === "GET"
        ? !isPublicStaticPath(url.pathname)
        : url.pathname.startsWith("/api/") && !isPublicApiPath(url.pathname);

      if (needsBrowserAuth && !browserSession.authenticated) {
        if (url.pathname.startsWith("/api/")) {
          sendApiAuthError(res, browserSession.reason);
        } else {
          clearSessionCookie(res);
          sendRedirect(res, buildLoginLocation(url, browserSession.reason));
        }
        return;
      }

      if (req.method === "GET" && isLoginPagePath(url.pathname) && browserSession.authenticated) {
        sendRedirect(res, normalizeRedirectTarget(url.searchParams.get("redirect")));
        return;
      }

      if (url.pathname === "/api/settings/sms") {
        if (req.method === "GET") {
          sendJson(res, 200, await getSmsSettings());
          return;
        }

        if (req.method === "PUT") {
          const payload = await readJson(req);
          const response = await saveSmsSettings(payload);
          sendJson(res, response.statusCode, response.body);
          return;
        }
      }

      if (req.method === "GET" && url.pathname === "/api/dashboard") {
        sendJson(res, 200, await buildDashboardResponse());
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/workflow/options") {
        sendJson(res, 200, {
          stages: WORKFLOW_STAGES,
          categories: WORKFLOW_CATEGORIES,
          urgencies: WORKFLOW_URGENCY_LEVELS
        });
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

      if (req.method === "GET" && url.pathname === "/api/batches") {
        sendJson(res, 200, {
          items: await listBatches()
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/batches") {
        const payload = await readJson(req);
        const response = await createBatch(payload);
        sendJson(res, response.statusCode, response.body);
        return;
      }

      if (req.method === "PUT" && /^\/api\/batches\/[^/]+$/.test(url.pathname)) {
        const payload = await readJson(req);
        const batchId = decodeURIComponent(url.pathname.split("/")[3] || "");
        const response = await updateBatch(batchId, payload);
        sendJson(res, response.statusCode, response.body);
        return;
      }

      if (req.method === "DELETE" && /^\/api\/batches\/[^/]+$/.test(url.pathname)) {
        const batchId = decodeURIComponent(url.pathname.split("/")[3] || "");
        const response = await deleteBatch(batchId);
        sendJson(res, response.statusCode, response.body);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/bikes") {
        sendJson(res, 200, {
          items: await listBikes()
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/bikes") {
        const payload = await readJson(req);
        const response = await createBike(payload);
        sendJson(res, response.statusCode, response.body);
        return;
      }

      if (req.method === "PUT" && /^\/api\/bikes\/[^/]+$/.test(url.pathname)) {
        const payload = await readJson(req);
        const bikeId = decodeURIComponent(url.pathname.split("/")[3] || "");
        const response = await updateBike(bikeId, payload);
        sendJson(res, response.statusCode, response.body);
        return;
      }

      if (req.method === "DELETE" && /^\/api\/bikes\/[^/]+$/.test(url.pathname)) {
        const bikeId = decodeURIComponent(url.pathname.split("/")[3] || "");
        const response = await deleteBike(bikeId);
        sendJson(res, response.statusCode, response.body);
        return;
      }

      if (req.method === "POST" && /^\/api\/bikes\/[^/]+\/progress$/.test(url.pathname)) {
        const payload = await readJson(req);
        const bikeId = decodeURIComponent(url.pathname.split("/")[3] || "");
        const response = await createBikeProgressUpdate(bikeId, payload);
        sendJson(res, response.statusCode, response.body);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/fines") {
        sendJson(res, 200, {
          items: await listFines()
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/contraventions") {
        sendJson(res, 200, {
          ...await getContraventions(),
          runner: getFineMonitorRunnerState()
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/contraventions/refresh") {
        const response = startFineMonitorProcess("manual");
        sendJson(res, response.statusCode, response.body);
        return;
      }

      if (req.method === "PUT" && url.pathname === "/api/contraventions/frequency") {
        const response = await saveFineMonitorFrequency((await readJson(req)).frequency);
        sendJson(res, response.statusCode, response.body);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/data/dashboard") {
        try {
          sendJson(res, 200, {
            ...await getDataDashboard({
              month: url.searchParams.get("month"),
              date: url.searchParams.get("date")
            }),
            runner: getDataSyncRunnerState()
          });
        } catch (error) {
          if (error.statusCode !== 400) throw error;
          sendJson(res, 400, { error: error.message });
        }
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/data/fleet") {
        sendJson(res, 200, {
          ...await getFleet(),
          latestRun: await getLatestSerializedRun(),
          runner: getDataSyncRunnerState()
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/data/payments") {
        const payments = await getDataPayments();
        sendJson(res, 200, {
          ...payments,
          items: await attachSourceStatements(payments.items).catch(() => payments.items),
          runner: getDataSyncRunnerState()
        });
        return;
      }

      if (req.method === "DELETE" && /^\/api\/data\/payments\/[^/]+$/.test(url.pathname)) {
        const response = await deleteDataPayment(decodeURIComponent(url.pathname.split("/")[4] || ""));
        if (response.statusCode === 200 && response.body.payment) {
          // The deposit is no longer in the sheet, so its bank entry goes back to pending.
          await reopenSyncedEntry(response.body.payment).catch(() => {});
        }
        sendJson(res, response.statusCode, response.body);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/data/refresh") {
        const response = startDataSyncProcess("manual");
        sendJson(res, response.statusCode, response.body);
        return;
      }

      if (req.method === "PUT" && url.pathname === "/api/data/interval") {
        const response = await saveDataSyncIntervalDays((await readJson(req)).intervalDays);
        sendJson(res, response.statusCode, response.body);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/bank-statements/upload") {
        const response = await uploadBankStatement(req);
        sendJson(res, response.statusCode, response.body);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/bank-statements/bikers") {
        const from = url.searchParams.get("from");
        const to = url.searchParams.get("to");
        const response = await listRegisteredBikers(/^\d{4}-\d{2}-\d{2}$/.test(from || "") && /^\d{4}-\d{2}-\d{2}$/.test(to || "") ? { start: from, end: to } : undefined);
        sendJson(res, response.statusCode, response.body);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/bank-statements/sync-payment") {
        const response = await syncBankPayment(await readJson(req));
        sendJson(res, response.statusCode, response.body);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/bank-statements/aliases") {
        const response = await listAliases();
        sendJson(res, response.statusCode, response.body);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/bank-statements/aliases") {
        const response = await saveAlias(await readJson(req));
        sendJson(res, response.statusCode, response.body);
        return;
      }

      if (req.method === "DELETE" && /^\/api\/bank-statements\/aliases\/[^/]+$/.test(url.pathname)) {
        const response = await removeAlias(decodeURIComponent(url.pathname.split("/")[4] || ""));
        sendJson(res, response.statusCode, response.body);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/bank-statements/skip-entry") {
        const response = await skipBankEntry(await readJson(req));
        sendJson(res, response.statusCode, response.body);
        return;
      }

      if (req.method === "POST" && /^\/api\/bank-statements\/[^/]+\/reopen-skipped$/.test(url.pathname)) {
        const payload = await readJson(req);
        const response = await reopenSkippedEntries(
          decodeURIComponent(url.pathname.split("/")[3] || ""),
          { onlyBulk: payload?.onlyBulk !== false }
        );
        sendJson(res, response.statusCode, response.body);
        return;
      }

      if (req.method === "POST" && /^\/api\/bank-statements\/[^/]+\/reopen-unmatched$/.test(url.pathname)) {
        const response = await reopenUnmatchedRecorded(decodeURIComponent(url.pathname.split("/")[3] || ""));
        sendJson(res, response.statusCode, response.body);
        return;
      }

      if (req.method === "POST" && /^\/api\/bank-statements\/[^/]+\/audit$/.test(url.pathname)) {
        const payload = await readJson(req);
        const response = await auditStatementAgainstSheet(
          decodeURIComponent(url.pathname.split("/")[3] || ""),
          { write: Boolean(payload?.write) }
        );
        sendJson(res, response.statusCode, response.body);
        return;
      }

      if (req.method === "POST" && /^\/api\/bank-statements\/[^/]+\/verify$/.test(url.pathname)) {
        const response = await verifyBankStatement(decodeURIComponent(url.pathname.split("/")[3] || ""));
        sendJson(res, response.statusCode, response.body);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/bank-statements/undo-skip") {
        const response = await undoSkipEntry(await readJson(req));
        sendJson(res, response.statusCode, response.body);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/bank-statements/select-biker") {
        const response = await saveBikerSelection(await readJson(req));
        sendJson(res, response.statusCode, response.body);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/bank-statements/completed") {
        const response = await listCompletedStatements();
        sendJson(res, response.statusCode, response.body);
        return;
      }

      if (req.method === "DELETE" && /^\/api\/bank-statements\/[^/]+$/.test(url.pathname)) {
        const response = await discardBankStatement(decodeURIComponent(url.pathname.split("/")[3] || ""));
        sendJson(res, response.statusCode, response.body);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/bank-statements") {
        const response = await listBankStatements();
        sendJson(res, response.statusCode, response.body);
        return;
      }

      if (req.method === "GET" && /^\/api\/bank-statements\/[^/]+$/.test(url.pathname)) {
        const statementId = decodeURIComponent(url.pathname.split("/")[3] || "");
        const response = await getBankStatement(statementId);
        sendJson(res, response.statusCode, response.body);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/fines") {
        const payload = await readJson(req);
        const response = await createFine(payload);
        sendJson(res, response.statusCode, response.body);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/templates") {
        sendJson(res, 200, {
          items: await listSmsTemplates()
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/templates") {
        const payload = await readJson(req);
        const response = await createSmsTemplate(payload);
        sendJson(res, response.statusCode, response.body);
        return;
      }

      if (req.method === "PUT" && /^\/api\/templates\/[^/]+$/.test(url.pathname)) {
        const payload = await readJson(req);
        const templateId = decodeURIComponent(url.pathname.split("/")[3] || "");
        const response = await updateSmsTemplate(templateId, payload);
        sendJson(res, response.statusCode, response.body);
        return;
      }

      if (req.method === "DELETE" && /^\/api\/templates\/[^/]+$/.test(url.pathname)) {
        const templateId = decodeURIComponent(url.pathname.split("/")[3] || "");
        const response = await deleteSmsTemplate(templateId);
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

        const fallbackPath = path.extname(url.pathname) || isLoginPagePath(url.pathname)
          ? null
          : path.join(env.DASHBOARD_PUBLIC_DIR, "index.html");
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
