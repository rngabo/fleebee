const runtimeConfig = window.FLEEBEE_CONFIG || {};

function isLoopbackHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function resolveApiBaseUrl(configuredUrl) {
  const fallbackUrl = window.location.origin;
  const rawUrl = typeof configuredUrl === "string" ? configuredUrl.trim() : "";

  if (!rawUrl) {
    return fallbackUrl.replace(/\/$/, "");
  }

  try {
    const apiUrl = new URL(rawUrl, fallbackUrl);
    const pageUrl = new URL(window.location.href);

    if (isLoopbackHost(apiUrl.hostname) && !isLoopbackHost(pageUrl.hostname)) {
      apiUrl.hostname = pageUrl.hostname;
    }

    return apiUrl.toString().replace(/\/$/, "");
  } catch {
    return rawUrl;
  }
}

function formatIdleTimeout(ms) {
  const totalMinutes = Math.max(1, Math.round(ms / 60000));
  if (totalMinutes < 60) {
    return `${totalMinutes} minute${totalMinutes === 1 ? "" : "s"}`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!minutes) {
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }

  return `${hours}h ${minutes}m`;
}

function normalizeRedirectTarget(value) {
  const target = String(value || "").trim();
  if (!target.startsWith("/") || target.startsWith("//") || target.startsWith("/login")) {
    return "/";
  }

  return target;
}

const API_BASE = resolveApiBaseUrl(runtimeConfig.apiBaseUrl);
const APP_NAME = runtimeConfig.appName || "Fleebee Dispatch Desk";
const SESSION_IDLE_TIMEOUT_MS = Number(runtimeConfig.sessionIdleTimeoutMs || 15 * 60 * 1000);
const params = new URLSearchParams(window.location.search);
const redirectTarget = normalizeRedirectTarget(params.get("redirect"));

const appNameLabel = document.getElementById("loginAppName");
const idleCopy = document.getElementById("loginIdleCopy");
const loginForm = document.getElementById("loginForm");
const passwordInput = document.getElementById("loginPassword");
const submitButton = document.getElementById("loginSubmit");
const notice = document.getElementById("loginNotice");

function setNotice(message, tone = "muted") {
  if (!notice) {
    return;
  }

  notice.textContent = message;
  notice.style.color = tone === "error" ? "#b3261e" : tone === "success" ? "#17804a" : "#5b6779";
}

function renderReason() {
  const reason = params.get("reason");
  if (reason === "expired") {
    setNotice("Your session expired because there was no activity. Sign in again to continue.", "error");
    return;
  }

  if (reason === "logged-out") {
    setNotice("You have been logged out.", "success");
    return;
  }

  if (reason === "auth-required") {
    setNotice("Sign in first to open the Fleebee dashboard.");
  }
}

async function login(password) {
  const response = await fetch(`${API_BASE}/api/session/login`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ password })
  });

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    throw new Error(
      typeof payload === "string"
        ? payload || `Login failed with ${response.status}`
        : payload.error || `Login failed with ${response.status}`
    );
  }

  return payload;
}

document.title = `${APP_NAME} — Login`;

if (appNameLabel) {
  appNameLabel.textContent = APP_NAME;
}

if (idleCopy) {
  idleCopy.textContent = `Sessions expire after ${formatIdleTimeout(SESSION_IDLE_TIMEOUT_MS)} without activity.`;
}

renderReason();

if (loginForm) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const password = String(passwordInput?.value || "");
    if (!password) {
      setNotice("Enter the login password first.", "error");
      passwordInput?.focus();
      return;
    }

    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Signing in...";
    }

    setNotice("");

    try {
      await login(password);
      window.location.replace(redirectTarget);
    } catch (error) {
      setNotice(error.message, "error");
      passwordInput?.focus();
      passwordInput?.select();
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = "Sign In";
      }
    }
  });
}

passwordInput?.focus();
