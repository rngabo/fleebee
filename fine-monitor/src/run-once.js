const { config, validateConfig } = require("./config");
const { FleebeeClient } = require("./fleebee-client");
const { scrapePlate } = require("./irembo-scraper");

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function randomDelay(minimum, maximum) {
  const low = Math.min(minimum, maximum);
  const high = Math.max(minimum, maximum);
  return Math.floor(low + Math.random() * (high - low + 1));
}

async function main() {
  validateConfig();

  const client = new FleebeeClient({
    baseUrl: config.fleebeeBaseUrl,
    serviceToken: config.serviceToken,
    timeoutMs: config.timeoutMs
  });
  const started = await client.startRun(config.plateNumber, config.trigger);
  const runId = started.run.id;
  const counts = {
    FOUND: 0,
    CLEAR: 0,
    FAILED: 0,
    SKIPPED: 0
  };
  let haltReason = "";

  for (let index = 0; index < started.targets.length; index += 1) {
    const target = started.targets[index];
    let result;

    if (haltReason) {
      result = {
        state: "SKIPPED",
        fines: [],
        errorCode: "CHECK_HALTED",
        errorMessage: haltReason
      };
    } else {
      for (let attempt = 0; attempt <= config.retryLimit; attempt += 1) {
        try {
          result = await scrapePlate({
            plateNumber: target.plateNumber,
            taxpayerNumber: config.taxpayerNumber,
            targetUrl: config.targetUrl,
            browserExecutable: config.browserExecutable,
            timeoutMs: config.timeoutMs,
            artifactDirectory: config.artifactDirectory
          });
        } catch (error) {
          result = {
            state: "FAILED",
            fines: [],
            errorCode: "WORKER_FAILURE",
            errorMessage: String(error?.message || error).slice(0, 500)
          };
        }

        result.retryCount = attempt;
        const canRetry = result.state === "FAILED"
          && ["SCRAPER_FAILURE", "WORKER_FAILURE"].includes(result.errorCode)
          && attempt < config.retryLimit;
        if (!canRetry) {
          break;
        }
        await wait(Math.min(config.delayMaxMs, config.delayMinMs * (2 ** attempt)));
      }

      if (result.errorCode === "CAPTCHA_DETECTED") {
        haltReason = "The run stopped because Irembo presented an anti-automation challenge.";
      }
    }

    await client.recordTarget(runId, target.bikeId, result);
    counts[result.state] += result.state === "FOUND" ? result.fines.length : 1;

    if (!haltReason && index < started.targets.length - 1) {
      await wait(randomDelay(config.delayMinMs, config.delayMaxMs));
    }
  }

  const completed = await client.completeRun(runId, haltReason);

  process.stdout.write(`${JSON.stringify({
    runId,
    targetCount: started.targets.length,
    foundCount: counts.FOUND,
    clearCount: counts.CLEAR,
    failedCount: counts.FAILED,
    skippedCount: counts.SKIPPED,
    status: completed.run.status,
  })}\n`);
}

main().catch((error) => {
  console.error(`Fine monitor could not complete: ${error.message}`);
  process.exit(1);
});
