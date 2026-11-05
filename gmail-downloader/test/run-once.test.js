const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { runOnce } = require("../src/run-once");
const { AuthError, authorizeInteractive } = require("../src/oauth");
const { AUTH_OK, SENDER, email, listFiles, makeConfig, makePdf, startMock } = require("./helpers");

const NOW = Date.parse("2026-11-05T10:00:00Z");
const BEFORE = NOW - 3 * 86400000;     // an email that arrived before the downloader was switched on
const AFTER = NOW + 60 * 1000;
const quiet = () => {};

// Starts the downloader "at NOW" (this fixes the start point), then lets the clock move on.
async function prepare(messages, configOverrides = {}, mockOptions = {}) {
  const mock = await startMock({ messages, ...mockOptions });
  const { config, dir } = makeConfig(mock.base, configOverrides);
  fs.writeFileSync(config.stateFile, JSON.stringify({ since: new Date(NOW).toISOString(), messages: {}, hashes: {} }));
  const run = (options = {}) => runOnce(config, { log: quiet, now: () => AFTER + 1000, ...options });
  return { mock, config, dir, run };
}

test("a new statement email is downloaded, stored privately and recorded", async () => {
  const pdf = makePdf("one");
  const { mock, config, dir, run } = await prepare([email({ id: "m1", internalDate: AFTER, attachments: [{ filename: "../../etc/evil.pdf", data: pdf }] })]);
  const summary = await run();
  assert.equal(summary.saved, 1);
  const files = listFiles(config.downloadDir);
  assert.equal(files.length, 1);
  assert.match(files[0], /^2026-11[/\\]bk-statement_2026-11-05_[0-9a-f]{12}\.pdf$/);    // name never taken from the email
  const stored = path.join(config.downloadDir, files[0]);
  assert.deepEqual(fs.readFileSync(stored), pdf);
  assert.equal(fs.statSync(stored).mode & 0o777, 0o600);
  assert.equal(fs.statSync(config.downloadDir).mode & 0o777, 0o700);
  assert.equal(fs.statSync(config.stateFile).mode & 0o777, 0o600);
  assert.equal(fs.existsSync(path.join(dir, "etc")), false);
  const record = Object.values(JSON.parse(fs.readFileSync(config.stateFile, "utf8")).hashes)[0];
  assert.equal(record.subject, "BK INTERNET BANKING STATEMENT FROM 01/11/2026 TO 05/11/2026");
  assert.equal(record.receivedAt, new Date(AFTER).toISOString());
  assert.equal(record.originalName, "evil.pdf");               // display only, path stripped
  await mock.close();
});

test("emails received before the downloader started are never processed", async () => {
  const { mock, run, config } = await prepare([email({ id: "old", internalDate: BEFORE, attachments: [{ filename: "s.pdf", data: makePdf("old") }] })]);
  const summary = await run();
  assert.equal(summary.saved, 0);
  assert.equal(summary.ignored, 1);
  assert.deepEqual(mock.calls.attachments, []);          // the attachment was not even downloaded
  assert.equal(listFiles(config.downloadDir).length, 0);
  assert.match(mock.calls.queries[0], new RegExp(`after:${Math.floor(NOW / 1000)}`));
  await mock.close();
});

test("the very first run fixes the start point to 'now' and processes nothing old", async () => {
  const mock = await startMock({ messages: [email({ id: "old", internalDate: BEFORE, attachments: [{ filename: "s.pdf", data: makePdf("old") }] })] });
  const { config } = makeConfig(mock.base);
  const summary = await runOnce(config, { log: quiet, now: () => NOW });
  assert.equal(summary.saved, 0);
  assert.equal(JSON.parse(fs.readFileSync(config.stateFile, "utf8")).since, new Date(NOW).toISOString());
  await mock.close();
});

test("the same PDF is never saved twice, across emails and across runs", async () => {
  const pdf = makePdf("same");
  const { mock, config, run } = await prepare([
    email({ id: "m1", internalDate: AFTER, attachments: [{ filename: "a.pdf", data: pdf }] }),
    email({ id: "m2", internalDate: AFTER + 1000, attachments: [{ filename: "b.pdf", data: pdf }] })
  ]);
  const first = await run();
  assert.equal(first.saved, 1);
  assert.equal(first.duplicates, 1);
  const again = await run();
  assert.equal(again.saved, 0);
  assert.deepEqual(mock.calls.get.sort(), ["m1", "m2"]);   // already-handled messages are not fetched again
  assert.equal(listFiles(config.downloadDir).length, 1);
  await mock.close();
});

test("wrong sender, wrong subject, forged sender and bad PDFs are rejected and remembered", async () => {
  const cases = [
    email({ id: "spoof", from: "BK <bkebanking@bk.rw.evil.com>", internalDate: AFTER, attachments: [{ filename: "a.pdf", data: makePdf("1") }] }),
    email({ id: "subject", subject: "Invoice FROM BK", internalDate: AFTER, attachments: [{ filename: "a.pdf", data: makePdf("2") }] }),
    email({ id: "unauth", auth: "mx.google.com; dkim=fail header.d=bk.rw; spf=fail smtp.mailfrom=bkebanking@bk.rw", internalDate: AFTER, attachments: [{ filename: "a.pdf", data: makePdf("3") }] }),
    email({ id: "noauth", auth: "", internalDate: AFTER, attachments: [{ filename: "a.pdf", data: makePdf("4") }] }),
    email({ id: "fakepdf", internalDate: AFTER, attachments: [{ filename: "a.pdf", data: Buffer.from("MZ not a pdf ".repeat(40)) }] }),
    email({ id: "active", internalDate: AFTER, attachments: [{ filename: "a.pdf", data: makePdf("5", { extra: "<< /S /JavaScript /JS (app.alert(1)) >>" }) }] }),
    email({ id: "cut", internalDate: AFTER, attachments: [{ filename: "a.pdf", data: Buffer.from(`%PDF-1.4 ${"y".repeat(400)}`) }] }),
    email({ id: "big", internalDate: AFTER, attachments: [{ filename: "a.pdf", data: Buffer.concat([makePdf("6"), Buffer.alloc(2 * 1024 * 1024)]) }] }),
    email({ id: "textonly", internalDate: AFTER, attachments: [{ filename: "a.txt", mimeType: "text/plain", data: Buffer.from("hi") }] })
  ];
  const { mock, config, run } = await prepare(cases);
  const summary = await run();
  assert.equal(summary.saved, 0);
  assert.equal(summary.rejected, 9);
  const state = JSON.parse(fs.readFileSync(config.stateFile, "utf8"));
  const reasons = Object.fromEntries(Object.entries(state.messages).map(([id, entry]) => [id, entry.reason]));
  assert.deepEqual(reasons, {
    spoof: "wrong-sender", subject: "wrong-subject", unauth: "sender-not-authenticated", noauth: "sender-not-authenticated",
    fakepdf: "not-a-pdf", active: "active-content", cut: "truncated-pdf", big: "too-large", textonly: "no-pdf"
  });
  assert.equal(listFiles(config.downloadDir).length, 0);
  await mock.close();
});

test("subject matching is by prefix, ignoring case, and the sender may be shown with a name", async () => {
  const { mock, config, run } = await prepare([
    email({ id: "ok", subject: "bk internet banking statement from 2026", from: `"BK e-Banking" <${SENDER.toUpperCase()}>`, internalDate: AFTER, attachments: [{ filename: "a.pdf", data: makePdf("ok") }] })
  ]);
  assert.equal((await run()).saved, 1);
  assert.equal(listFiles(config.downloadDir).length, 1);
  await mock.close();
});

test("sender authentication can be switched off explicitly", async () => {
  const { mock, config, run } = await prepare(
    [email({ id: "m", auth: "", internalDate: AFTER, attachments: [{ filename: "a.pdf", data: makePdf("x") }] })],
    { requireSenderAuth: false }
  );
  assert.equal((await run()).saved, 1);
  assert.equal(listFiles(config.downloadDir).length, 1);
  await mock.close();
});

test("a temporary failure on one email is retried next run and does not block the others", async () => {
  const failing = new Set(["bad"]);
  const { mock, config, run } = await prepare(
    [
      email({ id: "bad", internalDate: AFTER, attachments: [{ filename: "a.pdf", data: makePdf("bad") }] }),
      email({ id: "good", internalDate: AFTER + 1, attachments: [{ filename: "a.pdf", data: makePdf("good") }] })
    ],
    {}, { failMessage: failing }
  );
  const first = await run();
  assert.deepEqual([first.saved, first.errors], [1, 1]);
  failing.delete("bad");
  const second = await run();
  assert.deepEqual([second.saved, second.errors], [1, 0]);
  assert.equal(listFiles(config.downloadDir).length, 2);
  await mock.close();
});

test("a missing Gmail label is not an error", async () => {
  const { mock, run } = await prepare([], {}, { labelName: "Something else" });
  const summary = await run();
  assert.equal(summary.labelFound, false);
  assert.equal(mock.calls.list, 0);
  await mock.close();
});

test("rejected emails can be retried on request", async () => {
  const { mock, config, run } = await prepare([email({ id: "m", auth: "", internalDate: AFTER, attachments: [{ filename: "a.pdf", data: makePdf("r") }] })]);
  assert.equal((await run()).rejected, 1);
  config.requireSenderAuth = false;
  assert.equal((await run()).saved, 0);                       // still remembered as rejected
  assert.equal((await run({ retryRejected: true })).saved, 1);
  await mock.close();
});

test("only one run at a time", async () => {
  const { mock, config, run } = await prepare([]);
  fs.writeFileSync(`${config.stateFile}.lock`, "");
  assert.equal((await run()).skipped, "locked");
  await mock.close();
});

test("access tokens are refreshed, cached and stored privately; the refresh token is kept", async () => {
  const { mock, config, run } = await prepare([]);
  await run();
  await run();
  assert.equal(mock.calls.token, 1);                           // cached for the second run
  const token = JSON.parse(fs.readFileSync(config.tokenFile, "utf8"));
  assert.equal(token.refresh_token, "rt");
  assert.equal(fs.statSync(config.tokenFile).mode & 0o777, 0o600);
  await mock.close();
});

test("a token with more than read-only Gmail access is refused", async () => {
  const { mock, config, run } = await prepare([]);
  fs.writeFileSync(config.tokenFile, JSON.stringify({ refresh_token: "rt", scope: `${config.scope} https://mail.google.com/` }));
  await assert.rejects(run, (error) => error instanceof AuthError && /more access than read-only/.test(error.message));
  await mock.close();
});

test("without authorization the run explains what to do", async () => {
  const { mock, config, run } = await prepare([]);
  fs.rmSync(config.tokenFile);
  await assert.rejects(run, (error) => error instanceof AuthError && /npm run authorize/.test(error.message));
  await mock.close();
});

test("authorization stores a read-only token and rejects a mismatched state", async () => {
  const mock = await startMock();
  const { config } = makeConfig(mock.base);
  fs.rmSync(config.tokenFile);
  // fake Google's token endpoint answering the code exchange
  const grant = (await import("node:http")).createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ access_token: "at-1", refresh_token: "rt-new", expires_in: 3600, scope: config.scope }));
  });
  await new Promise((resolve) => grant.listen(0, "127.0.0.1", resolve));
  config.tokenUrlOverride = `http://127.0.0.1:${grant.address().port}`;

  let url;
  const port = 18765;
  const done = authorizeInteractive(config, { port, log: (text) => { url = /(https:\/\/\S+)/.exec(text)[1]; } }).then(() => null, (error) => error);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const state = new URL(url).searchParams.get("state");
  assert.equal(new URL(url).searchParams.get("scope"), config.scope);
  assert.equal(new URL(url).searchParams.get("code_challenge_method"), "S256");
  const bad = await fetch(`http://127.0.0.1:${port}/callback?code=x&state=wrong`);
  assert.equal(bad.status, 400);
  assert.match((await done).message, /state mismatch/);

  const again = authorizeInteractive(config, { port, log: (text) => { url = /(https:\/\/\S+)/.exec(text)[1]; } });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const good = await fetch(`http://127.0.0.1:${port}/callback?code=abc&state=${new URL(url).searchParams.get("state")}`);
  assert.equal(good.status, 200, await good.clone().text());
  await again;
  const token = JSON.parse(fs.readFileSync(config.tokenFile, "utf8"));
  assert.equal(token.refresh_token, "rt-new");
  assert.equal(fs.statSync(config.tokenFile).mode & 0o777, 0o600);
  void state;
  await mock.close();
  await new Promise((resolve) => grant.close(resolve));
  assert.ok(AUTH_OK);
});

test("every pass writes a heartbeat the control center can read, without secrets", async () => {
  const { mock, config, run } = await prepare([email({ id: "m1", internalDate: AFTER, attachments: [{ filename: "a.pdf", data: makePdf("hb") }] })]);
  await run();
  const status = JSON.parse(fs.readFileSync(config.statusFile, "utf8"));
  assert.equal(status.outcome, "ok");
  assert.equal(status.auth, "ok");
  assert.deepEqual(status.summary, { saved: 1, duplicates: 0, rejected: 0, errors: 0, labelFound: true });
  assert.deepEqual(status.totals, { pdfsSaved: 1, emailsRejected: 0 });
  assert.equal(status.scope, config.scope);
  assert.ok(Date.parse(status.checkedAt) > 0);
  assert.equal(Object.keys(status).includes("refresh_token"), false);
  assert.equal(fs.statSync(config.statusFile).mode & 0o777, 0o600);
  await mock.close();
});

test("a failed authorization is recorded in the heartbeat, then the error is still raised", async () => {
  const { mock, config, run } = await prepare([]);
  fs.rmSync(config.tokenFile);
  await assert.rejects(run, AuthError);
  const status = JSON.parse(fs.readFileSync(config.statusFile, "utf8"));
  assert.equal(status.outcome, "error");
  assert.equal(status.auth, "needs-authorization");
  assert.match(status.message, /npm run authorize/);
  await mock.close();
});
