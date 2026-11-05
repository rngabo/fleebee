const { createGmailClient } = require("./gmail-client");
const { AuthError } = require("./oauth");
const { loadConfig } = require("./config");
const { checkMessage, checkPdf, displayFilename, pdfCandidates, subjectOf } = require("./validate");
const { acquireLock, ensureStart, loadState, pruneOldPdfs, savePdf, saveState, writeStatus } = require("./store");
const { sha256 } = require("./files");

const unixSeconds = (ms) => Math.floor(ms / 1000);

// One polling pass. A single bad email is recorded and skipped; only authorization problems abort the run.
async function runPass(config, { gmail = createGmailClient(config), log = console.log, now = Date.now, retryRejected = false } = {}) {
  const release = acquireLock(config, now());
  if (!release) { log("Another run is in progress; nothing to do."); return { skipped: "locked", errors: 0 }; }
  try {
    const state = loadState(config);
    const sinceMs = ensureStart(config, state, now());
    if (retryRejected) {
      for (const [id, entry] of Object.entries(state.messages)) if (entry.outcome === "rejected") delete state.messages[id];
    }
    const summary = { saved: 0, duplicates: 0, rejected: 0, ignored: 0, errors: 0, pruned: 0, labelFound: true };
    summary.pruned = pruneOldPdfs(config, state, now());
    if (summary.pruned) { log(`Removed ${summary.pruned} PDF(s) older than ${config.retentionDays} days.`); saveState(config, state); }

    const labelId = await gmail.findLabelId(config.label);
    if (!labelId) {
      log(`Label "${config.label}" does not exist in Gmail yet; nothing to do.`);
      return { ...summary, labelFound: false };
    }
    const ids = await gmail.listMessageIds({
      labelId, limit: config.maxMessagesPerRun,
      query: `from:${config.sender} after:${unixSeconds(sinceMs)} has:attachment`
    });

    for (const id of ids) {
      if (state.messages[id]) continue;                       // handled before: never download twice
      const at = new Date(now()).toISOString();
      try {
        const message = await gmail.getMessage(id);
        const reason = checkMessage(message, { sender: config.sender, subjectPrefix: config.subjectPrefix, requireSenderAuth: config.requireSenderAuth, sinceMs });
        if (reason) {
          state.messages[id] = { outcome: "rejected", reason, at };
          summary[reason === "older-than-start" ? "ignored" : "rejected"] += 1;
          log(`Message ${id}: not accepted (${reason}).`);
          saveState(config, state);
          continue;
        }
        const files = [];
        const problems = [];
        for (const part of pdfCandidates(message)) {
          const buffer = await gmail.getAttachment(id, part.body.attachmentId);
          const problem = checkPdf(buffer, { maxBytes: config.maxPdfBytes });
          if (problem) { problems.push(problem); continue; }
          const hash = sha256(buffer);
          if (state.hashes[hash]) {
            summary.duplicates += 1;
            files.push(state.hashes[hash].file);
            log(`Message ${id}: same PDF already saved (${hash.slice(0, 12)}).`);
            continue;
          }
          const saved = savePdf(config, { buffer, receivedMs: Number(message.internalDate) });
          state.hashes[hash] = {
            file: saved.file, messageId: id, bytes: buffer.length, savedAt: at,
            // what the statement page shows: the email's subject, when it arrived, and the attachment's own name
            subject: subjectOf(message), receivedAt: new Date(Number(message.internalDate)).toISOString(), originalName: displayFilename(part.filename)
          };
          files.push(saved.file);
          summary.saved += 1;
          log(`Message ${id}: saved ${saved.file}`);
        }
        if (files.length) {
          state.messages[id] = { outcome: "saved", files, at };
        } else {
          const why = problems[0] || "no-pdf";
          state.messages[id] = { outcome: "rejected", reason: why, at };
          summary.rejected += 1;
          log(`Message ${id}: no usable PDF (${why}).`);
        }
      } catch (error) {
        if (error instanceof AuthError) throw error;
        summary.errors += 1;                                  // transient: not recorded, retried on the next run
        log(`Message ${id}: failed, will retry (${error.message}).`);
      }
      saveState(config, state);
    }
    saveState(config, state);
    log(`Done: ${summary.saved} saved, ${summary.duplicates} duplicate, ${summary.rejected} rejected, ${summary.errors} errors.`);
    return summary;
  } finally {
    release();
  }
}

// Runs one pass and records the outcome in the heartbeat file (also when it fails, so the control center can say why).
async function runOnce(config, options = {}) {
  try {
    const summary = await runPass(config, options);
    if (!summary.skipped) {
      const state = loadState(config);
      writeStatus(config, {
        outcome: summary.errors ? "partial" : "ok",
        auth: "ok",
        since: state.since,
        summary: { saved: summary.saved, duplicates: summary.duplicates, rejected: summary.rejected, errors: summary.errors, labelFound: summary.labelFound },
        totals: {
          pdfsSaved: Object.values(state.hashes).filter((entry) => !entry.removedAt).length,
          pdfsRemoved: Object.values(state.hashes).filter((entry) => entry.removedAt).length,
          emailsRejected: Object.values(state.messages).filter((entry) => entry.outcome === "rejected").length
        }
      });
    }
    return summary;
  } catch (error) {
    try {
      writeStatus(config, { outcome: "error", auth: error instanceof AuthError ? "needs-authorization" : "unknown", message: String(error.message || error).slice(0, 300) });
    } catch (ignored) { /* the original error matters more */ }
    throw error;
  }
}

if (require.main === module) {
  runOnce(loadConfig(), { retryRejected: process.argv.includes("--retry-rejected") })
    .then((summary) => { process.exitCode = summary.errors ? 1 : 0; })
    .catch((error) => {
      console.error(error instanceof AuthError ? `AUTHORIZATION PROBLEM: ${error.message}` : `Run failed: ${error.message}`);
      process.exitCode = error instanceof AuthError ? 2 : 1;
    });
}

module.exports = { runOnce };
