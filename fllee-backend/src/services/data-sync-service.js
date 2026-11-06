const { createHash, randomUUID } = require("node:crypto");

const { prisma } = require("../lib/prisma");
const { calculateDashboard } = require("./dashboard-calculator");
const {
  SYNC_NOTE,
  SheetError,
  isAppNote,
  refOf,
  deleteSyncedPayment,
  isConfigured: sheetConfigured
} = require("./payments-sheet-service");

const INTERVAL_SETTING_ID = "data_sync_interval_days";
const DEFAULT_INTERVAL_DAYS = 2;
const TERMINAL_RUN_STATES = ["COMPLETED", "PARTIAL", "FAILED"];

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeName(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizePlate(value) {
  return cleanText(value).toUpperCase().replace(/\s+/g, "");
}

function normalizePhone(value) {
  const digits = cleanText(value).replace(/\D/g, "");
  return /^7\d{8}$/.test(digits) ? `0${digits}` : digits;
}

function asInteger(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function asDate(value) {
  const raw = cleanText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function serializeRun(run) {
  if (!run) return null;
  return {
    id: run.id,
    trigger: run.trigger,
    status: run.status,
    spreadsheetId: run.spreadsheetId,
    memberCount: run.memberCount,
    paymentCount: run.paymentCount,
    dashboardRowCount: run.dashboardRowCount,
    linkedMemberCount: run.linkedMemberCount,
    createdBikerCount: run.createdBikerCount,
    createdBikeCount: run.createdBikeCount,
    conflictCount: run.conflictCount,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt ? run.completedAt.toISOString() : null,
    errorMessage: run.errorMessage || ""
  };
}

function buildDisplayName(biker) {
  return [biker?.name, biker?.firstName].map(cleanText).filter(Boolean).join(" ");
}

function buildCoreIndexes(bikers) {
  const byPlate = new Map();
  const byName = new Map();
  const byPhone = new Map();

  for (const biker of bikers) {
    const name = normalizeName(buildDisplayName(biker));
    const phone = normalizePhone(biker.phoneNumber);
    if (name) byName.set(name, [...(byName.get(name) || []), biker]);
    if (phone) byPhone.set(phone, [...(byPhone.get(phone) || []), biker]);
    for (const bike of biker.bikes || []) {
      const plate = normalizePlate(bike.plateNumber);
      if (plate) byPlate.set(plate, { biker, bike });
    }
  }
  return { byPlate, byName, byPhone };
}

function splitName(sourceName) {
  const parts = cleanText(sourceName).split(" ").filter(Boolean);
  return {
    name: parts.shift() || sourceName,
    firstName: parts.join(" ")
  };
}

function findIdentityMatch(source, indexes) {
  const sourceName = normalizeName(source.sourceName);
  const sourcePhone = normalizePhone(source.sourcePhone);
  const sourcePlate = normalizePlate(source.sourcePlate);
  const nameMatches = indexes.byName.get(sourceName) || [];
  if (nameMatches.length === 1) {
    const biker = nameMatches[0];
    const bike = (biker.bikes || []).find((item) => normalizePlate(item.plateNumber) === sourcePlate) || null;
    return { biker, bike, matchedBy: "name" };
  }

  const phoneMatches = sourcePhone ? indexes.byPhone.get(sourcePhone) || [] : [];
  if (phoneMatches.length === 1) {
    const biker = phoneMatches[0];
    const bike = (biker.bikes || []).find((item) => normalizePlate(item.plateNumber) === sourcePlate) || null;
    return { biker, bike, matchedBy: "phone number" };
  }
  return null;
}

function matchExistingMember(source, indexes) {
  const sourceName = normalizeName(source.sourceName);
  const sourcePhone = normalizePhone(source.sourcePhone);
  const sourcePlate = normalizePlate(source.sourcePlate);
  const plateMatch = sourcePlate ? indexes.byPlate.get(sourcePlate) : null;

  if (plateMatch) {
    const existingName = normalizeName(buildDisplayName(plateMatch.biker));
    const existingPhone = normalizePhone(plateMatch.biker.phoneNumber);
    const identityMatches = existingName === sourceName || (sourcePhone && existingPhone === sourcePhone);
    const active = cleanText(source.sourceStatus).toLowerCase() === "active";
    if (identityMatches) {
      const differences = [];
      if (existingName !== sourceName) differences.push("name");
      if (sourcePhone && existingPhone !== sourcePhone) differences.push("phone");
      return {
        biker: plateMatch.biker,
        bike: plateMatch.bike,
        matchStatus: differences.length ? "LINKED_WITH_DIFFERENCE" : "LINKED",
        matchNote: differences.length
          ? `Matched by plate; sheet ${differences.join(" and ")} differs from Fleebee.`
          : "Matched an existing Fleebee bike by plate."
      };
    }
    if (active && cleanText(plateMatch.biker.status).toLowerCase() === "inactive") {
      return {
        replacement: plateMatch,
        matchStatus: "REPLACEMENT_PENDING"
      };
    }
    if (active) {
      return {
        biker: null,
        bike: null,
        matchStatus: "CONFLICT",
        matchNote: "Plate belongs to a different active Fleebee biker."
      };
    }
    return {
      biker: null,
      bike: null,
      matchStatus: "HISTORICAL",
      matchNote: "The inactive sheet row uses a plate now linked to another biker."
    };
  }

  const identityMatch = findIdentityMatch(source, indexes);
  if (identityMatch) {
    return {
      biker: identityMatch.biker,
      bike: identityMatch.bike,
      matchStatus: "LINKED",
      matchNote: `Matched an existing Fleebee biker by ${identityMatch.matchedBy}.`
    };
  }

  return null;
}

function addBikerToIndexes(biker, indexes) {
  const name = normalizeName(buildDisplayName(biker));
  const phone = normalizePhone(biker.phoneNumber);
  if (name) indexes.byName.set(name, [...(indexes.byName.get(name) || []), biker]);
  if (phone) indexes.byPhone.set(phone, [...(indexes.byPhone.get(phone) || []), biker]);
}

async function replaceInactivePlateOwner(tx, source, indexes, replacement) {
  const sourcePhone = normalizePhone(source.sourcePhone);
  const sourcePlate = normalizePlate(source.sourcePlate);
  let identityMatch = findIdentityMatch(source, indexes);
  let biker = identityMatch?.biker || null;
  let createdBiker = false;

  if (!biker) {
    if (!/^\d{10,15}$/.test(sourcePhone)) {
      return {
        biker: null,
        bike: null,
        matchStatus: "CONFLICT",
        matchNote: "Active replacement member has no valid SMS phone number."
      };
    }
    const names = splitName(source.sourceName);
    biker = await tx.biker.create({
      data: {
        id: randomUUID(),
        name: names.name,
        firstName: names.firstName,
        phoneNumber: sourcePhone,
        bikePlate: sourcePlate,
        bikeModel: replacement.bike.bikeModel || "",
        status: "Active",
        notes: `Created from accounting Sheet person ${source.sourcePersonId}.`
      },
      include: { bikes: true }
    });
    addBikerToIndexes(biker, indexes);
    createdBiker = true;
  }

  const bike = await tx.bike.update({
    where: { id: replacement.bike.id },
    data: { bikerId: biker.id }
  });
  replacement.biker.bikes = (replacement.biker.bikes || [])
    .filter((item) => item.id !== bike.id);
  biker.bikes = [...(biker.bikes || []).filter((item) => item.id !== bike.id), bike];
  indexes.byPlate.set(sourcePlate, { biker, bike });

  return {
    biker,
    bike,
    matchStatus: createdBiker ? "CREATED" : "LINKED",
    matchNote: createdBiker
      ? "Created the active replacement biker and transferred the bike from its inactive former owner."
      : `Matched an existing Fleebee biker by ${identityMatch.matchedBy} and transferred the bike from its inactive former owner.`,
    createdBike: false
  };
}

async function createMissingCoreRecords(tx, source, indexes) {
  const active = cleanText(source.sourceStatus).toLowerCase() === "active";
  if (!active) {
    return {
      biker: null,
      bike: null,
      matchStatus: "HISTORICAL",
      matchNote: "Inactive accounting history was retained without creating an operational biker."
    };
  }

  const sourcePhone = normalizePhone(source.sourcePhone);
  const sourcePlate = normalizePlate(source.sourcePlate);
  if (!/^\d{10,15}$/.test(sourcePhone)) {
    return {
      biker: null,
      bike: null,
      matchStatus: "CONFLICT",
      matchNote: "Active sheet member has no valid SMS phone number."
    };
  }
  if (sourcePlate && indexes.byPlate.has(sourcePlate)) {
    return {
      biker: null,
      bike: null,
      matchStatus: "CONFLICT",
      matchNote: "Plate already belongs to a different Fleebee biker."
    };
  }

  const names = splitName(source.sourceName);
  const biker = await tx.biker.create({
    data: {
      id: randomUUID(),
      name: names.name,
      firstName: names.firstName,
      phoneNumber: sourcePhone,
      bikePlate: sourcePlate,
      bikeModel: "",
      status: "Active",
      notes: `Created from accounting Sheet person ${source.sourcePersonId}.`
    },
    include: { bikes: true }
  });
  let bike = null;
  if (sourcePlate) {
    bike = await tx.bike.create({
      data: {
        id: randomUUID(),
        bikerId: biker.id,
        plateNumber: sourcePlate,
        notes: `Created from accounting Sheet person ${source.sourcePersonId}.`
      }
    });
    biker.bikes.push(bike);
  }

  addBikerToIndexes(biker, indexes);
  if (sourcePlate && bike) indexes.byPlate.set(sourcePlate, { biker, bike });

  return {
    biker,
    bike,
    matchStatus: "CREATED",
    matchNote: "Created missing active biker data from the accounting Sheet."
  };
}

function validateSyncPayload(payload) {
  if (!Array.isArray(payload?.members) || !Array.isArray(payload?.payments)) {
    return "Data sync requires members and payments arrays.";
  }
  if (!payload.dashboard || !Array.isArray(payload.dashboard.rows)) {
    return "Data sync requires a dashboard snapshot with rows.";
  }
  if (payload.members.length === 0) return "The Setup tab returned no members.";
  return "";
}

async function createDataSyncRun(payload = {}) {
  const active = await prisma.dataSyncRun.findFirst({
    where: { status: "RUNNING" },
    orderBy: { startedAt: "desc" }
  });
  if (active) {
    return { statusCode: 409, body: { error: "A data sync is already running.", run: serializeRun(active) } };
  }
  const spreadsheetId = cleanText(payload.spreadsheetId);
  if (!spreadsheetId) {
    return { statusCode: 400, body: { error: "Spreadsheet id is required." } };
  }
  const run = await prisma.dataSyncRun.create({
    data: {
      id: randomUUID(),
      trigger: cleanText(payload.trigger) || "manual",
      spreadsheetId
    }
  });
  return { statusCode: 201, body: { run: serializeRun(run) } };
}

async function applyDataSyncRun(runId, payload) {
  const payloadError = validateSyncPayload(payload);
  if (payloadError) return { statusCode: 400, body: { error: payloadError } };

  const existingRun = await prisma.dataSyncRun.findUnique({ where: { id: runId } });
  if (!existingRun) return { statusCode: 404, body: { error: "Data sync run was not found." } };
  if (existingRun.status !== "RUNNING") {
    return { statusCode: 409, body: { error: "Data sync run is already closed.", run: serializeRun(existingRun) } };
  }

  const completed = await prisma.$transaction(async (tx) => {
    const bikers = await tx.biker.findMany({ include: { bikes: true } });
    const indexes = buildCoreIndexes(bikers);
    const membersByPersonId = new Map();
    let linkedMemberCount = 0;
    let createdBikerCount = 0;
    let createdBikeCount = 0;
    let conflictCount = 0;
    const seenAt = new Date();

    await tx.dataMember.updateMany({ data: { isPresent: false } });
    for (const source of payload.members) {
      let match = matchExistingMember(source, indexes);
      if (match?.replacement) {
        match = await replaceInactivePlateOwner(tx, source, indexes, match.replacement);
      }
      if (!match) match = await createMissingCoreRecords(tx, source, indexes);
      if (match.matchStatus.startsWith("LINKED")) linkedMemberCount += 1;
      if (match.matchStatus === "CREATED") {
        createdBikerCount += 1;
        if (match.bike && match.createdBike !== false) createdBikeCount += 1;
      }
      if (match.matchStatus === "CONFLICT") conflictCount += 1;

      const data = {
        bikerId: match.biker?.id || null,
        bikeId: match.bike?.id || null,
        sourceStatus: cleanText(source.sourceStatus),
        sourceName: cleanText(source.sourceName),
        normalizedName: normalizeName(source.sourceName),
        startDate: asDate(source.startDate),
        batchCode: cleanText(source.batchCode),
        monthlyDueRwf: asInteger(source.monthlyDueRwf),
        weeklyDueRwf: asInteger(source.weeklyDueRwf),
        durationMonths: asInteger(source.durationMonths),
        dueDayOne: cleanText(source.dueDayOne),
        dueDayTwo: cleanText(source.dueDayTwo),
        firstMonthDueRwf: asInteger(source.firstMonthDueRwf),
        lastMonthDueRwf: asInteger(source.lastMonthDueRwf),
        notes: cleanText(source.notes),
        sourcePhone: normalizePhone(source.sourcePhone),
        sourcePlate: normalizePlate(source.sourcePlate),
        chargingCode: cleanText(source.chargingCode),
        extraChargesRwf: asInteger(source.extraChargesRwf, 0),
        activeNumber: asInteger(source.activeNumber),
        comment: cleanText(source.comment),
        sourceRowNumber: asInteger(source.sourceRowNumber, 0),
        sourceFingerprint: cleanText(source.sourceFingerprint),
        matchStatus: match.matchStatus,
        matchNote: match.matchNote,
        isPresent: true,
        lastSeenRunId: runId,
        lastSeenAt: seenAt
      };
      const member = await tx.dataMember.upsert({
        where: { sourcePersonId: cleanText(source.sourcePersonId) },
        update: data,
        create: { id: randomUUID(), sourcePersonId: cleanText(source.sourcePersonId), ...data }
      });
      membersByPersonId.set(member.sourcePersonId, member);
    }

    await tx.dataPayment.updateMany({ data: { isPresent: false } });
    let importedPayments = 0;
    for (const source of payload.payments) {
      const member = membersByPersonId.get(cleanText(source.sourcePersonId));
      const paymentDate = asDate(source.paymentDate);
      const amountRwf = asInteger(source.amountRwf);
      if (!member || !paymentDate || !Number.isInteger(amountRwf)) {
        conflictCount += 1;
        continue;
      }
      const data = {
        dataMemberId: member.id,
        bikerId: member.bikerId,
        paymentDate,
        amountRwf,
        paymentMethod: cleanText(source.paymentMethod),
        referenceNote: cleanText(source.referenceNote),
        enteredBy: cleanText(source.enteredBy),
        sourceRowNumber: asInteger(source.sourceRowNumber, 0),
        sourceFingerprint: cleanText(source.sourceFingerprint),
        isPresent: true,
        lastSeenRunId: runId,
        lastSeenAt: seenAt
      };
      await tx.dataPayment.upsert({
        where: { sourceKey: cleanText(source.sourceKey) },
        update: data,
        create: { id: randomUUID(), sourceKey: cleanText(source.sourceKey), ...data }
      });
      importedPayments += 1;
    }

    const dashboard = payload.dashboard;
    const totals = dashboard.totals || {};
    const snapshot = await tx.dataDashboardSnapshot.create({
      data: {
        id: randomUUID(),
        runId,
        selectedDate: asDate(dashboard.selectedDate),
        monthStart: asDate(dashboard.monthStart),
        monthEnd: asDate(dashboard.monthEnd),
        totalMonthlyDueRwf: asInteger(totals.totalMonthlyDueRwf, 0),
        totalPaidInMonthRwf: asInteger(totals.totalPaidInMonthRwf, 0),
        totalBalanceRwf: asInteger(totals.totalBalanceRwf, 0),
        totalPaidByDateRwf: asInteger(totals.totalPaidByDateRwf, 0),
        totalDueByDateRwf: asInteger(totals.totalDueByDateRwf, 0),
        totalOverallBalanceRwf: asInteger(totals.totalOverallBalanceRwf, 0)
      }
    });
    for (const row of dashboard.rows) {
      const member = membersByPersonId.get(cleanText(row.sourcePersonId));
      if (!member) {
        conflictCount += 1;
        continue;
      }
      await tx.dataDashboardRow.create({
        data: {
          id: randomUUID(),
          snapshotId: snapshot.id,
          dataMemberId: member.id,
          bikerId: member.bikerId,
          sourceName: cleanText(row.sourceName),
          batchCode: cleanText(row.batchCode),
          monthlyDueRwf: asInteger(row.monthlyDueRwf, 0),
          paidInMonthRwf: asInteger(row.paidInMonthRwf, 0),
          balanceRemainingRwf: asInteger(row.balanceRemainingRwf, 0),
          lastPaymentDate: asDate(row.lastPaymentDate),
          paidByDateRwf: asInteger(row.paidByDateRwf, 0),
          dueByDateRwf: asInteger(row.dueByDateRwf, 0),
          overallBalanceRwf: asInteger(row.overallBalanceRwf, 0),
          trackStatus: cleanText(row.trackStatus),
          note: cleanText(row.note),
          adjustmentAmountRwf: asInteger(row.adjustmentAmountRwf),
          adjustmentNote: cleanText(row.adjustmentNote),
          sourceRowNumber: asInteger(row.sourceRowNumber, 0)
        }
      });
    }

    return tx.dataSyncRun.update({
      where: { id: runId },
      data: {
        status: conflictCount ? "PARTIAL" : "COMPLETED",
        memberCount: payload.members.length,
        paymentCount: importedPayments,
        dashboardRowCount: dashboard.rows.length,
        linkedMemberCount,
        createdBikerCount,
        createdBikeCount,
        conflictCount,
        completedAt: seenAt,
        errorMessage: ""
      }
    });
  });

  return { statusCode: 200, body: { run: serializeRun(completed) } };
}

async function failDataSyncRun(runId, payload = {}) {
  const run = await prisma.dataSyncRun.findUnique({ where: { id: runId } });
  if (!run) return { statusCode: 404, body: { error: "Data sync run was not found." } };
  if (run.status !== "RUNNING") return { statusCode: 200, body: { run: serializeRun(run) } };
  const failed = await prisma.dataSyncRun.update({
    where: { id: runId },
    data: {
      status: "FAILED",
      completedAt: new Date(),
      errorMessage: cleanText(payload.errorMessage).slice(0, 500)
    }
  });
  return { statusCode: 200, body: { run: serializeRun(failed) } };
}

async function getDataSyncIntervalDays() {
  const setting = await prisma.appSetting.findUnique({ where: { id: INTERVAL_SETTING_ID } });
  const parsed = Number(setting?.value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 30 ? parsed : DEFAULT_INTERVAL_DAYS;
}

async function saveDataSyncIntervalDays(value) {
  const intervalDays = Number(value);
  if (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 30) {
    return { statusCode: 400, body: { error: "Data sync interval must be between 1 and 30 days." } };
  }
  await prisma.appSetting.upsert({
    where: { id: INTERVAL_SETTING_ID },
    update: { value: String(intervalDays) },
    create: { id: INTERVAL_SETTING_ID, value: String(intervalDays) }
  });
  return { statusCode: 200, body: await getDataSyncSchedule() };
}

async function getDataSyncSchedule() {
  const [intervalDays, latestRun] = await Promise.all([
    getDataSyncIntervalDays(),
    prisma.dataSyncRun.findFirst({
      where: { status: { in: TERMINAL_RUN_STATES } },
      orderBy: { startedAt: "desc" }
    })
  ]);
  const intervalMs = intervalDays * 24 * 60 * 60 * 1000;
  const anchor = latestRun?.completedAt || latestRun?.startedAt || null;
  const nextRunAt = anchor ? new Date(anchor.getTime() + intervalMs) : new Date();
  return {
    intervalDays,
    intervalMs,
    nextRunAt: nextRunAt.toISOString(),
    due: nextRunAt.getTime() <= Date.now()
  };
}

async function latestDataSyncRun() {
  return prisma.dataSyncRun.findFirst({ orderBy: { startedAt: "desc" } });
}

function kigaliToday() {
  return new Date(Date.now() + 2 * 3600 * 1000).toISOString().slice(0, 10);
}

function listMonths(firstMonth, lastMonth) {
  const months = [];
  let [year, month] = firstMonth.split("-").map(Number);
  const [lastYear, lastMonthNumber] = lastMonth.split("-").map(Number);
  while (year < lastYear || (year === lastYear && month <= lastMonthNumber)) {
    months.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return months;
}

async function getLatestSerializedRun() {
  return serializeRun(await latestDataSyncRun());
}

async function getDataDashboard({ month, date } = {}) {
  const [latestRun, schedule, members, payments, snapshot] = await Promise.all([
    latestDataSyncRun(),
    getDataSyncSchedule(),
    prisma.dataMember.findMany({ where: { isPresent: true }, orderBy: { sourceRowNumber: "asc" } }),
    prisma.dataPayment.findMany({
      where: { isPresent: true },
      select: { dataMemberId: true, paymentDate: true, amountRwf: true, referenceNote: true }
    }),
    prisma.dataDashboardSnapshot.findFirst({
      include: { rows: true },
      orderBy: { createdAt: "desc" }
    })
  ]);

  // Notes and manual adjustments are typed by hand into the sheet's Dashboard tab; carry them over.
  const adjustments = new Map();
  for (const row of snapshot?.rows || []) {
    if (!row.dataMemberId) continue;
    adjustments.set(row.dataMemberId, {
      amount: row.adjustmentAmountRwf,
      note: row.adjustmentNote,
      rowNote: row.note
    });
  }

  const today = kigaliToday();
  const selectedMonth = /^\d{4}-\d{2}$/.test(String(month || "")) ? month : today.slice(0, 7);
  const asOfDate = /^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))
    ? date
    : (selectedMonth === today.slice(0, 7) ? today : undefined);

  let dashboard;
  try {
    dashboard = calculateDashboard({ members, payments, month: selectedMonth, asOfDate, adjustments });
  } catch (error) {
    const invalid = new Error(error.message);
    invalid.statusCode = 400;
    throw invalid;
  }

  const startMonths = members.filter((member) => member.startDate).map((member) => member.startDate.toISOString().slice(0, 7)).sort();
  const lastListed = [today.slice(0, 7), selectedMonth].sort().pop();
  dashboard.availableMonths = startMonths.length ? listMonths(startMonths[0], lastListed).reverse() : [selectedMonth];

  return {
    latestRun: serializeRun(latestRun),
    schedule,
    sourceUrl: latestRun?.spreadsheetId
      ? `https://docs.google.com/spreadsheets/d/${latestRun.spreadsheetId}/edit`
      : "",
    members: members.map((member) => ({
      sourcePersonId: member.sourcePersonId,
      sourceName: member.sourceName,
      sourceStatus: member.sourceStatus,
      sourcePhone: member.sourcePhone,
      sourcePlate: member.sourcePlate,
      matchStatus: member.matchStatus,
      matchNote: member.matchNote
    })),
    dashboard
  };
}

async function getDataPayments() {
  const [latestRun, schedule, items] = await Promise.all([
    latestDataSyncRun(),
    getDataSyncSchedule(),
    prisma.dataPayment.findMany({
      where: { isPresent: true },
      include: { dataMember: true },
      orderBy: [{ paymentDate: "desc" }, { sourceRowNumber: "desc" }]
    })
  ]);
  return {
    latestRun: serializeRun(latestRun),
    schedule,
    items: items.map((item) => ({
      id: item.id,
      paymentDate: item.paymentDate.toISOString(),
      sourceName: item.dataMember.sourceName,
      sourcePlate: item.dataMember.sourcePlate,
      amountRwf: item.amountRwf,
      paymentMethod: item.paymentMethod,
      referenceNote: item.referenceNote,
      enteredBy: item.enteredBy,
      // Only rows added by this app (tagged in Reference/Notes) may be deleted from the app.
      deletable: isAppNote(item.referenceNote)
    }))
  };
}

// Every member with the contract terms and each payment, for the Analysis page (one chart per member).
async function getDataAnalysis() {
  const [latestRun, schedule, members] = await Promise.all([
    latestDataSyncRun(),
    getDataSyncSchedule(),
    prisma.dataMember.findMany({
      where: { isPresent: true },
      include: { payments: { where: { isPresent: true }, orderBy: { paymentDate: "asc" } } },
      orderBy: { sourceName: "asc" }
    })
  ]);
  return {
    latestRun: serializeRun(latestRun),
    schedule,
    members: members.map((member) => ({
      id: member.id,
      name: member.sourceName,
      plate: member.sourcePlate,
      batch: member.batchCode,
      status: member.sourceStatus,
      startDate: member.startDate ? member.startDate.toISOString() : null,
      monthlyDueRwf: member.monthlyDueRwf,
      weeklyDueRwf: member.weeklyDueRwf,
      durationMonths: member.durationMonths,
      payments: member.payments.map((payment) => ({ date: payment.paymentDate.toISOString().slice(0, 10), amountRwf: payment.amountRwf }))
    }))
  };
}

// A payment this app just wrote to the Google Sheet is recorded locally straight away (same key the
// next sheet import computes), so it shows on the Payments page, with its Delete button, without waiting.
async function recordSyncedPayment({ name, paymentDate, amountRwf, paymentMethod, sheetRow, note = SYNC_NOTE }) {
  const normalizedName = normalizeName(name);
  const member = await prisma.dataMember.findFirst({ where: { normalizedName, isPresent: true } });
  if (!member) return null;
  const fingerprint = createHash("sha256").update(JSON.stringify({
    sourcePersonId: member.sourcePersonId,
    normalizedName,
    paymentDate,
    amountRwf,
    paymentMethod,
    referenceNote: note,
    enteredBy: ""
  })).digest("hex");
  const sourceKey = `${fingerprint}:1`;
  const data = {
    dataMemberId: member.id,
    bikerId: member.bikerId,
    paymentDate: new Date(`${paymentDate}T00:00:00.000Z`),
    amountRwf,
    paymentMethod,
    referenceNote: note,
    enteredBy: "",
    sourceRowNumber: sheetRow || 0,
    sourceFingerprint: fingerprint,
    isPresent: true
  };
  return prisma.dataPayment.upsert({
    where: { sourceKey },
    update: data,
    create: { id: randomUUID(), sourceKey, ...data }
  });
}

async function deleteDataPayment(paymentId) {
  const payment = await prisma.dataPayment.findUnique({
    where: { id: paymentId },
    include: { dataMember: true }
  });
  if (!payment || !payment.isPresent) {
    return { statusCode: 404, body: { error: "Payment was not found." } };
  }
  if (!isAppNote(payment.referenceNote)) {
    return { statusCode: 403, body: { error: "Only payments synced from this app can be deleted here." } };
  }
  if (!sheetConfigured()) {
    return { statusCode: 503, body: { error: "Google Sheet syncing is not configured." } };
  }

  let sheetResult;
  try {
    sheetResult = await deleteSyncedPayment({
      date: payment.paymentDate.toISOString().slice(0, 10),
      name: payment.dataMember.sourceName,
      amount: payment.amountRwf,
      rowHint: payment.sourceRowNumber,
      ref: refOf(payment.referenceNote)
    });
  } catch (error) {
    if (error instanceof SheetError) {
      return { statusCode: error.statusCode === 403 || error.statusCode === 409 ? error.statusCode : 502, body: { error: error.message } };
    }
    throw error;
  }

  await prisma.dataPayment.delete({ where: { id: payment.id } });
  return {
    statusCode: 200,
    body: {
      ...sheetResult,
      id: payment.id,
      payment: {
        date: payment.paymentDate.toISOString().slice(0, 10),
        amount: payment.amountRwf,
        name: payment.dataMember.sourceName,
        ref: refOf(payment.referenceNote)
      }
    }
  };
}

module.exports = {
  applyDataSyncRun,
  createDataSyncRun,
  deleteDataPayment,
  failDataSyncRun,
  getDataDashboard,
  getDataAnalysis,
  getDataPayments,
  getLatestSerializedRun,
  getDataSyncIntervalDays,
  getDataSyncSchedule,
  latestDataSyncRun,
  recordSyncedPayment,
  saveDataSyncIntervalDays,
  serializeRun
};
