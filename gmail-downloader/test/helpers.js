const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const SENDER = "bkebanking@bk.rw";
const SUBJECT = "BK INTERNET BANKING STATEMENT FROM 01/11/2026 TO 05/11/2026";
const AUTH_OK = "mx.google.com; dkim=pass header.i=@bk.rw header.s=sel header.b=abc; spf=pass smtp.mailfrom=bkebanking@bk.rw";

function makePdf(tag = "a", { extra = "" } = {}) {
  return Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n% ${tag} ${"x".repeat(300)}\n${extra}\ntrailer << /Root 1 0 R >>\n%%EOF\n`, "latin1");
}

function email({ id, from = `BK <${SENDER}>`, subject = SUBJECT, internalDate, auth = AUTH_OK, attachments = [] }) {
  return {
    id,
    internalDate: String(internalDate),
    payload: {
      headers: [{ name: "From", value: from }, { name: "Subject", value: subject }, ...(auth ? [{ name: "Authentication-Results", value: auth }] : [])],
      parts: [{ mimeType: "text/plain", body: {} }, ...attachments.map((a, i) => ({ filename: a.filename, mimeType: a.mimeType || "application/pdf", body: { attachmentId: `${id}-att${i}` } }))]
    },
    attachments: Object.fromEntries(attachments.map((a, i) => [`${id}-att${i}`, a.data]))
  };
}

// A tiny fake of Google's token endpoint and the Gmail REST API.
async function startMock({ messages = [], labelName = "Fleebee/BankStatements", failMessage = new Set() } = {}) {
  const calls = { token: 0, list: 0, get: [], attachments: [], queries: [] };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const json = (body, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
    if (url.pathname === "/token") {
      calls.token += 1;
      return json({ access_token: `at-${calls.token}`, expires_in: 3600, scope: "https://www.googleapis.com/auth/gmail.readonly" });
    }
    if (req.headers.authorization?.startsWith("Bearer at-") !== true) return json({ error: "unauthorized" }, 401);
    const base = "/gmail/v1/users/me/";
    const route = url.pathname.slice(base.length);
    if (route === "profile") return json({ emailAddress: "me@example.com" });
    if (route === "labels") return json({ labels: [{ id: "L1", name: labelName }, { id: "L2", name: "INBOX" }] });
    if (route === "messages") { calls.list += 1; calls.queries.push(url.searchParams.get("q")); return json({ messages: messages.map((m) => ({ id: m.id })) }); }
    const attachment = /^messages\/([^/]+)\/attachments\/(.+)$/.exec(route);
    if (attachment) {
      calls.attachments.push(attachment[2]);
      const message = messages.find((m) => m.id === attachment[1]);
      return json({ data: message.attachments[attachment[2]].toString("base64url") });
    }
    const single = /^messages\/(.+)$/.exec(route);
    if (single) {
      calls.get.push(single[1]);
      if (failMessage.has(single[1])) return json({ error: "boom" }, 400);
      const message = messages.find((m) => m.id === single[1]);
      const { attachments, ...rest } = message;
      return json(rest);
    }
    return json({ error: "not found" }, 404);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, calls, messages, close: () => new Promise((resolve) => server.close(resolve)) };
}

function makeConfig(base, overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gmail-dl-"));
  const config = {
    scope: "https://www.googleapis.com/auth/gmail.readonly",
    credentialsFile: path.join(dir, "gmail", "credentials.json"),
    tokenFile: path.join(dir, "gmail", "token.json"),
    stateFile: path.join(dir, "gmail", "state.json"),
    statusFile: path.join(dir, "gmail", "status.json"),
    downloadDir: path.join(dir, "inbox"),
    label: "Fleebee/BankStatements",
    sender: SENDER,
    subjectPrefix: "BK INTERNET BANKING STATEMENT FROM",
    maxPdfBytes: 1024 * 1024,
    maxMessagesPerRun: 50,
    requireSenderAuth: true,
    apiBase: base,
    tokenUrlOverride: `${base}/token`,
    ...overrides
  };
  fs.mkdirSync(path.dirname(config.credentialsFile), { recursive: true });
  fs.writeFileSync(config.credentialsFile, JSON.stringify({ installed: { client_id: "cid", client_secret: "secret", token_uri: `${base}/token` } }));
  fs.writeFileSync(config.tokenFile, JSON.stringify({ refresh_token: "rt", scope: config.scope }), { mode: 0o600 });
  return { config, dir };
}

const listFiles = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).filter((f) => f.endsWith(".pdf")) : []);

module.exports = { SENDER, SUBJECT, AUTH_OK, email, listFiles, makeConfig, makePdf, startMock };
