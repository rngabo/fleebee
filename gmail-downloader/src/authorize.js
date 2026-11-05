// One-time Gmail authorization (read-only). Run it where the token will be stored. On a headless machine forward the port:
//   ssh -L 8765:127.0.0.1:8765 richard@192.168.1.50      then, in that session:   node src/authorize.js
const { loadConfig } = require("./config");
const { authorizeInteractive } = require("./oauth");
const { createGmailClient } = require("./gmail-client");
const { loadState, ensureStart } = require("./store");

(async () => {
  const config = loadConfig();
  const portArg = process.argv.indexOf("--port");
  const minutesArg = process.argv.indexOf("--minutes");
  const timeoutMs = (minutesArg > 0 ? Number(process.argv[minutesArg + 1]) : 10) * 60 * 1000;
  await authorizeInteractive(config, { port: portArg > 0 ? Number(process.argv[portArg + 1]) : 8765, timeoutMs });
  const gmail = createGmailClient(config);
  const profile = await gmail.profile();
  const state = loadState(config);
  const startedAt = new Date(ensureStart(config, state)).toISOString();
  const labelId = await gmail.findLabelId(config.label);
  console.log(`Authorized mailbox: ${profile.emailAddress} (read-only).`);
  console.log(`Only emails received after ${startedAt} will ever be processed.`);
  console.log(labelId ? `Label "${config.label}" found.` : `Label "${config.label}" not found yet - create it and let your Gmail filter apply it.`);
})().catch((error) => { console.error(`Authorization failed: ${error.message}`); process.exitCode = 1; });
