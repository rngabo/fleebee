const fs = require("node:fs");
const path = require("node:path");

const { chromium } = require("playwright-core");

const { parseFineRow } = require("./parse-result");

const NO_FINE_TEXT = "Iki kinyabiziga nta konterevasiyo gifite.";

async function saveFailureScreenshot(page, artifactDirectory) {
  if (!artifactDirectory) {
    return;
  }

  fs.mkdirSync(artifactDirectory, { recursive: true });
  const outputPath = path.join(artifactDirectory, `failure-${Date.now()}.png`);
  await page.screenshot({ path: outputPath, fullPage: true }).catch(() => {});
}

async function waitForEnabled(locator, timeoutMs) {
  await locator.waitFor({ state: "visible", timeout: timeoutMs });
  const startedAt = Date.now();

  while (await locator.isDisabled()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Irembo search button did not become enabled.");
    }
    await locator.page().waitForTimeout(200);
  }
}

async function openTrafficFineForm(page, targetUrl, timeoutMs) {
  await page.goto(targetUrl, {
    waitUntil: "domcontentloaded",
    timeout: timeoutMs
  });
  await page.waitForTimeout(5000);

  const plateRadio = page.locator('input[type="radio"][value="PLATE_NUMBER"]').first();
  if (await plateRadio.count()) {
    return plateRadio;
  }

  const directApplyButton = page.locator("#apply_btn:visible").last();
  if (await directApplyButton.count()) {
    await directApplyButton.click();
    await plateRadio.waitFor({ state: "attached", timeout: timeoutMs });
    return plateRadio;
  }

  const serviceSearch = page.locator('input[type="text"]').first();
  await serviceSearch.waitFor({ state: "visible", timeout: timeoutMs });
  await serviceSearch.fill("Traffic Fines");

  const serviceCard = page
    .getByText(/^(Kwishyura konterevasiyo|Traffic Fines)$/i, { exact: true })
    .first();
  await serviceCard.waitFor({ state: "visible", timeout: timeoutMs });
  await serviceCard.click();

  const applyButton = page.getByText(/^(Saba|Apply)$/i, { exact: true }).last();
  await applyButton.waitFor({ state: "visible", timeout: timeoutMs });
  await applyButton.click();

  await plateRadio.waitFor({ state: "attached", timeout: timeoutMs });
  return plateRadio;
}

async function scrapePlate({
  plateNumber,
  taxpayerNumber,
  targetUrl,
  browserExecutable,
  timeoutMs,
  artifactDirectory
}) {
  const browser = await chromium.launch({
    ...(browserExecutable ? { executablePath: browserExecutable } : {}),
    headless: true,
    args: ["--disable-dev-shm-usage"]
  });
  const context = await browser.newContext({
    locale: "rw-RW",
    viewport: {
      width: 1365,
      height: 900
    }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(timeoutMs);

  try {
    const plateRadio = await openTrafficFineForm(page, targetUrl, timeoutMs);
    const plateRadioId = await plateRadio.getAttribute("id");
    const plateRadioLabel = plateRadioId
      ? page.locator(`label[for="${plateRadioId}"]`)
      : plateRadio.locator("xpath=ancestor::mat-radio-button//label");
    await plateRadioLabel.click();
    if (!await plateRadio.isChecked()) {
      throw new Error("Irembo did not select the plate-number lookup option.");
    }

    const plateInput = page.locator('input[formcontrolname="plateNumberFormControl"]').first();
    const taxpayerInput = page.locator('input[formcontrolname="taxpayerNoFormControl"]').first();
    await plateInput.waitFor({ state: "visible", timeout: timeoutMs });
    await taxpayerInput.waitFor({ state: "visible", timeout: timeoutMs });
    await plateInput.fill(plateNumber);
    await taxpayerInput.fill(taxpayerNumber);

    const searchButton = page.locator("button:has(i-search):visible").last();
    await waitForEnabled(searchButton, timeoutMs);
    await searchButton.click();

    await page.waitForFunction(
      (noFineText) => {
        const hasRows = document.querySelectorAll("div.table-container mat-row").length > 0;
        const alertText = [...document.querySelectorAll('[role="alert"].alert-fill-danger')]
          .map((node) => (node.textContent || "").replace(/\s+/g, " ").trim())
          .join(" ");
        const hasCaptcha = Boolean(document.querySelector('iframe[src*="captcha" i], iframe[src*="recaptcha" i], [class*="captcha" i]'));
        return hasRows || alertText.includes(noFineText) || Boolean(alertText) || hasCaptcha;
      },
      NO_FINE_TEXT,
      { timeout: timeoutMs }
    );

    const captchaVisible = await page.locator('iframe[src*="captcha" i], iframe[src*="recaptcha" i], [class*="captcha" i]').count();
    if (captchaVisible) {
      return {
        state: "FAILED",
        fines: [],
        errorCode: "CAPTCHA_DETECTED",
        errorMessage: "Irembo presented an anti-automation challenge; the check stopped without bypassing it."
      };
    }

    const rows = page.locator("div.table-container mat-row");
    const rowCount = await rows.count();
    if (rowCount > 0) {
      const fines = [];
      for (let index = 0; index < rowCount; index += 1) {
        const row = rows.nth(index);
        fines.push(parseFineRow({
          ticketNumber: await row.locator(".cdk-column-ticketNumber").innerText(),
          issuedDate: await row.locator(".cdk-column-ticketIssuanceDate").innerText(),
          dueDate: await row.locator(".cdk-column-ticketValidityDate").innerText(),
          reason: await row.locator(".cdk-column-ticketDescription").innerText(),
          amount: await row.locator(".cdk-column-ticketAmount").innerText()
        }));
      }

      return {
        state: "FOUND",
        fines,
        retryCount: 0
      };
    }

    const alerts = await page.locator('[role="alert"].alert-fill-danger').allInnerTexts();
    const alertText = alerts.join(" ").replace(/\s+/g, " ").trim();
    if (alertText.includes(NO_FINE_TEXT)) {
      return {
        state: "CLEAR",
        fines: [],
        retryCount: 0
      };
    }

    return {
      state: "FAILED",
      fines: [],
      errorCode: "IREMBO_FORM_ERROR",
      errorMessage: alertText.slice(0, 500) || "Irembo returned an unrecognized form result."
    };
  } catch (error) {
    await plateInputSafeClear(page);
    await saveFailureScreenshot(page, artifactDirectory);
    return {
      state: "FAILED",
      fines: [],
      errorCode: "SCRAPER_FAILURE",
      errorMessage: String(error?.message || error).slice(0, 500),
      retryCount: 0
    };
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function plateInputSafeClear(page) {
  await page.locator('input[formcontrolname="taxpayerNoFormControl"]').fill("").catch(() => {});
  await page.locator('input[formcontrolname="plateNumberFormControl"]').fill("").catch(() => {});
}

module.exports = {
  NO_FINE_TEXT,
  scrapePlate
};
