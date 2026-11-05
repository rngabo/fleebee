// Fills in subject / arrival time / attachment name for PDFs saved before those were recorded. Read-only on Gmail.
const { loadConfig } = require("./config");
const { createGmailClient } = require("./gmail-client");
const { pdfCandidates, displayFilename, subjectOf } = require("./validate");
const { loadState, saveState } = require("./store");

(async () => {
  const config = loadConfig();
  const gmail = createGmailClient(config);
  const state = loadState(config);
  let filled = 0;
  for (const entry of Object.values(state.hashes)) {
    if (entry.receivedAt) continue;
    const message = await gmail.getMessage(entry.messageId);
    const part = pdfCandidates(message)[0];
    Object.assign(entry, { subject: subjectOf(message), receivedAt: new Date(Number(message.internalDate)).toISOString(), originalName: displayFilename(part?.filename) });
    filled += 1;
  }
  saveState(config, state);
  console.log(`Filled in ${filled} record(s).`);
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
