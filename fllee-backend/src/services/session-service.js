const crypto = require("node:crypto");

const { env } = require("../config/env");

const sessions = new Map();

function sessionDurationSeconds() {
  return Math.max(1, Math.floor(env.APP_SESSION_IDLE_TIMEOUT_MS / 1000));
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseCookies(cookieHeader) {
  return String(cookieHeader || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, pair) => {
      const separatorIndex = pair.indexOf("=");
      if (separatorIndex === -1) {
        return cookies;
      }

      const name = pair.slice(0, separatorIndex).trim();
      const value = pair.slice(separatorIndex + 1).trim();
      if (name) {
        cookies[name] = safeDecodeURIComponent(value);
      }

      return cookies;
    }, {});
}

function signSessionId(sessionId) {
  return crypto
    .createHmac("sha256", env.APP_SESSION_SECRET)
    .update(sessionId)
    .digest("base64url");
}

function buildSessionCookieValue(sessionId) {
  return `${sessionId}.${signSessionId(sessionId)}`;
}

function sessionCookieHeader(value, maxAgeSeconds) {
  const parts = [
    `${env.APP_SESSION_COOKIE_NAME}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`
  ];

  if (env.APP_SESSION_COOKIE_SECURE) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function clearExpiredSessions(referenceTime = Date.now()) {
  for (const [sessionId, session] of sessions.entries()) {
    if (referenceTime - session.lastActivityAt > env.APP_SESSION_IDLE_TIMEOUT_MS) {
      sessions.delete(sessionId);
    }
  }
}

function parseSessionId(cookieValue) {
  const [sessionId, signature, ...extraParts] = String(cookieValue || "").split(".");
  if (!sessionId || !signature || extraParts.length > 0) {
    return null;
  }

  const expected = signSessionId(sessionId);
  const actualBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");

  if (actualBuffer.length !== expectedBuffer.length) {
    return null;
  }

  if (!crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
    return null;
  }

  return sessionId;
}

function getSessionLookup(req, { allowExpired = false } = {}) {
  clearExpiredSessions();

  const cookies = parseCookies(req.headers.cookie);
  const rawCookie = cookies[env.APP_SESSION_COOKIE_NAME];
  if (!rawCookie) {
    return { session: null, sessionId: "", reason: "missing" };
  }

  const sessionId = parseSessionId(rawCookie);
  if (!sessionId) {
    return { session: null, sessionId: "", reason: "invalid" };
  }

  const session = sessions.get(sessionId);
  if (!session) {
    return { session: null, sessionId, reason: "missing" };
  }

  if (!allowExpired && Date.now() - session.lastActivityAt > env.APP_SESSION_IDLE_TIMEOUT_MS) {
    sessions.delete(sessionId);
    return { session: null, sessionId, reason: "expired" };
  }

  return { session, sessionId, reason: "" };
}

function serializeSession(session) {
  return {
    authenticated: true,
    expiresAt: new Date(session.lastActivityAt + env.APP_SESSION_IDLE_TIMEOUT_MS).toISOString(),
    idleTimeoutMs: env.APP_SESSION_IDLE_TIMEOUT_MS
  };
}

function setSessionCookie(res, sessionId) {
  res.setHeader(
    "Set-Cookie",
    sessionCookieHeader(buildSessionCookieValue(sessionId), sessionDurationSeconds())
  );
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", sessionCookieHeader("", 0));
}

function createSession() {
  clearExpiredSessions();

  const sessionId = crypto.randomBytes(24).toString("hex");
  const now = Date.now();
  const session = {
    createdAt: now,
    lastActivityAt: now
  };

  sessions.set(sessionId, session);
  return { sessionId, session };
}

function readBrowserSession(req) {
  const lookup = getSessionLookup(req);
  if (!lookup.session) {
    return {
      authenticated: false,
      reason: lookup.reason === "expired" ? "expired" : "auth-required"
    };
  }

  return {
    authenticated: true,
    sessionId: lookup.sessionId,
    session: lookup.session,
    body: serializeSession(lookup.session)
  };
}

function touchBrowserSession(req, res) {
  const lookup = getSessionLookup(req);
  if (!lookup.session) {
    clearSessionCookie(res);
    return {
      authenticated: false,
      reason: lookup.reason === "expired" ? "expired" : "auth-required"
    };
  }

  lookup.session.lastActivityAt = Date.now();
  setSessionCookie(res, lookup.sessionId);

  return {
    authenticated: true,
    body: serializeSession(lookup.session)
  };
}

function destroyBrowserSession(req, res) {
  const lookup = getSessionLookup(req, { allowExpired: true });
  if (lookup.sessionId) {
    sessions.delete(lookup.sessionId);
  }

  clearSessionCookie(res);
}

module.exports = {
  clearSessionCookie,
  createSession,
  destroyBrowserSession,
  readBrowserSession,
  setSessionCookie,
  touchBrowserSession
};
