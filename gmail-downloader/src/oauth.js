const crypto = require("node:crypto");
const http = require("node:http");
const { readJson, writeFileAtomic } = require("./files");

const DEFAULT_TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const EXPIRY_MARGIN_MS = 60 * 1000;

class AuthError extends Error {}

function loadCredentials(config) {
  const raw = readJson(config.credentialsFile, null);
  const client = raw?.installed || raw?.web;
  if (!client?.client_id || !client?.client_secret) {
    throw new AuthError(`OAuth client credentials not found in ${config.credentialsFile}.`);
  }
  return { clientId: client.client_id, clientSecret: client.client_secret, tokenUrl: config.tokenUrlOverride || client.token_uri || DEFAULT_TOKEN_URL };
}

async function postForm(url, params) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(30000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = body.error || `HTTP ${response.status}`;
    const message = `Google token endpoint refused the request: ${reason}${body.error_description ? ` (${body.error_description})` : ""}`;
    if (reason === "invalid_grant" || reason === "invalid_client" || reason === "unauthorized_client") throw new AuthError(`${message}. Run "npm run authorize" again.`);
    throw new Error(message);
  }
  return body;
}

// Only read-only access is ever accepted: a token that carries any other Gmail scope is refused.
function assertReadOnlyScope(scopeText, config) {
  const scopes = String(scopeText || "").split(/\s+/).filter(Boolean);
  const gmailScopes = scopes.filter((scope) => scope.includes("mail.google.com") || scope.includes("auth/gmail"));
  if (!gmailScopes.includes(config.scope)) throw new AuthError(`The token does not have ${config.scope}.`);
  if (gmailScopes.some((scope) => scope !== config.scope)) throw new AuthError(`The token has more access than read-only (${gmailScopes.join(", ")}). Revoke it and authorize again.`);
}

function saveToken(config, token) {
  writeFileAtomic(config.tokenFile, `${JSON.stringify(token, null, 2)}\n`);
}

async function getAccessToken(config, now = Date.now()) {
  const token = readJson(config.tokenFile, null);
  if (!token?.refresh_token) throw new AuthError(`No Gmail authorization found at ${config.tokenFile}. Run "npm run authorize" once.`);
  assertReadOnlyScope(token.scope, config);
  if (token.access_token && token.expires_at && token.expires_at - EXPIRY_MARGIN_MS > now) return token.access_token;

  const credentials = loadCredentials(config);
  const refreshed = await postForm(credentials.tokenUrl, {
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    refresh_token: token.refresh_token,
    grant_type: "refresh_token"
  });
  saveToken(config, {
    ...token,
    access_token: refreshed.access_token,
    expires_at: now + Number(refreshed.expires_in || 3600) * 1000,
    scope: refreshed.scope || token.scope,
    ...(refreshed.refresh_token ? { refresh_token: refreshed.refresh_token } : {})
  });
  return refreshed.access_token;
}

// One-time authorization: authorization-code flow with PKCE, answered on a loopback port (Desktop OAuth client).
function authorizeInteractive(config, { port = 8765, timeoutMs = 10 * 60 * 1000, log = console.log, now = Date.now } = {}) {
  const credentials = loadCredentials(config);
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const state = crypto.randomBytes(16).toString("hex");
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const url = `${AUTH_URL}?${new URLSearchParams({
    client_id: credentials.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: config.scope,
    access_type: "offline",
    prompt: "consent",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256"
  })}`;

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const requested = new URL(req.url, redirectUri);
      if (requested.pathname !== "/callback") { res.statusCode = 404; return res.end(); }
      const finish = (status, text) => { res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", Connection: "close" }); res.end(text); };
      try {
        if (requested.searchParams.get("state") !== state) throw new AuthError("Authorization response did not match this request (state mismatch).");
        if (requested.searchParams.get("error")) throw new AuthError(`Google reported: ${requested.searchParams.get("error")}`);
        const code = requested.searchParams.get("code");
        if (!code) throw new AuthError("No authorization code was returned.");
        const granted = await postForm(credentials.tokenUrl, {
          client_id: credentials.clientId, client_secret: credentials.clientSecret, code, code_verifier: verifier,
          redirect_uri: redirectUri, grant_type: "authorization_code"
        });
        assertReadOnlyScope(granted.scope, config);
        if (!granted.refresh_token) throw new AuthError("Google returned no refresh token. Remove the app from your Google account's connected apps and authorize again.");
        saveToken(config, {
          refresh_token: granted.refresh_token, access_token: granted.access_token,
          expires_at: now() + Number(granted.expires_in || 3600) * 1000, scope: granted.scope, authorized_at: new Date(now()).toISOString()
        });
        finish(200, "Fleebee Gmail downloader authorized (read-only). You can close this tab.");
        clearTimeout(timer);
        server.close();
        server.closeIdleConnections?.();
        resolve();
      } catch (error) {
        finish(400, `Authorization failed: ${error.message}`);
        clearTimeout(timer);
        server.close();
        server.closeIdleConnections?.();
        reject(error);
      }
    });
    const timer = setTimeout(() => { server.close(); reject(new AuthError("Timed out waiting for authorization.")); }, timeoutMs);
    server.on("error", (error) => { clearTimeout(timer); reject(error); });
    server.listen(port, "127.0.0.1", () => log(`Open this link in a browser and approve read-only access:\n\n${url}\n`));
  });
}

module.exports = { AuthError, assertReadOnlyScope, authorizeInteractive, getAccessToken, loadCredentials };
