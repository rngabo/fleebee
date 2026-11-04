const { randomUUID } = require("node:crypto");

const { prisma } = require("../lib/prisma");

const TERMINAL_STATES = new Set(["FOUND", "CLEAR", "FAILED", "SKIPPED"]);
const FREQUENCY_SETTING_ID = "fine_monitor_frequency";
const DEFAULT_FREQUENCY = "weekly";
const FREQUENCY_INTERVALS = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000
};

function normalizePlate(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function normalizeText(value) {
  return String(value || "").trim();
}

function buildBikerDisplayName(biker) {
  const familyName = normalizeText(biker?.name);
  const firstName = normalizeText(biker?.firstName);
  if (!firstName || familyName.toLowerCase().includes(firstName.toLowerCase())) {
    return familyName || firstName;
  }
  return [familyName, firstName].filter(Boolean).join(" ");
}

function normalizeDateOnly(value) {
  const text = normalizeText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return null;
  }

  const date = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function serializeRun(run) {
  if (!run) {
    return null;
  }

  return {
    id: run.id,
    trigger: run.trigger,
    status: run.status,
    targetCount: run.targetCount,
    foundCount: run.foundCount,
    clearCount: run.clearCount,
    failedCount: run.failedCount,
    skippedCount: run.skippedCount,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt ? run.completedAt.toISOString() : null,
    errorMessage: run.errorMessage || "",
    targets: Array.isArray(run.targets)
      ? run.targets.map((target) => ({
          id: target.id,
          bikeId: target.bikeId,
          bikerId: target.bikerId,
          bikerName: target.bikerName,
          plateNumber: target.plateNumber,
          state: target.state,
          fineCount: target.fineCount,
          errorCode: target.errorCode || "",
          errorMessage: target.errorMessage || "",
          retryCount: target.retryCount,
          checkedAt: target.checkedAt ? target.checkedAt.toISOString() : null
        }))
      : []
  };
}

async function eligibleTargets(plateFilter = "") {
  const requestedPlate = normalizePlate(plateFilter);
  const [bikes, bikers] = await Promise.all([
    prisma.bike.findMany({
      where: {
        plateNumber: {
          not: null
        }
      },
      include: {
        biker: true
      },
      orderBy: {
        createdAt: "asc"
      }
    }),
    prisma.biker.findMany({
      where: {
        bikePlate: {
          not: ""
        }
      },
      orderBy: {
        createdAt: "asc"
      }
    })
  ]);

  const currentPlates = new Set(bikes.map((bike) => normalizePlate(bike.plateNumber)).filter(Boolean));
  const legacyByPlate = new Map();
  for (const biker of bikers) {
    const plateNumber = normalizePlate(biker.bikePlate);
    if (!plateNumber || currentPlates.has(plateNumber) || (requestedPlate && plateNumber !== requestedPlate)) {
      continue;
    }

    const matches = legacyByPlate.get(plateNumber) || [];
    matches.push(biker);
    legacyByPlate.set(plateNumber, matches);
  }

  for (const [plateNumber, matches] of legacyByPlate.entries()) {
    if (matches.length !== 1) {
      continue;
    }

    const biker = matches[0];
    const bike = await prisma.bike.create({
      data: {
        id: randomUUID(),
        bikerId: biker.id,
        plateNumber,
        bikeModel: biker.bikeModel || null,
        notes: "Created from the existing legacy biker plate for Fine Monitor."
      },
      include: {
        biker: true
      }
    });
    bikes.push(bike);
    currentPlates.add(plateNumber);
  }

  const seen = new Set();
  const targets = [];

  for (const bike of bikes) {
    const plateNumber = normalizePlate(bike.plateNumber);
    if (!plateNumber || (requestedPlate && plateNumber !== requestedPlate) || seen.has(plateNumber)) {
      continue;
    }

    seen.add(plateNumber);
    targets.push({
      bikeId: bike.id,
      bikerId: bike.bikerId,
      bikerName: buildBikerDisplayName(bike.biker),
      plateNumber
    });
  }

  return targets;
}

function normalizeFrequency(value) {
  const normalized = normalizeText(value).toLowerCase();
  return Object.hasOwn(FREQUENCY_INTERVALS, normalized) ? normalized : DEFAULT_FREQUENCY;
}

async function getFineMonitorFrequency() {
  const setting = await prisma.appSetting.findUnique({
    where: {
      id: FREQUENCY_SETTING_ID
    }
  });
  return normalizeFrequency(setting?.value || DEFAULT_FREQUENCY);
}

async function saveFineMonitorFrequency(value) {
  const frequency = normalizeFrequency(value);
  if (normalizeText(value).toLowerCase() !== frequency) {
    return {
      statusCode: 400,
      body: {
        error: "Fine check frequency must be daily or weekly."
      }
    };
  }

  await prisma.appSetting.upsert({
    where: {
      id: FREQUENCY_SETTING_ID
    },
    update: {
      value: frequency
    },
    create: {
      id: FREQUENCY_SETTING_ID,
      value: frequency
    }
  });

  return {
    statusCode: 200,
    body: await getFineMonitorSchedule()
  };
}

async function getFineMonitorSchedule() {
  const [frequency, latestRun] = await Promise.all([
    getFineMonitorFrequency(),
    prisma.fineCheckRun.findFirst({
      where: {
        status: {
          in: ["COMPLETED", "PARTIAL", "INCOMPLETE"]
        }
      },
      orderBy: {
        startedAt: "desc"
      }
    })
  ]);
  const intervalMs = FREQUENCY_INTERVALS[frequency];
  const anchor = latestRun?.completedAt || latestRun?.startedAt || null;
  const nextRunAt = anchor ? new Date(anchor.getTime() + intervalMs) : new Date();

  return {
    frequency,
    intervalMs,
    nextRunAt: nextRunAt.toISOString(),
    due: nextRunAt.getTime() <= Date.now()
  };
}

async function createFineCheckRun(payload = {}) {
  const activeRun = await prisma.fineCheckRun.findFirst({
    where: {
      status: "RUNNING"
    },
    orderBy: {
      startedAt: "desc"
    }
  });
  if (activeRun) {
    return {
      statusCode: 409,
      body: {
        error: "A fine check is already running.",
        run: serializeRun(activeRun)
      }
    };
  }

  const targets = await eligibleTargets(payload.plateNumber);
  if (targets.length === 0) {
    return {
      statusCode: 404,
      body: {
        error: payload.plateNumber
          ? "The requested plate is not registered in Fleebee."
          : "No registered bike plates are available for checking."
      }
    };
  }

  const run = await prisma.fineCheckRun.create({
    data: {
      id: randomUUID(),
      trigger: normalizeText(payload.trigger) || "manual-canary",
      targetCount: targets.length,
      targets: {
        create: targets.map((target) => ({
          id: randomUUID(),
          ...target
        }))
      }
    },
    include: {
      targets: true
    }
  });

  return {
    statusCode: 201,
    body: {
      run: serializeRun(run),
      targets
    }
  };
}

function validateFineRow(raw) {
  const ticketNumber = normalizeText(raw.ticketNumber);
  const reason = normalizeText(raw.reason);
  const issuedDate = normalizeDateOnly(raw.issuedDate);
  const dueDate = raw.dueDate ? normalizeDateOnly(raw.dueDate) : null;
  const amountRwf = Number(raw.amountRwf);
  const amountDisplay = normalizeText(raw.amountDisplay);

  if (!ticketNumber || !reason || !issuedDate || !Number.isInteger(amountRwf) || amountRwf < 0) {
    return null;
  }

  return {
    ticketNumber,
    reason,
    issuedDate,
    dueDate,
    amountRwf,
    amountDisplay: amountDisplay || `RWF ${amountRwf.toLocaleString("en-US")}`
  };
}

async function refreshRunCounts(tx, runId) {
  const targets = await tx.fineCheckTargetResult.findMany({
    where: {
      runId
    },
    select: {
      state: true,
      fineCount: true
    }
  });

  const counts = {
    foundCount: 0,
    clearCount: 0,
    failedCount: 0,
    skippedCount: 0
  };

  for (const target of targets) {
    if (target.state === "FOUND") {
      counts.foundCount += target.fineCount;
    } else if (target.state === "CLEAR") {
      counts.clearCount += 1;
    } else if (target.state === "FAILED") {
      counts.failedCount += 1;
    } else if (target.state === "SKIPPED") {
      counts.skippedCount += 1;
    }
  }

  await tx.fineCheckRun.update({
    where: {
      id: runId
    },
    data: counts
  });
}

async function recordFineCheckTarget(runId, bikeId, payload = {}) {
  const state = normalizeText(payload.state).toUpperCase();
  if (!TERMINAL_STATES.has(state)) {
    return {
      statusCode: 400,
      body: {
        error: "Fine check state must be FOUND, CLEAR, FAILED, or SKIPPED."
      }
    };
  }

  const target = await prisma.fineCheckTargetResult.findUnique({
    where: {
      runId_bikeId: {
        runId,
        bikeId
      }
    }
  });
  if (!target) {
    return {
      statusCode: 404,
      body: {
        error: "Fine check target was not found in this run."
      }
    };
  }

  const rows = Array.isArray(payload.fines) ? payload.fines.map(validateFineRow) : [];
  if (state === "FOUND" && (rows.length === 0 || rows.some((row) => !row))) {
    return {
      statusCode: 400,
      body: {
        error: "A FOUND result requires at least one complete, valid fine row."
      }
    };
  }
  if (state !== "FOUND" && rows.length > 0) {
    return {
      statusCode: 400,
      body: {
        error: "Only a FOUND result may contain fine rows."
      }
    };
  }

  const checkedAt = new Date();
  await prisma.$transaction(async (tx) => {
    if (state === "FOUND" || state === "CLEAR") {
      await tx.fine.updateMany({
        where: {
          bikeId,
          source: "irembo",
          isCurrentlyReported: true
        },
        data: {
          isCurrentlyReported: false,
          resolvedAt: checkedAt,
          lastCheckedAt: checkedAt
        }
      });
    }

    if (state === "FOUND") {
      for (const row of rows) {
        await tx.fine.upsert({
          where: {
            source_externalTicketNumber: {
              source: "irembo",
              externalTicketNumber: row.ticketNumber
            }
          },
          update: {
            bikeId,
            bikerId: target.bikerId,
            amount: row.amountDisplay,
            amountRwf: row.amountRwf,
            currency: "RWF",
            reason: row.reason,
            fineDate: row.issuedDate,
            paymentDeadline: row.dueDate,
            sourceSummary: `Irembo ticket ${row.ticketNumber}`,
            lastSeenAt: checkedAt,
            lastCheckedAt: checkedAt,
            isCurrentlyReported: true,
            resolvedAt: null,
            notifyRecipient: false
          },
          create: {
            id: randomUUID(),
            bikeId,
            bikerId: target.bikerId,
            amount: row.amountDisplay,
            amountRwf: row.amountRwf,
            currency: "RWF",
            reason: row.reason,
            fineDate: row.issuedDate,
            paymentDeadline: row.dueDate,
            source: "irembo",
            externalTicketNumber: row.ticketNumber,
            sourceSummary: `Irembo ticket ${row.ticketNumber}`,
            firstSeenAt: checkedAt,
            lastSeenAt: checkedAt,
            lastCheckedAt: checkedAt,
            isCurrentlyReported: true,
            notifyRecipient: false
          }
        });
      }
    }

    await tx.fineCheckTargetResult.update({
      where: {
        runId_bikeId: {
          runId,
          bikeId
        }
      },
      data: {
        state,
        fineCount: state === "FOUND" ? rows.length : 0,
        errorCode: state === "FAILED" || state === "SKIPPED"
          ? normalizeText(payload.errorCode).slice(0, 80)
          : "",
        errorMessage: state === "FAILED" || state === "SKIPPED"
          ? normalizeText(payload.errorMessage).slice(0, 500)
          : "",
        retryCount: Math.max(0, Math.min(10, Number(payload.retryCount) || 0)),
        checkedAt
      }
    });

    await refreshRunCounts(tx, runId);
  });

  return {
    statusCode: 200,
    body: {
      ok: true,
      state,
      fineCount: state === "FOUND" ? rows.length : 0
    }
  };
}

async function completeFineCheckRun(runId, payload = {}) {
  const run = await prisma.fineCheckRun.findUnique({
    where: {
      id: runId
    },
    include: {
      targets: true
    }
  });
  if (!run) {
    return {
      statusCode: 404,
      body: {
        error: "Fine check run was not found."
      }
    };
  }

  const hasPending = run.targets.some((target) => target.state === "PENDING");
  const hasFailure = run.targets.some((target) => target.state === "FAILED" || target.state === "SKIPPED");
  const status = hasPending ? "INCOMPLETE" : hasFailure ? "PARTIAL" : "COMPLETED";
  const updated = await prisma.fineCheckRun.update({
    where: {
      id: runId
    },
    data: {
      status,
      completedAt: new Date(),
      errorMessage: normalizeText(payload.errorMessage).slice(0, 500)
    },
    include: {
      targets: {
        orderBy: {
          createdAt: "asc"
        }
      }
    }
  });

  return {
    statusCode: 200,
    body: {
      run: serializeRun(updated)
    }
  };
}

async function getContraventions() {
  const [items, latestRun, schedule] = await Promise.all([
    prisma.fine.findMany({
      where: {
        source: "irembo"
      },
      include: {
        bike: true,
        biker: true
      },
      orderBy: [
        {
          isCurrentlyReported: "desc"
        },
        {
          fineDate: "desc"
        }
      ]
    }),
    prisma.fineCheckRun.findFirst({
      include: {
        targets: {
          orderBy: {
            createdAt: "asc"
          }
        }
      },
      orderBy: {
        startedAt: "desc"
      }
    }),
    getFineMonitorSchedule()
  ]);

  const serializedItems = items.map((item) => ({
    id: item.id,
    bikeId: item.bikeId,
    bikerId: item.bikerId,
    bikerName: buildBikerDisplayName(item.biker),
    phoneNumber: item.biker?.phoneNumber || "",
    plateNumber: normalizePlate(item.bike?.plateNumber),
    ticketNumber: item.externalTicketNumber || "",
    issuedDate: item.fineDate.toISOString(),
    dueDate: item.paymentDeadline ? item.paymentDeadline.toISOString() : null,
    reason: item.reason,
    amount: item.amount,
    amountRwf: item.amountRwf,
    currency: item.currency,
    isCurrentlyReported: item.isCurrentlyReported,
    firstSeenAt: item.firstSeenAt.toISOString(),
    lastSeenAt: item.lastSeenAt.toISOString(),
    lastCheckedAt: item.lastCheckedAt.toISOString()
  }));
  const currentItems = serializedItems.filter((item) => item.isCurrentlyReported);
  const bikerStats = new Map();
  for (const item of currentItems) {
    const key = item.bikerId || item.bikerName;
    const existing = bikerStats.get(key) || {
      bikerId: item.bikerId,
      bikerName: item.bikerName,
      phoneNumber: item.phoneNumber,
      contraventionCount: 0,
      totalAmountRwf: 0,
      lastCheckedAt: null
    };
    existing.contraventionCount += 1;
    existing.totalAmountRwf += Number(item.amountRwf) || 0;
    if (!existing.lastCheckedAt || item.lastCheckedAt > existing.lastCheckedAt) {
      existing.lastCheckedAt = item.lastCheckedAt;
    }
    bikerStats.set(key, existing);
  }
  const statistics = [...bikerStats.values()].sort((left, right) => (
    right.contraventionCount - left.contraventionCount
    || right.totalAmountRwf - left.totalAmountRwf
    || left.bikerName.localeCompare(right.bikerName)
  ));

  return {
    items: serializedItems,
    latestRun: serializeRun(latestRun),
    schedule,
    statistics,
    totalAmountRwf: statistics.reduce((total, item) => total + item.totalAmountRwf, 0)
  };
}

module.exports = {
  completeFineCheckRun,
  createFineCheckRun,
  getContraventions,
  getFineMonitorFrequency,
  getFineMonitorSchedule,
  normalizePlate,
  recordFineCheckTarget,
  saveFineMonitorFrequency,
  serializeRun
};
